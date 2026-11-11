/** APIMatic-guided HTTP-boundary tests exercise the actual SDK serializer without sandbox credentials. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Client, Environment, CustomError } from "@paypal/paypal-server-sdk";
import {
  buildSandboxClient,
  paypalOperations,
  paypalFailure,
  verifyWebhook,
  signatureSchema,
} from "./paypal";
interface WireRequest {
  url: string;
  method: string;
  data?: string;
  headers: Record<string, string>;
}
function transport(
  status = 201,
  body: unknown = { id: "ORDER12345", status: "CREATED" },
) {
  const calls: WireRequest[] = [];
  const client = new Client({
    environment: Environment.Sandbox,
    timeout: 15000,
    clientCredentialsAuthCredentials: {
      oAuthClientId: "test-id",
      oAuthClientSecret: "test-secret",
    },
    httpClientOptions: {
      retryConfig: { maxNumberOfRetries: 0, maximumRetryWaitTime: 0 },
    },
    unstable_httpClientOptions: {
      adapter: async (config: WireRequest) => {
        calls.push(config);
        return {
          data: JSON.stringify(
            config.url.includes("/oauth2/token")
              ? {
                  access_token: "test-token",
                  token_type: "Bearer",
                  expires_in: 3600,
                }
              : body,
          ),
          status: config.url.includes("/oauth2/token") ? 200 : status,
          statusText: "",
          headers: { "content-type": "application/json" },
          config,
        };
      },
    },
  });
  return { client, calls, api: paypalOperations(client) };
}
const checkout = {
  amount: "24.00",
  currency: "USD" as const,
  returnUrl: "http://localhost:3000/checkout",
  cancelUrl: "http://localhost:3000/checkout?cancelled=1",
};
afterEach(() => vi.unstubAllEnvs());
describe("APIMatic-grounded PayPal SDK contract", () => {
  it("never constructs a live client in replay or without credentials", () => {
    expect(() => buildSandboxClient({ PAYPAL_MODE: "replay" })).toThrow(
      "Set PAYPAL_MODE",
    );
    expect(() => buildSandboxClient({ PAYPAL_MODE: "live" })).toThrow(
      "Set PAYPAL_MODE",
    );
  });
  it("serializes experience_context, server amount and request ID, reusing OAuth", async () => {
    const { api, calls } = transport();
    await api.create("same-key", checkout);
    await api.create("same-key", checkout);
    expect(
      calls.filter((r) => r.url.endsWith("/v1/oauth2/token")),
    ).toHaveLength(1);
    const requests = calls.filter((r) => r.url.endsWith("/v2/checkout/orders"));
    expect(requests).toHaveLength(2);
    for (const request of calls)
      expect(new URL(request.url).hostname).toBe("api-m.sandbox.paypal.com");
    expect(requests[0].headers["PayPal-Request-Id"]).toBe("same-key");
    const body = JSON.parse(requests[0].data!);
    expect(body.purchase_units[0].amount).toEqual({
      currency_code: "USD",
      value: "24.00",
    });
    expect(body.payment_source.paypal.experience_context).toMatchObject({
      return_url: checkout.returnUrl,
      user_action: "PAY_NOW",
    });
    expect(body.application_context).toBeUndefined();
  });
  it("captures an order and refunds a capture using distinct v2 resources", async () => {
    const { api, calls } = transport(201, {
      id: "RESULT12345",
      status: "COMPLETED",
    });
    await api.capture("ORDER12345", "capture-key");
    await api.refund("CAPTURE12345", "refund-key", "12.00");
    const capture = calls.find((r) =>
      r.url.endsWith("/v2/checkout/orders/ORDER12345/capture"),
    )!;
    const refund = calls.find((r) =>
      r.url.endsWith("/v2/payments/captures/CAPTURE12345/refund"),
    )!;
    expect(capture.method.toUpperCase()).toBe("POST");
    expect(refund.headers["PayPal-Request-Id"]).toBe("refund-key");
    expect(JSON.parse(refund.data!).amount.value).toBe("12.00");
  });
  it("preserves typed PayPal declines but exposes no provider body or secrets", async () => {
    const { api } = transport(422, {
      name: "UNPROCESSABLE_ENTITY",
      message: "sensitive-provider-message",
    });
    let thrown: unknown;
    try {
      await api.capture("ORDER12345", "decline-key");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CustomError);
    expect(paypalFailure(thrown)).toMatchObject({
      code: "PAYPAL_REJECTED",
      status: 422,
    });
    expect(paypalFailure(thrown).message).not.toContain(
      "sensitive-provider-message",
    );
  });
  it("reports transport ambiguity rather than declaring a payment failed", () => {
    expect(paypalFailure(new Error("secret transport detail"))).toMatchObject({
      code: "PAYPAL_OUTCOME_UNKNOWN",
      status: 504,
    });
  });
  it("rejects invalid money before a request leaves", async () => {
    const { api, calls } = transport();
    await expect(
      api.refund("CAPTURE12345", "refund-key", "-1.00"),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
const signature = new Headers({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test",
  "paypal-transmission-id": "transmission-1",
  "paypal-transmission-sig": "signature",
  "paypal-transmission-time": "2026-11-10T12:00:00Z",
});
describe("signature verification boundary", () => {
  it("preserves the original validated event serialization for PayPal signature verification", async () => {
    const event = {
      id: "EVENT123",
      create_time: "2026-11-11T12:00:00Z",
      resource_type: "capture",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      summary: "Payment completed",
      resource: { id: "CAPTURE123", status: "COMPLETED" },
      links: [],
    };
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ verification_status: "SUCCESS" }),
    );
    await verifyWebhook(event, signature, {
      client: transport().client,
      fetch: request,
      webhookId: "WEBHOOK123",
    });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(JSON.stringify(body.webhook_event)).toBe(JSON.stringify(event));
  });
  it("rejects missing and invalid signature metadata before transport", async () => {
    const request = vi.fn();
    await expect(
      verifyWebhook(
        { id: "EVENT123", event_type: "PAYMENT.CAPTURE.COMPLETED" },
        new Headers(),
        { client: transport().client, fetch: request, webhookId: "WEBHOOK123" },
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(
      signatureSchema.safeParse({
        auth_algo: "a",
        cert_url: "http://attacker.test/cert",
        transmission_id: "id",
        transmission_sig: "sig",
        transmission_time: "2026-11-10T12:00:00Z",
      }).success,
    ).toBe(false);
  });
  it.each(["SUCCESS", "FAILURE"] as const)(
    "accepts only verification_status SUCCESS (%s)",
    async (status) => {
      const request = vi.fn<typeof fetch>(async () =>
        Response.json({ verification_status: status }),
      );
      const result = await verifyWebhook(
        { id: "EVENT123", event_type: "PAYMENT.CAPTURE.COMPLETED" },
        signature,
        { client: transport().client, fetch: request, webhookId: "WEBHOOK123" },
      );
      expect(result).toBe(status === "SUCCESS");
      const [url, options] = request.mock.calls[0];
      expect(url).toBe(
        "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
      );
      expect(JSON.parse(String(options?.body))).toMatchObject({
        webhook_id: "WEBHOOK123",
        transmission_sig: "signature",
        webhook_event: { id: "EVENT123" },
      });
    },
  );
});
