/** Partner onboarding tests use injected sandbox responses; never reach PayPal. */
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
let directory: string;
let onboarding: typeof import("./partner-onboarding");
const partnerEnv = {
  NODE_ENV: "test",
  PAYPAL_PARTNER_CLIENT_ID: "test-partner-client",
  PAYPAL_PARTNER_CLIENT_SECRET: "test-partner-secret",
  PAYPAL_PARTNER_ID: "PARTNER12345",
  PAYPAL_PARTNER_BN_CODE: "TEST_BN",
  SUNDOWN_APP_URL: "https://sundown.example",
};
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "sundown-partner-"));
  vi.stubEnv("SUNDOWN_ROOT", directory);
  for (const [key, value] of Object.entries(partnerEnv)) vi.stubEnv(key, value);
  onboarding = await import("./partner-onboarding");
});
beforeEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});
function provider() {
  let tracking = "",
    returned = "";
  let details: Record<string, unknown> = {};
  let approval =
    "https://www.sandbox.paypal.com/bizsignup/partner/entry?token=PAYPAL-REFERRAL";
  let fail = false;
  let deniedReferral = false;
  let defer: Promise<void> | undefined;
  const calls: {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
  }[] = [];
  const valid = () => ({
    merchant_id: "MERCHANT12345",
    tracking_id: tracking,
    payments_receivable: true,
    primary_email_confirmed: true,
    products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
    oauth_integrations: [
      {
        integration_type: "OAUTH_THIRD_PARTY",
        integration_method: "PAYPAL",
        oauth_third_party: [
          {
            partner_client_id: partnerEnv.PAYPAL_PARTNER_CLIENT_ID,
            scopes: [
              "https://uri.paypal.com/services/payments/payment/authcapture",
              "https://uri.paypal.com/services/payments/refund",
            ],
          },
        ],
      },
    ],
  });
  const links = () => [
    { rel: "action_url", href: approval },
    {
      rel: "self",
      href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/REFERRAL123",
    },
  ];
  const request = vi.fn<typeof fetch>(async (input, options) => {
    const url = String(input),
      method = options?.method || "GET";
    calls.push({
      url,
      method,
      headers: new Headers(options?.headers),
      body: options?.body
        ? JSON.parse(
            String(options.body).startsWith("{")
              ? String(options.body)
              : "null",
          )
        : null,
    });
    expect(new URL(url).origin).toBe("https://api-m.sandbox.paypal.com");
    if (
      fail ||
      (deniedReferral && url.endsWith("/v2/customer/partner-referrals"))
    )
      return Response.json(
        {
          name: "PERMISSION_DENIED",
          message:
            "private-email@example.invalid " +
            partnerEnv.PAYPAL_PARTNER_CLIENT_SECRET,
          debug_id: "DEBUG123",
        },
        { status: 403 },
      );
    if (url.endsWith("/v1/oauth2/token"))
      return Response.json({ access_token: "test-access-token" });
    if (method === "POST") {
      const body = calls.at(-1)!.body as {
        tracking_id: string;
        partner_config_override: { return_url: string };
      };
      tracking = body.tracking_id;
      returned = body.partner_config_override.return_url;
      return Response.json({ links: links() }, { status: 201 });
    }
    if (url.includes("partner-referrals/"))
      return Response.json({ tracking_id: tracking, links: links() });
    if (defer) await defer;
    if (url.includes("?tracking_id="))
      return Response.json({ merchant_integrations: [valid()] });
    return Response.json({ ...valid(), ...details });
  });
  return {
    request,
    calls,
    get returnUrl() {
      return returned;
    },
    get tracking() {
      return tracking;
    },
    setDetails(value: Record<string, unknown>) {
      details = value;
    },
    setApproval(value: string) {
      approval = value;
    },
    fail() {
      fail = true;
    },
    denyReferral() {
      deniedReferral = true;
    },
    delay(value: Promise<void>) {
      defer = value;
    },
  };
}
function command(name = "A real operator business label") {
  return { name, requestId: randomUUID(), consent: true as const };
}
function callback(p: ReturnType<typeof provider>) {
  const url = new URL(p.returnUrl);
  url.searchParams.set("merchantId", p.tracking);
  url.searchParams.set("merchantIdInPayPal", "MERCHANT12345");
  url.searchParams.set("permissionsGranted", "true");
  url.searchParams.set("consentStatus", "true");
  url.searchParams.set("isEmailConfirmed", "true");
  return url;
}
it("requires separate approved partner configuration and explicit consent without making a request or faking a business", async () => {
  const request = vi.fn<typeof fetch>();
  const count = onboarding.listBusinesses().length;
  const env = { ...partnerEnv, PAYPAL_PARTNER_CLIENT_SECRET: "" };
  expect(onboarding.partnerSetup(env)).toMatchObject({
    ready: false,
    missing: ["PAYPAL_PARTNER_CLIENT_SECRET"],
    mode: "sandbox",
  });
  await expect(
    onboarding.createBusinessConnection(command(), { env, fetch: request }),
  ).rejects.toMatchObject({ code: "PARTNER_SETUP_REQUIRED", status: 503 });
  await expect(
    onboarding.createBusinessConnection(
      { ...command(), consent: false },
      { env: partnerEnv, fetch: request },
    ),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(onboarding.listBusinesses()).toHaveLength(count);
});
it("creates a real sandbox referral contract, keeps credentials server-side, and reuses a request ID", async () => {
  const p = provider(),
    input = command();
  const created = await onboarding.createBusinessConnection(input, {
    env: partnerEnv,
    fetch: p.request,
  });
  expect(created.business).toMatchObject({
    name: input.name,
    status: "pending",
    merchantId: null,
    verifiedAt: null,
    mode: "sandbox",
  });
  expect(created.approvalUrl).toContain("https://www.sandbox.paypal.com/");
  const posted = p.calls.find(
    (call) => call.method === "POST" && call.url.endsWith("partner-referrals"),
  )!;
  expect(posted.headers.get("paypal-request-id")).toBe(input.requestId);
  expect(posted.headers.get("paypal-partner-attribution-id")).toBe("TEST_BN");
  expect(posted.body).toMatchObject({
    tracking_id: created.business.trackingId,
    products: ["EXPRESS_CHECKOUT"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    operations: [
      {
        operation: "API_INTEGRATION",
        api_integration_preference: {
          rest_api_integration: {
            integration_method: "PAYPAL",
            integration_type: "THIRD_PARTY",
            third_party_details: { features: ["PAYMENT", "REFUND"] },
          },
        },
      },
    ],
  });
  expect(p.returnUrl).toContain(
    "https://sundown.example/api/paypal/onboarding/return?state=",
  );
  const state = new URL(p.returnUrl).searchParams.get("state")!;
  const database = new DatabaseSync(
    path.join(directory, "workspace/sundown.sqlite"),
    { readOnly: true },
  );
  const row = database
    .prepare("SELECT * FROM business_connections WHERE id=?")
    .get(created.business.id)!;
  database.close();
  expect(row.state_hash).toBe(createHash("sha256").update(state).digest("hex"));
  expect(JSON.stringify(row)).not.toContain(state);
  expect(JSON.stringify(row)).not.toContain(
    partnerEnv.PAYPAL_PARTNER_CLIENT_SECRET,
  );
  expect(JSON.stringify(row)).not.toContain("test-access-token");
  const repeated = await onboarding.createBusinessConnection(input, {
    env: partnerEnv,
    fetch: p.request,
  });
  expect(repeated.business.id).toBe(created.business.id);
  expect(p.request).toHaveBeenCalledTimes(2);
  await expect(
    onboarding.createBusinessConnection(input, {
      env: {
        ...partnerEnv,
        PAYPAL_PARTNER_CLIENT_ID: "a-different-partner-client",
      },
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "PARTNER_IDENTITY_CHANGED" });
  expect(p.request).toHaveBeenCalledTimes(2);
  await expect(
    onboarding.createBusinessConnection(
      { ...input, name: "Different business" },
      { env: partnerEnv, fetch: p.request },
    ),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
});
it("retains PayPal's safe permission error/debug ID without storing raw upstream personal data or credentials", async () => {
  const p = provider();
  p.denyReferral();
  await expect(
    onboarding.createBusinessConnection(command(), {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    upstreamStatus: 403,
    debugId: "DEBUG123",
  });
  const business = onboarding.listBusinesses()[0];
  expect(business).toMatchObject({
    status: "unavailable",
    lastError: {
      code: "PERMISSION_DENIED",
      httpStatus: 403,
      debugId: "DEBUG123",
    },
  });
  expect(JSON.stringify(business)).not.toContain(
    "private-email@example.invalid",
  );
  expect(JSON.stringify(business)).not.toContain(
    partnerEnv.PAYPAL_PARTNER_CLIENT_SECRET,
  );
});
it.each([
  "https://www.paypal.com/bizsignup?token=x",
  "https://attacker.invalid/?token=x",
  "http://www.sandbox.paypal.com/?token=x",
  "https://user:password@www.sandbox.paypal.com/?token=x",
])(
  "rejects off-sandbox or credential-bearing referral URLs: %s",
  async (url) => {
    const p = provider();
    p.setApproval(url);
    await expect(
      onboarding.createBusinessConnection(command(), {
        env: partnerEnv,
        fetch: p.request,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PARTNER_RESPONSE" });
    expect(onboarding.listBusinesses()[0].status).toBe("unavailable");
  },
);
it("does not accept successful browser flags without server-confirmed merchant permissions and email", async () => {
  const p = provider();
  p.setDetails({ primary_email_confirmed: false, oauth_integrations: [] });
  const created = await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
  });
  expect(
    await onboarding.completePartnerOnboarding(callback(p), {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).toBe("pending");
  expect(
    onboarding.listBusinesses().find((b) => b.id === created.business.id),
  ).toMatchObject({
    status: "pending",
    paymentsReceivable: true,
    emailConfirmed: false,
    permissionsGranted: false,
  });
});
it("connects only server-verified matching identities/grants; treats the public return as one-time", async () => {
  const p = provider(),
    created = await onboarding.createBusinessConnection(command(), {
      env: partnerEnv,
      fetch: p.request,
    });
  const url = callback(p);
  url.searchParams.set("permissionsGranted", "false");
  expect(
    await onboarding.completePartnerOnboarding(url, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).toBe("connected");
  expect(
    onboarding.listBusinesses().find((b) => b.id === created.business.id),
  ).toMatchObject({
    status: "connected",
    merchantId: "MERCHANT12345",
    paymentsReceivable: true,
    emailConfirmed: true,
    permissionsGranted: true,
  });
  const calls = p.request.mock.calls.length;
  await expect(
    onboarding.completePartnerOnboarding(url, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
  expect(p.request).toHaveBeenCalledTimes(calls);
  p.fail();
  await expect(
    onboarding.verifyBusinessConnection(created.business.id, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toThrow();
  expect(
    onboarding.listBusinesses().find((b) => b.id === created.business.id),
  ).toMatchObject({
    status: "connected",
    lastError: { code: "PARTNER_AUTH_REJECTED" },
  });
});
it.each(["merchant", "tracking", "partner", "scopes"])(
  "cannot connect when server %s identity or grants mismatch",
  async (kind) => {
    const p = provider(),
      created = await onboarding.createBusinessConnection(command(), {
        env: partnerEnv,
        fetch: p.request,
      });
    if (kind === "merchant") p.setDetails({ merchant_id: "OTHER123456" });
    if (kind === "tracking")
      p.setDetails({ tracking_id: "unrelated-tracking" });
    if (kind === "partner")
      p.setDetails({
        oauth_integrations: [
          {
            integration_type: "OAUTH_THIRD_PARTY",
            integration_method: "PAYPAL",
            oauth_third_party: [
              {
                partner_client_id: "different-client",
                scopes: [
                  "https://uri.paypal.com/services/payments/refund",
                  "https://uri.paypal.com/services/payments/payment/authcapture",
                ],
              },
            ],
          },
        ],
      });
    if (kind === "scopes")
      p.setDetails({
        oauth_integrations: [
          {
            integration_type: "OAUTH_THIRD_PARTY",
            integration_method: "PAYPAL",
            oauth_third_party: [
              {
                partner_client_id: partnerEnv.PAYPAL_PARTNER_CLIENT_ID,
                scopes: [
                  "https://uri.paypal.com/services/payments/payment/authcapture",
                ],
              },
            ],
          },
        ],
      });
    if (["merchant", "tracking"].includes(kind))
      await expect(
        onboarding.completePartnerOnboarding(callback(p), {
          env: partnerEnv,
          fetch: p.request,
        }),
      ).rejects.toMatchObject({ code: "MERCHANT_IDENTITY_MISMATCH" });
    else
      expect(
        await onboarding.completePartnerOnboarding(callback(p), {
          env: partnerEnv,
          fetch: p.request,
        }),
      ).toBe("pending");
    expect(
      onboarding.listBusinesses().find((b) => b.id === created.business.id)
        ?.status,
    ).not.toBe("connected");
  },
);
it("uses a tracking-id lookup when PayPal's details payload omits tracking_id", async () => {
  const p = provider();
  p.setDetails({ tracking_id: undefined });
  await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
  });
  expect(
    await onboarding.completePartnerOnboarding(callback(p), {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).toBe("connected");
  expect(p.calls.some((call) => call.url.includes("?tracking_id="))).toBe(true);
});
it("rejects expired, forged and tracking-mismatched state without querying PayPal", async () => {
  const p = provider(),
    start = Date.now();
  await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
    now: () => start,
  });
  const original = callback(p),
    calls = p.request.mock.calls.length;
  const forged = new URL(original);
  forged.searchParams.set(
    "state",
    original.searchParams.get("state")!.slice(0, -1) +
      (original.searchParams.get("state")!.endsWith("f") ? "a" : "f"),
  );
  await expect(
    onboarding.completePartnerOnboarding(forged, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
  const mismatched = new URL(original);
  mismatched.searchParams.set("merchantId", "some-other-tracking");
  await expect(
    onboarding.completePartnerOnboarding(mismatched, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
  await expect(
    onboarding.completePartnerOnboarding(original, {
      env: partnerEnv,
      fetch: p.request,
      now: () => start + 31 * 60 * 1000,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
  expect(p.request).toHaveBeenCalledTimes(calls);
});
it("atomically claims callbacks and prevents concurrent/replayed verification requests", async () => {
  const p = provider();
  const created = await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  p.delay(gate);
  const pending = onboarding.completePartnerOnboarding(callback(p), {
    env: partnerEnv,
    fetch: p.request,
  });
  await vi.waitFor(() =>
    expect(
      p.calls.some((call) => call.url.includes("merchant-integrations/")),
    ).toBe(true),
  );
  await expect(
    onboarding.completePartnerOnboarding(callback(p), {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CALLBACK" });
  await expect(
    onboarding.verifyBusinessConnection(created.business.id, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
  release();
  expect(await pending).toBe("connected");
});
it("refreshes a still-valid referral link only through its retained PayPal self identity", async () => {
  const p = provider();
  const created = await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
  });
  p.setApproval(
    "https://www.sandbox.paypal.com/bizsignup/partner/entry?token=NEW-PAYPAL-REFERRAL",
  );
  expect(
    (
      await onboarding.resumeBusinessConnection(created.business.id, {
        env: partnerEnv,
        fetch: p.request,
      })
    ).approvalUrl,
  ).toContain("NEW-PAYPAL-REFERRAL");
  expect(p.calls.at(-1)?.url).toBe(
    "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/REFERRAL123",
  );
  await onboarding.completePartnerOnboarding(callback(p), {
    env: partnerEnv,
    fetch: p.request,
  });
  await expect(
    onboarding.resumeBusinessConnection(created.business.id, {
      env: partnerEnv,
      fetch: p.request,
    }),
  ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
});
it("public callback redirects contain only a safe result, and admin APIs never expose credentials", async () => {
  const p = provider();
  const created = await onboarding.createBusinessConnection(command(), {
    env: partnerEnv,
    fetch: p.request,
  });
  vi.stubGlobal("fetch", p.request);
  const route = await import("../app/api/paypal/onboarding/return/route");
  const response = await route.GET(new Request(callback(p)));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://sundown.example/onboarding/result?status=connected",
  );
  const again = await route.GET(new Request(callback(p)));
  expect(again.headers.get("location")).toBe(
    "https://sundown.example/onboarding/result?status=invalid",
  );
  const api = await import("../app/api/businesses/route");
  const result = await api.GET().json();
  expect(
    result.businesses.some((b: { id: string }) => b.id === created.business.id),
  ).toBe(true);
  for (const secret of [
    partnerEnv.PAYPAL_PARTNER_CLIENT_SECRET,
    "test-access-token",
    new URL(p.returnUrl).searchParams.get("state")!,
  ])
    expect(JSON.stringify(result)).not.toContain(secret);
  const denied = await api.POST(
    new Request("https://sundown.example/api/businesses", {
      method: "POST",
      body: JSON.stringify({ action: "create", ...command(), consent: false }),
    }),
  );
  expect(denied.status).toBe(400);
});
