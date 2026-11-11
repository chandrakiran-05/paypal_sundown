/** End-to-end server behavior in an isolated SQLite workspace; never reaches PayPal. */
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { chromium } from "playwright";
import { verifyPassport } from "@sundown/engine/passport";
import { evidenceLabel, type LiveReport } from "@sundown/engine/live-evidence";
import { executeFixture } from "@sundown/engine";
let dir: string;
let agent: typeof import("./shopping-agent"),
  shop: typeof import("./agent-shop"),
  passports: typeof import("./passports"),
  store: typeof import("./store");
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "sundown-upgrades-"));
  mkdirSync(path.join(dir, "apps"));
  cpSync("apps/legacy-shop", path.join(dir, "apps/legacy-shop"), {
    recursive: true,
  });
  cpSync("fixtures", path.join(dir, "fixtures"), { recursive: true });
  vi.stubEnv("SUNDOWN_ROOT", dir);
  vi.stubEnv("PAYPAL_MODE", "replay");
  vi.stubEnv("PAYPAL_CLIENT_ID", "");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
  store = await import("./store");
  shop = await import("./agent-shop");
  agent = await import("./shopping-agent");
  passports = await import("./passports");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});
const owner = "owner-one";
function event(
  id: string,
  orderId: string,
  captureId = "CAPTURE123",
  value = "24.00",
) {
  return {
    id,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      status: "COMPLETED",
      amount: { value, currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  };
}
it("reports the legacy incompatibility from source and requires migration", async () => {
  expect(agent.legacyAttempt()).toMatchObject({
    status: "failed",
    mode: "source-inspection",
  });
  await expect(
    agent.startShoppingAgent(
      owner,
      "simulated",
      randomUUID(),
      "http://localhost:3000",
    ),
  ).rejects.toThrow("Apply the migration");
  store.migrate();
});
it("runs without credentials, labels every simulated payment step, and persists PAID through a webhook", async () => {
  const id = randomUUID(),
    run = await agent.startShoppingAgent(
      owner,
      "simulated",
      id,
      "http://localhost:3000",
    );
  expect(run.order).toMatchObject({
    mode: "simulated",
    status: "PAID",
    amount: "24.00",
  });
  expect(run.order.id).toMatch(/^SIM-ORDER/);
  expect(run.steps.every((s) => s.startsWith("Simulated:"))).toBe(true);
  expect(
    (
      await agent.startShoppingAgent(
        owner,
        "simulated",
        id,
        "http://localhost:3000",
      )
    ).order.id,
  ).toBe(run.order.id);
  expect(shop.shopOrder(run.order.id, owner).status).toBe("PAID");
  expect(shop.publicShopOrder(run.order)).not.toHaveProperty("owner");
  expect(() => shop.shopOrder(run.order.id, "other-owner")).toThrow();
  await expect(agent.finishShoppingAgent(run.order.id, owner)).rejects.toThrow(
    "Simulated orders",
  );
});
it("checks the generated shop's actual catalog before pricing an agent order", async () => {
  const file = path.join(dir, "workspace/migrated-shop/catalog.json"),
    original = readFileSync(file, "utf8");
  const catalog = JSON.parse(original);
  catalog[0].price = "25.00";
  writeFileSync(file, JSON.stringify(catalog));
  try {
    await expect(
      agent.startShoppingAgent(
        owner,
        "simulated",
        randomUUID(),
        "http://localhost",
      ),
    ).rejects.toThrow("catalog no longer matches");
  } finally {
    writeFileSync(file, original);
  }
});
it("uses Toolkit create/capture tools, requires approval and awaits a matching sandbox webhook", async () => {
  const call = vi.fn(async (name: string) =>
    name === "create_order"
      ? {
          id: "ORDER12345",
          links: [
            {
              rel: "approve",
              href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345",
            },
          ],
        }
      : {
          status: "success",
          response: {
            id: "ORDER12345",
            status: "COMPLETED",
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: "CAPTURE123",
                      status: "COMPLETED",
                      amount: { value: "24.00", currency_code: "USD" },
                    },
                  ],
                },
              },
            ],
          },
        },
  );
  const result = await agent.startShoppingAgent(
    owner,
    "sandbox",
    randomUUID(),
    "http://localhost:3000",
    call,
  );
  expect(result.order.status).toBe("CREATED");
  expect(call.mock.calls[0][0]).toBe("create_order");
  const capture = await agent.finishShoppingAgent(result.order.id, owner, call);
  expect(capture.status).toBe("AWAITING_WEBHOOK");
  expect(call.mock.calls[1][0]).toBe("pay_order");
  expect(
    shop.applyShopWebhook(
      event("bad-amount", capture.id, "CAPTURE123", "25.00"),
      "sandbox",
    ).applied,
  ).toBe(false);
  expect(
    shop.applyShopWebhook(event("wrong-mode", capture.id), "simulated").applied,
  ).toBe(false);
  expect(
    shop.applyShopWebhook(
      event("wrong-capture", capture.id, "OTHER"),
      "sandbox",
    ).applied,
  ).toBe(false);
  const valid = event("valid", capture.id);
  expect(shop.applyShopWebhook(valid, "sandbox")).toEqual({
    applied: true,
    duplicate: false,
  });
  expect(shop.applyShopWebhook(valid, "sandbox")).toEqual({
    applied: true,
    duplicate: true,
  });
  expect(shop.shopOrder(capture.id, owner).status).toBe("PAID");
});
it("does not treat PayPal tool errors or off-sandbox approval links as success", async () => {
  await expect(
    agent.startShoppingAgent(
      owner,
      "sandbox",
      randomUUID(),
      "http://localhost",
      async () => ({ error: "Rejected" }),
    ),
  ).rejects.toThrow();
  await expect(
    agent.startShoppingAgent(
      owner,
      "sandbox",
      randomUUID(),
      "http://localhost",
      async () => ({
        id: "ORDERBAD123",
        links: [{ rel: "approve", href: "https://www.paypal.com/checkout" }],
      }),
    ),
  ).rejects.toThrow("sandbox approval");
  expect(agent.sandboxAgentAvailable()).toBe(false);
  await expect(
    agent.startShoppingAgent(
      owner,
      "sandbox",
      randomUUID(),
      "http://localhost",
    ),
  ).rejects.toThrow("Sandbox unavailable");
});
it("configures the actual toolkit for sandbox and exposes only order tools", async () => {
  vi.stubEnv("PAYPAL_MODE", "live");
  vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "test-webhook");
  const spy = vi
    .spyOn(PayPalAgentToolkit.prototype, "handleToolCall")
    .mockImplementation(async function (this: PayPalAgentToolkit, call) {
      expect(this.client.getBaseUrl()).toContain("sandbox.paypal.com");
      expect(
        this.getTools()
          .map((t) => t.function.name)
          .sort(),
      ).toEqual(["create_order", "get_order", "pay_order"]);
      return {
        role: "tool",
        tool_call_id: call.id,
        content: '{"id":"TOOLORDER"}',
      };
    });
  try {
    expect(
      await agent.toolkitCall(
        "create_order",
        { currencyCode: "USD" },
        "stable-request",
      ),
    ).toEqual({ id: "TOOLORDER" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stable-request",
        function: { name: "create_order", arguments: '{"currencyCode":"USD"}' },
      }),
    );
  } finally {
    spy.mockRestore();
    vi.stubEnv("PAYPAL_MODE", "replay");
    vi.stubEnv("PAYPAL_CLIENT_ID", "");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
  }
});
it("issues portable site-specific snapshots with distinct simulated and sandbox IDs", async () => {
  const passport = passports.createPassport(1);
  expect(verifyPassport(passport)).toBe(true);
  expect(passport.payload.parity.status).toBe("not-run");
  expect(passport.payload.transactions.map((t) => t.mode)).toContain(
    "simulated",
  );
  expect(passport.payload.transactions.map((t) => t.mode)).toContain("sandbox");
  expect(passport.payload.estimate).toMatchObject({
    inputSource: "Demo assumptions",
    amount: 28800,
  });
  expect(passport.payload.sunset.date).toBeNull();
  expect(passports.loadPassport(1).head).toBe(passport.head);
  const second = passports.createPassport(2);
  expect(second.payload.parity.status).toBe("no-site-evidence");
  expect(second.payload.transactions).toEqual([]);
  expect(second.head).not.toBe(passport.head);
  const { passportPdf } = await import("./passport-pdf");
  const bytes = await passportPdf(passport),
    pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  expect(pdf.getTitle()).toContain("Horizon Supply");
  expect(pdf.getSubject()).toContain(passport.head);
});
it("reissues validated estimate/date inputs while retaining old downloadable snapshots", () => {
  const first = passports.loadPassport(1);
  const second = passports.createPassport(1, {
    inputs: {
      dailyOrders: 10,
      averageOrderValue: 20,
      paypalShare: 0.5,
      failureProbability: 0.5,
      exposureDays: 3,
    },
    sunsetDate: "2026-12-01",
  });
  expect(second.payload.estimate.amount).toBe(150);
  expect(second.payload.estimate.inputSource).toBe("Operator assumptions");
  expect(second.payload.sunset.date).toBe("2026-12-01");
  expect(second.head).not.toBe(first.head);
  expect(verifyPassport(first)).toBe(true);
  expect(() =>
    passports.createPassport(1, {
      inputs: { ...second.payload.estimate.inputs, paypalShare: 5 },
      sunsetDate: null,
    }),
  ).toThrow();
});
it("exports actual scenario evidence and preserves migrated receipts during a legacy-only retry", async () => {
  const report: LiveReport = {
    version: 1,
    runId: "unit-test-only",
    startedAt: "2026-11-11T00:00:00.000Z",
    completedAt: "2026-11-11T00:01:00.000Z",
    status: "completed",
    scenarios: store.fixtures().map((f) => {
      const r = executeFixture(f, true);
      const side = {
        source: "synthetic-replay" as const,
        status: "completed" as const,
        outcome: r.migrated,
      };
      return {
        id: f.id,
        label: f.label,
        legacy: {
          ...side,
          source: ["success", "refund"].includes(f.id)
            ? ("paypal-sandbox" as const)
            : ("synthetic-replay" as const),
          outcome: {
            ...r.legacy,
            ...(["success", "refund"].includes(f.id)
              ? { notifications: [] }
              : {}),
          },
        },
        migrated: ["success", "refund"].includes(f.id)
          ? {
              ...side,
              source: "paypal-sandbox" as const,
              orderId: "ORDER12345",
              captureId: "CAPTURE123",
              buyerApproved: true,
              webhookVerified: true,
              settled: true,
              webhookEventId: "WH-UNIT-TEST",
              ...(f.id === "refund" ? { refundId: "REFUND12345" } : {}),
            }
          : side,
      };
    }),
  };
  store.setFlag("live-sandbox-report", JSON.stringify(report));
  try {
    const passport = passports.createPassport(1);
    expect(passport.payload.parity.mode).toBe("mixed-sandbox-replay");
    expect(verifyPassport(passport)).toBe(true);
    const labels = Object.fromEntries(
      passport.payload.parity.scenarios.map((s) => [
        s.id,
        evidenceLabel(s.id, s.migratedEvidence),
      ]),
    );
    expect(labels).toEqual({
      success: "Live sandbox",
      refund: "Live sandbox",
      cancel: "Replay",
      decline: "Replay",
      duplicate: "Replay",
      rounding: "Replay",
    });
    const refund = passport.payload.parity.scenarios.find(
      (s) => s.id === "refund",
    );
    expect(refund?.migratedEvidence?.refundId).toBe("REFUND12345");
    expect(refund?.notComparable).toEqual([
      {
        field: "notifications",
        reason: "Not comparable: legacy IPN is unreachable from loopback",
      },
    ]);
    expect(refund?.differences).not.toContain("notifications");
    const changedNeutral = structuredClone(passport);
    changedNeutral.payload.parity.scenarios.find(
      (s) => s.id === "refund",
    )!.notComparable![0].reason = "Match";
    expect(verifyPassport(changedNeutral)).toBe(false);
    const changed = structuredClone(passport);
    changed.payload.parity.scenarios[0].migratedEvidence!.source =
      "paypal-sandbox";
    expect(verifyPassport(changed)).toBe(false);
    const launch = vi
      .spyOn(chromium, "launch")
      .mockRejectedValue(new Error("Test browser unavailable"));
    vi.stubEnv("PAYPAL_MODE", "live");
    try {
      const { runLiveSandbox } = await import("./live-sandbox");
      const retry = await runLiveSandbox({
        legacyOnly: true,
        manualApproval: true,
      });
      expect(retry.scenarios.map((s) => s.migrated)).toEqual(
        report.scenarios.map((s) => ({
          ...s.migrated,
          label: evidenceLabel(s.id, s.migrated),
        })),
      );
      expect(
        retry.scenarios
          .filter((s) => ["success", "refund"].includes(s.id))
          .every((s) => evidenceLabel(s.id, s.migrated) === "Live sandbox"),
      ).toBe(true);
    } finally {
      launch.mockRestore();
      vi.stubEnv("PAYPAL_MODE", "replay");
    }
  } finally {
    store.setFlag("live-sandbox-report", "");
  }
});
