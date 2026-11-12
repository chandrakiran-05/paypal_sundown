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
it("runs only explicitly requested replay in live mode, preserves live receipts, and repairs the demo without provider calls", async () => {
  const report = JSON.stringify({
    version: 1,
    runId: "unit-test-retained-live-receipts",
    startedAt: "2026-11-12T00:00:00.000Z",
    completedAt: "2026-11-12T00:01:00.000Z",
    status: "completed",
    scenarios: store.snapshot().results.map((r) => ({
      id: r.id,
      label: r.label,
      legacy: {
        source: "synthetic-replay",
        status: "completed",
        outcome: r.legacy,
      },
      migrated: ["success", "refund"].includes(r.id)
        ? {
            source: "paypal-sandbox",
            status: "completed",
            outcome: r.migrated,
            orderId: `ORDER-AUDIT-${r.id.toUpperCase()}`,
            captureId: `CAPTURE-AUDIT-${r.id.toUpperCase()}`,
            ...(r.id === "refund" ? { refundId: "REFUND-AUDIT-123" } : {}),
            buyerApproved: true,
            webhookVerified: true,
            settled: true,
            webhookEventId: `WH-AUDIT-${r.id.toUpperCase()}`,
          }
        : {
            source: "synthetic-replay",
            status: "completed",
            outcome: r.migrated,
          },
    })),
  });
  const request = vi.fn(async () => {
    throw new Error("Replay must not call a payment provider");
  });
  vi.stubEnv("PAYPAL_MODE", "live");
  vi.stubEnv("ZAPIER_WEBHOOK_URL", "");
  vi.stubGlobal("fetch", request);
  store.setFlag("live-sandbox-report", report);
  for (const flag of ["idempotent", "failed", "checked"])
    store.setFlag(flag, "");
  const before = store.snapshot().tasks.map((t) => t.startDate);
  try {
    await expect(store.runParity()).rejects.toThrow("live:sandbox");
    const route = await import("../app/api/action/route");
    const actionRequest = (action: string) =>
      new Request("http://localhost/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    expect((await route.POST(actionRequest("parity"))).status).toBe(400);
    const response = await route.POST(actionRequest("replay"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const after = store.snapshot();
    expect(after.checked).toBe(true);
    expect(after.fixed).toBe(true);
    expect(after.running).toBe(false);
    expect(after.results.every((r) => !r.differences.length)).toBe(true);
    expect(after.tasks[4].startDate > before[4]).toBe(true);
    expect(
      after.logs.some((l) =>
        String(l.message).includes("Verifier iteration 1/3"),
      ),
    ).toBe(true);
    expect(after.mode).toBe("replay");
    expect(after.paymentMode).toBe("live");
    expect(store.getFlag("live-sandbox-report")).toBe(report);
    expect(
      after.liveSandbox?.scenarios.find((s) => s.id === "refund")?.migrated
        .refundId,
    ).toBe("REFUND-AUDIT-123");
    expect(request).not.toHaveBeenCalled();
  } finally {
    store.setFlag("live-sandbox-report", "");
    vi.stubEnv("PAYPAL_MODE", "replay");
    vi.unstubAllGlobals();
  }
}, 10000);
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
