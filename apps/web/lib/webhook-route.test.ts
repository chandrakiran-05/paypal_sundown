import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("./paypal", async (original) => ({
  ...(await original<typeof import("./paypal")>()),
  verifyWebhook: vi.fn(),
}));
let dir: string,
  route: typeof import("../app/api/webhooks/route"),
  shop: typeof import("./agent-shop"),
  paypal: typeof import("./paypal");
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "sundown-webhook-"));
  vi.stubEnv("SUNDOWN_ROOT", dir);
  shop = await import("./agent-shop");
  paypal = await import("./paypal");
  route = await import("../app/api/webhooks/route");
  shop.saveShopOrder({
    id: "SANDBOXORDER",
    owner: "owner",
    site_id: 1,
    mode: "sandbox",
    amount: "24.00",
    currency: "USD",
    capture_id: null,
    status: "CREATED",
    approval_url: null,
    created: new Date().toISOString(),
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});
it("rejects an unverified webhook without touching shop state; accepts and deduplicates a verified completion", async () => {
  const body = {
    id: "WH-123",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-123",
      status: "COMPLETED",
      amount: { value: "24.00", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "SANDBOXORDER" } },
    },
  };
  const request = () =>
    new Request("http://localhost/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  vi.mocked(paypal.verifyWebhook).mockResolvedValue(false);
  expect((await route.POST(request())).status).toBe(400);
  expect(shop.shopOrder("SANDBOXORDER", "owner").status).toBe("CREATED");
  vi.mocked(paypal.verifyWebhook).mockResolvedValue(true);
  const response = await route.POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).shop.applied).toBe(true);
  expect(shop.shopOrder("SANDBOXORDER", "owner").status).toBe("PAID");
  expect((await (await route.POST(request())).json()).shop.duplicate).toBe(
    true,
  );
});
