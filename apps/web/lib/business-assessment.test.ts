import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
let root: string;
let assessment: typeof import("./business-assessment");
let store: typeof import("./store");
let api: typeof import("../app/api/assessments/route");
beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "sundown-assessment-"));
  mkdirSync(path.join(root, "apps"));
  cpSync("apps/legacy-shop", path.join(root, "apps/legacy-shop"), {
    recursive: true,
  });
  cpSync("fixtures", path.join(root, "fixtures"), { recursive: true });
  vi.stubEnv("SUNDOWN_ROOT", root);
  store = await import("./store");
  assessment = await import("./business-assessment");
  api = await import("../app/api/assessments/route");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});
const input = (patch: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  name: "Example business",
  siteUrl: "https://shop.example",
  files: [{ name: "checkout.php", content: "<?php SetExpressCheckout([]);" }],
  ...patch,
});
it("analyzes actual uploaded code and returns a separate, durable business assessment", () => {
  const first = assessment.createBusinessAssessment(input());
  const different = assessment.createBusinessAssessment(
    input({
      name: "Other business",
      files: [{ name: "refund.php", content: "<?php RefundTransaction([]);" }],
    }),
  );
  expect(first.findings.map((f) => f.rule)).toEqual(["nvp-create"]);
  expect(different.findings.map((f) => f.rule)).toEqual(["nvp-refund"]);
  expect(first.files[0]).toMatchObject({ name: "checkout.php", bytes: 29 });
  expect(first.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(first.sourceHash).not.toBe(different.sourceHash);
  expect(first.tasks.length).toBeGreaterThan(0);
  expect(first.status).toBe("assessed");
  expect(first.provenance).toBe("uploaded-source-analysis");
  expect(assessment.getBusinessAssessment(first.id)).toEqual(first);
  expect(
    assessment.listBusinessAssessments().some((a) => a.id === first.id),
  ).toBe(true);
});
it("reports clean source as zero findings without inventing readiness, parity or migration", () => {
  const result = assessment.createBusinessAssessment(
    input({
      files: [
        { name: "index.ts", content: "export const greeting = 'hello';" },
      ],
    }),
  );
  expect(result.findings).toEqual([]);
  expect(result.tasks).toEqual([]);
  expect(result.limitations.join(" ")).toContain(
    "Zero findings do not prove checkout compatibility",
  );
  expect(result).not.toHaveProperty("ready");
  expect(result).not.toHaveProperty("parityResults");
});
it("never stores source snippets or secret values and never fetches the metadata URL", () => {
  const fetch = vi.fn(() => {
    throw new Error("No network permitted");
  });
  vi.stubGlobal("fetch", fetch);
  const secret = "super-private-client-secret-123456",
    token = "sk-or-v1-1234567890abcdef1234567890abcdef";
  const source = `<?php $PAYPAL_CLIENT_SECRET='${secret}'; SetExpressCheckout(['token'=>'${token}']);`;
  const result = assessment.createBusinessAssessment(
    input({
      siteUrl:
        "http://169.254.169.254/latest/meta-data?access_token=private-query#private-fragment",
      files: [{ name: "checkout.php", content: source }],
    }),
  );
  expect(result.siteUrl).toBe("http://169.254.169.254/latest/meta-data");
  expect(fetch).not.toHaveBeenCalled();
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain(token);
  expect(serialized).not.toContain("private-query");
  expect(result.findings[0]).not.toHaveProperty("excerpt");
  for (const file of readdirSync(path.join(root, "workspace")).filter((f) =>
    f.startsWith("sundown.sqlite"),
  )) {
    const bytes = readFileSync(path.join(root, "workspace", file));
    expect(bytes.includes(Buffer.from(secret))).toBe(false);
    expect(bytes.includes(Buffer.from(token))).toBe(false);
  }
  vi.unstubAllGlobals();
});
it("is idempotent for the same request and rejects reuse with changed input", () => {
  const body = input();
  const first = assessment.createBusinessAssessment(body);
  expect(assessment.createBusinessAssessment(body)).toEqual(first);
  expect(() =>
    assessment.createBusinessAssessment({ ...body, name: "Changed" }),
  ).toThrow("already used");
});
it("does not alter Horizon's source, flags, migration or live payment evidence", () => {
  const before = store.sourceFiles();
  for (const key of [
    "migrated",
    "checked",
    "idempotent",
    "live-sandbox-report",
  ])
    store.setFlag(key, "retained-" + key);
  const flags = [
    "migrated",
    "checked",
    "idempotent",
    "live-sandbox-report",
  ].map((key) => [key, store.getFlag(key)]);
  assessment.createBusinessAssessment(input({ name: "Isolated merchant" }));
  expect(store.sourceFiles()).toEqual(before);
  for (const [key, value] of flags) expect(store.getFlag(key)).toBe(value);
});
it.each([
  "../checkout.php",
  "folder/checkout.php",
  "folder\\checkout.php",
  ".env",
  ".env.php",
  "test.env.php",
  "archive.zip",
  "binary.png",
  "checkout\n.php",
  "..php",
])("rejects unsafe filename %s", (name) => {
  expect(() =>
    assessment.createBusinessAssessment(
      input({ files: [{ name, content: "test" }] }),
    ),
  ).toThrow("Invalid assessment input");
});
it("rejects duplicate names, binary/control contents, invalid metadata and size excesses", () => {
  for (const patch of [
    { name: "" },
    { name: "a".repeat(101) },
    { requestId: "invalid" },
    { siteUrl: "file:///etc/passwd" },
    { siteUrl: "https://user:password@shop.example" },
    { files: [] },
    {
      files: Array.from({ length: 11 }, (_, i) => ({
        name: `file${i}.php`,
        content: "test",
      })),
    },
    {
      files: [
        { name: "file.php", content: "test" },
        { name: "FILE.php", content: "test" },
      ],
    },
    { files: [{ name: "file.php", content: "hello\u0000world" }] },
    { files: [{ name: "file.php", content: "\uD800" }] },
    { files: [{ name: "file.php", content: "a".repeat(102401) }] },
    {
      files: Array.from({ length: 4 }, (_, i) => ({
        name: `file${i}.php`,
        content: "a".repeat(80000),
      })),
    },
  ])
    expect(() => assessment.createBusinessAssessment(input(patch))).toThrow(
      "Invalid assessment input",
    );
  expect(() =>
    assessment.createBusinessAssessment(
      input({
        files: [
          {
            name: "many.php",
            content: "SetExpressCheckout([]);\n".repeat(501),
          },
        ],
      }),
    ),
  ).toThrow("too many findings");
});
it("API lists, retrieves and downloads safe records and gives safe input errors", async () => {
  const create = await api.POST(
    new Request("http://localhost/api/assessments", {
      method: "POST",
      body: JSON.stringify(input()),
    }),
  );
  expect(create.status).toBe(200);
  const { assessment: result } = await create.json();
  expect(
    (
      await api.GET(
        new Request(`http://localhost/api/assessments?id=${result.id}`),
      )
    ).status,
  ).toBe(200);
  const download = api.GET(
    new Request(`http://localhost/api/assessments?id=${result.id}&format=json`),
  );
  expect(download.headers.get("Content-Disposition")).toContain("attachment");
  expect((await download.json()).sourceHash).toBe(result.sourceHash);
  expect(
    (await api.GET(new Request("http://localhost/api/assessments")).json())
      .assessments.length,
  ).toBeGreaterThan(0);
  const bad = await api.POST(
    new Request("http://localhost/api/assessments", {
      method: "POST",
      body: JSON.stringify(
        input({
          files: [
            { name: "secret.env", content: "API_KEY=do-not-echo-this-secret" },
          ],
        }),
      ),
    }),
  );
  expect(bad.status).toBe(400);
  expect(await bad.text()).not.toContain("do-not-echo-this-secret");
  expect(
    api.GET(new Request("http://localhost/api/assessments?id=invalid")).status,
  ).toBe(400);
  expect(
    api.GET(new Request(`http://localhost/api/assessments?id=${randomUUID()}`))
      .status,
  ).toBe(404);
  expect(
    (
      await api.POST(
        new Request("http://localhost/api/assessments", {
          method: "POST",
          body: "{",
        }),
      )
    ).status,
  ).toBe(400);
});
it("caps both declared and streamed request size before JSON parsing", async () => {
  const declared = await api.POST(
    new Request("http://localhost/api/assessments", {
      method: "POST",
      headers: { "Content-Length": "1048577" },
      body: "{}",
    }),
  );
  expect(declared.status).toBe(413);
  const streamed = await api.POST(
    new Request("http://localhost/api/assessments", {
      method: "POST",
      body: " ".repeat(1048577),
    }),
  );
  expect(streamed.status).toBe(413);
});
it("bounds the recent-assessment list to fifty safe records", () => {
  for (let i = 0; i < 51; i++)
    assessment.createBusinessAssessment(
      input({
        name: `List business ${i}`,
        files: [{ name: "index.ts", content: "export const value=1;" }],
      }),
    );
  expect(assessment.listBusinessAssessments()).toHaveLength(50);
});
