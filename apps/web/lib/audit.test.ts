/** Judge regression checks: source-backed readiness, explicit evidence mode, and resilient verification. */
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
let dir: string;
let store: typeof import("./store");
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "sundown-audit-"));
  mkdirSync(path.join(dir, "apps"), { recursive: true });
  cpSync("apps/legacy-shop", path.join(dir, "apps/legacy-shop"), {
    recursive: true,
  });
  cpSync("fixtures", path.join(dir, "fixtures"), { recursive: true });
  vi.stubEnv("SUNDOWN_ROOT", dir);
  vi.stubEnv("PAYPAL_MODE", "replay");
  vi.stubEnv("ZAPIER_WEBHOOK_URL", "");
  store = await import("./store");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
it("never labels synthetic evidence live, even when payment endpoints are enabled", () => {
  vi.stubEnv("PAYPAL_MODE", "live");
  expect(store.snapshot().mode).toBe("replay");
  expect(store.snapshot().paymentMode).toBe("live");
  vi.stubEnv("PAYPAL_MODE", "replay");
});
it("does not pass readiness from flags without generated artifacts", () => {
  store.setFlag("migrated", "true");
  store.setFlag("checked", "true");
  expect(store.snapshot().checks.every((c) => c.pass)).toBe(false);
  store.setFlag("migrated", "");
  store.setFlag("checked", "");
});
it("writes migrated files without the unused legacy NVP transport", () => {
  store.migrate();
  const state = store.snapshot();
  expect(state.migratedFindings).toHaveLength(0);
  expect(state.checks.slice(0, 3).every((c) => c.pass)).toBe(true);
  expect(
    readFileSync(path.join(dir, "workspace/migrated-shop/store.php"), "utf8"),
  ).not.toContain("function nvp(");
  expect(state.checks[3].pass).toBe(false);
});
it("runs the known replay repair, defers dependencies and becomes ready", async () => {
  const before = store.snapshot().tasks.map((t) => t.startDate);
  await store.runParity();
  const after = store.snapshot();
  expect(after.results.every((r) => r.differences.length === 0)).toBe(true);
  expect(after.checks.every((c) => c.pass)).toBe(true);
  expect(after.tasks[4].startDate > before[4]).toBe(true);
  expect(
    after.logs.some((l) =>
      String(l.message).includes("Verifier iteration 1/3"),
    ),
  ).toBe(true);
});
it("fails readiness again when a generated catalog is removed or corrupt", () => {
  const catalog = path.join(dir, "workspace/migrated-shop/catalog.json");
  writeFileSync(catalog, "{invalid");
  expect(store.snapshot().checks[2].pass).toBe(false);
});
it("does not let an optional Zapier outage fail verification", async () => {
  vi.stubEnv("ZAPIER_WEBHOOK_URL", "https://hooks.zapier.com/test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Network outage");
    }),
  );
  await expect(store.notify("parity failed")).resolves.toBeUndefined();
  expect(
    store
      .snapshot()
      .logs.some((l) => String(l.message).includes("delivery failed")),
  ).toBe(true);
});

it("exports an applicable review diff containing all changed files and removal of the old IPN handler", () => {
  const original = path.join(dir, "patch-check");
  mkdirSync(original);
  cpSync(
    path.join(dir, "apps/legacy-shop/index.php"),
    path.join(original, "index.php"),
  );
  cpSync(
    path.join(dir, "apps/legacy-shop/store.php"),
    path.join(original, "store.php"),
  );
  cpSync(
    path.join(dir, "apps/legacy-shop/ipn.php"),
    path.join(original, "ipn.php"),
  );
  const diff = store.snapshot().diff;
  for (const file of ["index.php", "store.php", "webhook.php", "catalog.json"])
    expect(diff).toContain("+++ b/" + file);
  expect(diff).toContain("--- a/ipn.php\n+++ /dev/null");
  expect(() =>
    execFileSync("git", ["apply", "--check", "-"], {
      cwd: original,
      input: diff,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  ).not.toThrow();
});
