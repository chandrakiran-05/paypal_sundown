import { it, expect, afterEach } from "vitest";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { issuePassport, defaultEstimateInputs } from "@sundown/engine/passport";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "sundown-cli-"));
  dirs.push(dir);
  const fixtures = path.join(dir, "fixtures"),
    output = path.join(dir, "report");
  cpSync("fixtures", fixtures, { recursive: true });
  return {
    fixtures,
    output,
    run: () =>
      spawnSync(
        process.execPath,
        [
          "packages/cli/bin/sundown.mjs",
          "verify",
          "--fixtures",
          fixtures,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      ),
    report: () =>
      JSON.parse(readFileSync(path.join(output, "report.json"), "utf8")),
  };
}
it("runs the executable CLI with no credentials and emits portable artifacts", () => {
  const t = setup(),
    run = t.run();
  expect(run.status, run.stderr).toBe(0);
  expect(t.report()).toMatchObject({ passed: true, mode: "synthetic-replay" });
  expect(t.report().results).toHaveLength(6);
  const collection = JSON.parse(
    readFileSync(
      path.join(t.output, "sundown.postman_collection.json"),
      "utf8",
    ),
  );
  expect(collection.item[0].request.url).toBe("{{baseUrl}}/api/verify");
  expect(readFileSync(path.join(t.output, "report.html"), "utf8")).toContain(
    "PASS / Synthetic replay",
  );
});
it("fails on a real outcome regression, preserves the failing evidence and never repairs fixtures", () => {
  const t = setup(),
    file = path.join(t.fixtures, "success.json");
  const input = JSON.parse(readFileSync(file, "utf8"));
  input.migrated.amount = "999.00";
  writeFileSync(file, JSON.stringify(input));
  const run = t.run();
  expect(run.status, run.stderr).toBe(1);
  expect(t.report().passed).toBe(false);
  expect(
    t.report().results.find((r: { id: string }) => r.id === "success")
      .differences,
  ).toContainEqual(expect.objectContaining({ field: "amount" }));
  expect(JSON.parse(readFileSync(file, "utf8")).migrated.amount).toBe("999.00");
  expect(
    readFileSync(
      path.join(t.output, "sundown.postman_collection.json"),
      "utf8",
    ),
  ).toContain("Parity gate passes");
});
it("fails closed for incomplete, duplicate and invalid scenario sets with an error report", () => {
  const t = setup();
  rmSync(path.join(t.fixtures, "decline.json"));
  expect(t.run().status).toBe(1);
  expect(t.report().error).toContain("Missing scenarios");
  cpSync(
    path.join(t.fixtures, "success.json"),
    path.join(t.fixtures, "copy.json"),
  );
  expect(t.run().status).toBe(1);
  expect(t.report().error).toContain("Duplicate");
  writeFileSync(path.join(t.fixtures, "copy.json"), "broken");
  expect(t.run().status).toBe(1);
  expect(t.report().passed).toBe(false);
});
it("verifies a downloaded passport against a retained head and rejects a changed download", () => {
  const t = setup(),
    file = path.join(t.output, "passport.json");
  const passport = issuePassport({
    issuedAt: "2026-11-11T00:00:00.000Z",
    site: {
      id: 1,
      name: "Horizon",
      currency: "USD",
      provenance: "seeded-demo-site",
    },
    parity: {
      status: "not-run",
      mode: "synthetic-replay",
      inputsSha256: null,
      scenarios: [],
    },
    transactions: [],
    estimate: {
      label: "Estimate - not measured revenue",
      inputs: defaultEstimateInputs,
      inputSource: "Demo assumptions",
      amount: 28800,
      formula:
        "dailyOrders * averageOrderValue * paypalShare * failureProbability * exposureDays",
    },
    sunset: {
      date: null,
      basis: "Merchant target - not a universal PayPal deadline",
      daysRemainingAtIssue: null,
    },
  });
  t.run();
  writeFileSync(file, JSON.stringify(passport));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "packages/cli/bin/sundown.mjs",
        "verify",
        "--passport",
        file,
        "--head",
        passport.head,
      ],
      { encoding: "utf8" },
    );
  expect(run().status).toBe(0);
  passport.payload.estimate.amount = 1;
  writeFileSync(file, JSON.stringify(passport));
  expect(run().status).toBe(1);
});
it("executes the composite action's verifier command with caller paths containing spaces", () => {
  const t = setup();
  const action = readFileSync(
    ".github/actions/sundown-verify/action.yml",
    "utf8",
  );
  const sourceCommand = action
    .split("\n")
    .find((line) => line.trim().startsWith("node --input-type=module"))!
    .trim();
  const githubOutput = path.join(path.dirname(t.fixtures), "action-output");
  const env = {
    ...process.env,
    GITHUB_ACTION_PATH: path.resolve(".github/actions/sundown-verify"),
    GITHUB_WORKSPACE: path.dirname(t.fixtures),
    GITHUB_OUTPUT: githubOutput,
    SUNDOWN_FIXTURES: "fixtures",
    SUNDOWN_REPORT: "report with spaces",
  };
  const locate = spawnSync("bash", ["-c", sourceCommand], {
    encoding: "utf8",
    env,
  });
  expect(locate.status, locate.stderr).toBe(0);
  const relativePackage = readFileSync(githubOutput, "utf8")
    .trim()
    .slice("package-json=".length);
  expect(path.resolve(env.GITHUB_WORKSPACE, relativePackage)).toBe(
    path.resolve("package.json"),
  );
  const command = readFileSync(
    ".github/actions/sundown-verify/action.yml",
    "utf8",
  )
    .split("\n")
    .find((line) => line.includes("run: node "))
    ?.trim()
    .slice(5);
  expect(command).toBeTruthy();
  const run = spawnSync("bash", ["-c", command!], {
    encoding: "utf8",
    env,
  });
  expect(run.status, run.stderr).toBe(0);
  const report = JSON.parse(
    readFileSync(
      path.join(path.dirname(t.fixtures), "report with spaces/report.json"),
      "utf8",
    ),
  );
  expect(report.passed).toBe(true);
});
