/** Sandbox Partner Referrals. Merchant consent is verified through PayPal, never browser flags. */
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { root } from "./store";
import { openDatabase, initializeSchema } from "./database";
const db = openDatabase(path.join(root, "workspace/sundown.sqlite"));
initializeSchema(
  db,
  `CREATE TABLE IF NOT EXISTS business_connections(
 id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 tracking_id TEXT UNIQUE NOT NULL, partner_id TEXT NOT NULL, client_hash TEXT NOT NULL,
 state_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, consumed INTEGER,
 approval_url TEXT, candidate_merchant_id TEXT, data TEXT NOT NULL,
 verify_until INTEGER NOT NULL DEFAULT 0, verify_owner TEXT);
 CREATE TABLE IF NOT EXISTS business_connection_referrals(id TEXT PRIMARY KEY, referral_id TEXT NOT NULL)`,
);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const keys = [
  "PAYPAL_PARTNER_CLIENT_ID",
  "PAYPAL_PARTNER_CLIENT_SECRET",
  "PAYPAL_PARTNER_ID",
  "PAYPAL_PARTNER_BN_CODE",
] as const;
const merchantId = z.string().regex(/^[A-Z0-9]{5,32}$/);
type Env = Record<string, string | undefined>;
type Dependencies = { fetch?: typeof fetch; env?: Env; now?: () => number };
export interface BusinessConnection {
  id: string;
  name: string;
  status: "pending" | "connected" | "unavailable";
  mode: "sandbox";
  trackingId: string;
  merchantId: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  reason: string | null;
  paymentsReceivable: boolean;
  emailConfirmed: boolean;
  permissionsGranted: boolean;
  lastError?: {
    code: string;
    message: string;
    httpStatus?: number;
    debugId?: string;
  };
}
export class PartnerOnboardingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public debugId?: string,
    public upstreamStatus?: number,
  ) {
    super(message);
  }
}
export function partnerSetup(env: Env = process.env) {
  const missing: string[] = keys.filter((key) => !env[key]?.trim());
  if (
    env.PAYPAL_PARTNER_ID &&
    !merchantId.safeParse(env.PAYPAL_PARTNER_ID).success
  )
    missing.push("PAYPAL_PARTNER_ID");
  try {
    applicationOrigin(env);
  } catch {
    missing.push("SUNDOWN_APP_URL");
  }
  return {
    ready: missing.length === 0,
    missing: [...new Set(missing)],
    mode: "sandbox" as const,
    requirement:
      "Approved PayPal partner access is required. Standard checkout credentials cannot substitute for partner credentials.",
  };
}
function applicationOrigin(env: Env) {
  const url = new URL(
    env.SUNDOWN_APP_URL ||
      (env.NODE_ENV !== "production" ? "http://localhost:3000" : ""),
  );
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Invalid callback origin");
  return url.origin;
}
function configured(env: Env) {
  if (!partnerSetup(env).ready)
    throw new PartnerOnboardingError(
      "PARTNER_SETUP_REQUIRED",
      "Configure approved sandbox partner credentials and the application URL before connecting a business.",
      503,
    );
  return env as Env & Record<(typeof keys)[number], string>;
}
interface Row {
  id: string;
  request_id: string;
  name: string;
  tracking_id: string;
  partner_id: string;
  client_hash: string;
  state_hash: string;
  expires: number;
  consumed: number | null;
  approval_url: string | null;
  candidate_merchant_id: string | null;
  data: string;
  verify_until: number;
  verify_owner: string | null;
}
const rowById = (id: string) =>
  db
    .prepare("SELECT * FROM business_connections WHERE id=?")
    .get(id) as unknown as Row | undefined;
const publicConnection = (row: Row): BusinessConnection => JSON.parse(row.data);
export function listBusinesses(): BusinessConnection[] {
  return (
    db
      .prepare(
        "SELECT * FROM business_connections ORDER BY rowid DESC LIMIT 100",
      )
      .all() as unknown as Row[]
  ).map(publicConnection);
}
function save(business: BusinessConnection) {
  db.prepare("UPDATE business_connections SET data=? WHERE id=?").run(
    JSON.stringify(business),
    business.id,
  );
}
function safeFailure(error: unknown) {
  return error instanceof PartnerOnboardingError
    ? error
    : new PartnerOnboardingError(
        "PARTNER_UPSTREAM_UNAVAILABLE",
        "PayPal partner onboarding could not be reached. No connection has been verified.",
        502,
      );
}
async function transport(deps: Dependencies) {
  const env = configured(deps.env || process.env),
    request = deps.fetch || fetch;
  let response: Response;
  try {
    response = await request(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              env.PAYPAL_PARTNER_CLIENT_ID +
                ":" +
                env.PAYPAL_PARTNER_CLIENT_SECRET,
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
  } catch {
    throw safeFailure(null);
  }
  if (!response.ok)
    throw new PartnerOnboardingError(
      "PARTNER_AUTH_REJECTED",
      `PayPal rejected sandbox partner authentication (HTTP ${response.status}).`,
      503,
      undefined,
      response.status,
    );
  const token = z
    .object({ access_token: z.string().min(1) })
    .safeParse(await response.json().catch(() => null));
  if (!token.success) throw safeFailure(null);
  return async (
    endpoint: string,
    body?: unknown,
    requestId?: string,
  ): Promise<unknown> => {
    if (
      !/^\/v2\/customer\/partner-referrals(?:\/[A-Za-z0-9_-]{1,128})?$/.test(
        endpoint,
      ) &&
      !/^\/v1\/customer\/partners\/[A-Z0-9]{5,32}\/merchant-integrations(?:\/[A-Z0-9]{5,32}|\?tracking_id=[A-Za-z0-9%-]+)$/.test(
        endpoint,
      )
    )
      throw new PartnerOnboardingError(
        "INVALID_PARTNER_ENDPOINT",
        "Unsupported partner API endpoint",
      );
    let result: Response;
    try {
      result = await request("https://api-m.sandbox.paypal.com" + endpoint, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token.data.access_token,
          "Content-Type": "application/json",
          "PayPal-Partner-Attribution-Id": env.PAYPAL_PARTNER_BN_CODE,
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw safeFailure(null);
    }
    if (!result.ok) {
      const error = z
        .object({
          name: z
            .string()
            .regex(/^[A-Z][A-Z0-9_]{0,60}$/)
            .optional(),
          debug_id: z
            .string()
            .regex(/^[A-Za-z0-9-]{1,100}$/)
            .optional(),
        })
        .safeParse(await result.json().catch(() => null));
      throw new PartnerOnboardingError(
        (error.success && error.data.name) || "PARTNER_API_REJECTED",
        result.status === 403
          ? "PayPal denied partner API access. This app needs approved Partner Referrals access."
          : `PayPal partner API rejected the request (HTTP ${result.status}).`,
        result.status === 404 ? 409 : 502,
        error.success ? error.data.debug_id : undefined,
        result.status,
      );
    }
    return result.json();
  };
}
const createInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    requestId: z.uuid(),
    consent: z.literal(true),
  })
  .strict();
export async function createBusinessConnection(
  input: unknown,
  deps: Dependencies = {},
) {
  const value = createInput.parse(input),
    env = configured(deps.env || process.env),
    now = (deps.now || Date.now)();
  const previous = db
    .prepare("SELECT * FROM business_connections WHERE request_id=?")
    .get(value.requestId) as unknown as Row | undefined;
  if (previous) return existing(previous, value.name, env, now);
  const id = randomUUID(),
    trackingId = "SD-" + randomUUID(),
    nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", env.PAYPAL_PARTNER_CLIENT_SECRET)
    .update(`${id}.${nonce}.${trackingId}`)
    .digest("hex");
  const state = `${id}.${nonce}.${signature}`;
  const business: BusinessConnection = {
    id,
    name: value.name,
    status: "pending",
    mode: "sandbox",
    trackingId,
    merchantId: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    verifiedAt: null,
    reason: "Waiting for the merchant to authorize Sundown on PayPal sandbox.",
    paymentsReceivable: false,
    emailConfirmed: false,
    permissionsGranted: false,
  };
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO business_connections(id,request_id,name,tracking_id,partner_id,client_hash,state_hash,expires,data) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      value.requestId,
      value.name,
      trackingId,
      env.PAYPAL_PARTNER_ID,
      hash(env.PAYPAL_PARTNER_CLIENT_ID),
      hash(state),
      now + 30 * 60 * 1000,
      JSON.stringify(business),
    );
  if (!inserted.changes)
    return existing(
      db
        .prepare("SELECT * FROM business_connections WHERE request_id=?")
        .get(value.requestId) as unknown as Row,
      value.name,
      env,
      now,
    );
  try {
    const call = await transport(deps);
    const result = z
      .object({
        links: z.array(z.object({ rel: z.string(), href: z.string().url() })),
      })
      .parse(
        await call(
          "/v2/customer/partner-referrals",
          {
            tracking_id: trackingId,
            partner_config_override: {
              return_url:
                applicationOrigin(env) +
                "/api/paypal/onboarding/return?state=" +
                encodeURIComponent(state),
              return_url_description: "Return to Sundown",
            },
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
            products: ["EXPRESS_CHECKOUT"],
            legal_consents: [
              { type: "SHARE_DATA_CONSENT", granted: value.consent },
            ],
          },
          value.requestId,
        ),
      );
    const approval = validatedApproval(result.links);
    const self = result.links.find((link) => link.rel === "self")?.href;
    if (!self)
      throw new PartnerOnboardingError(
        "INVALID_PARTNER_RESPONSE",
        "PayPal did not return a referral identity.",
        502,
      );
    const referralUrl = new URL(self);
    if (
      ![
        "https://api-m.sandbox.paypal.com",
        "https://api.sandbox.paypal.com",
      ].includes(referralUrl.origin) ||
      !/^\/v2\/customer\/partner-referrals\/[A-Za-z0-9_-]{1,128}$/.test(
        referralUrl.pathname,
      ) ||
      referralUrl.search ||
      referralUrl.hash ||
      referralUrl.username ||
      referralUrl.password
    )
      throw new PartnerOnboardingError(
        "INVALID_PARTNER_RESPONSE",
        "PayPal returned an unexpected referral identity.",
        502,
      );
    db.prepare(
      "INSERT INTO business_connection_referrals(id,referral_id) VALUES(?,?)",
    ).run(id, referralUrl.pathname.split("/").at(-1)!);
    db.prepare("UPDATE business_connections SET approval_url=? WHERE id=?").run(
      approval,
      id,
    );
    return { business, approvalUrl: approval };
  } catch (error) {
    const failure = safeFailure(error);
    business.status = "unavailable";
    business.reason = failure.message;
    business.lastError = {
      code: failure.code,
      message: failure.message,
      httpStatus: failure.upstreamStatus ?? failure.status,
      ...(failure.debugId ? { debugId: failure.debugId } : {}),
    };
    save(business);
    throw failure;
  }
}
function validatedApproval(links: { rel: string; href: string }[]) {
  const approval = links.find((link) => link.rel === "action_url")?.href;
  if (!approval)
    throw new PartnerOnboardingError(
      "INVALID_PARTNER_RESPONSE",
      "PayPal did not return a merchant signup link.",
      502,
    );
  const url = new URL(approval);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sandbox.paypal.com" ||
    url.username ||
    url.password
  )
    throw new PartnerOnboardingError(
      "INVALID_PARTNER_RESPONSE",
      "PayPal returned an unexpected merchant signup link.",
      502,
    );
  return approval;
}
export async function resumeBusinessConnection(
  id: string,
  deps: Dependencies = {},
) {
  z.uuid().parse(id);
  const env = configured(deps.env || process.env),
    now = (deps.now || Date.now)();
  const row = rowById(id);
  if (!row)
    throw new PartnerOnboardingError(
      "BUSINESS_NOT_FOUND",
      "Business connection not found.",
      404,
    );
  if (
    row.partner_id !== env.PAYPAL_PARTNER_ID ||
    row.client_hash !== hash(env.PAYPAL_PARTNER_CLIENT_ID)
  )
    throw new PartnerOnboardingError(
      "PARTNER_IDENTITY_CHANGED",
      "The partner configuration changed. Start a new onboarding request.",
      409,
    );
  if (row.consumed !== null || row.expires <= now)
    throw new PartnerOnboardingError(
      "INVITATION_EXPIRED",
      "This invitation expired or already returned from PayPal. Check merchant status, or start a new invitation.",
      409,
    );
  const referral = db
    .prepare("SELECT referral_id FROM business_connection_referrals WHERE id=?")
    .get(id);
  if (!referral)
    throw new PartnerOnboardingError(
      "INVITATION_UNAVAILABLE",
      "This invitation has no retained PayPal referral. Start a new invitation.",
      409,
    );
  const call = await transport(deps);
  const result = z
    .object({
      tracking_id: z.literal(row.tracking_id),
      links: z.array(z.object({ rel: z.string(), href: z.string().url() })),
    })
    .parse(
      await call(
        "/v2/customer/partner-referrals/" + String(referral.referral_id),
      ),
    );
  const approvalUrl = validatedApproval(result.links);
  db.prepare("UPDATE business_connections SET approval_url=? WHERE id=?").run(
    approvalUrl,
    id,
  );
  return { business: publicConnection(row), approvalUrl };
}
function existing(row: Row, name: string, env: Env, now: number) {
  if (row.name !== name)
    throw new PartnerOnboardingError(
      "REQUEST_CONFLICT",
      "This request ID was already used for a different business.",
      409,
    );
  if (
    row.partner_id !== env.PAYPAL_PARTNER_ID ||
    row.client_hash !== hash(env.PAYPAL_PARTNER_CLIENT_ID || "")
  )
    throw new PartnerOnboardingError(
      "PARTNER_IDENTITY_CHANGED",
      "The partner configuration changed. Start a new onboarding request.",
      409,
    );
  const business = publicConnection(row);
  if (
    business.status === "pending" &&
    !row.approval_url &&
    row.consumed === null
  )
    throw new PartnerOnboardingError(
      "REQUEST_IN_PROGRESS",
      "This onboarding request is still being created.",
      409,
    );
  return {
    business,
    approvalUrl:
      row.consumed === null && row.expires > now ? row.approval_url : null,
  };
}
const integrationSchema = z.object({
  merchant_id: merchantId,
  tracking_id: z.string().optional(),
  payments_receivable: z.boolean(),
  primary_email_confirmed: z.boolean(),
  products: z
    .array(z.object({ name: z.string(), status: z.string().optional() }))
    .default([]),
  oauth_integrations: z
    .array(
      z.object({
        integration_type: z.string(),
        integration_method: z.string(),
        oauth_third_party: z
          .array(
            z.object({
              partner_client_id: z.string(),
              scopes: z.array(z.string()),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});
async function verify(row: Row, candidate: string, deps: Dependencies) {
  const env = configured(deps.env || process.env),
    now = (deps.now || Date.now)();
  if (
    row.partner_id !== env.PAYPAL_PARTNER_ID ||
    row.client_hash !== hash(env.PAYPAL_PARTNER_CLIENT_ID)
  )
    throw new PartnerOnboardingError(
      "PARTNER_IDENTITY_CHANGED",
      "The partner configuration changed. Start a new onboarding request.",
      409,
    );
  const owner = randomUUID();
  if (
    !db
      .prepare(
        "UPDATE business_connections SET verify_until=?,verify_owner=? WHERE id=? AND verify_until<=?",
      )
      .run(now + 60000, owner, row.id, now).changes
  )
    throw new PartnerOnboardingError(
      "REQUEST_IN_PROGRESS",
      "A PayPal status check is already in progress.",
      409,
    );
  const business = publicConnection(row);
  try {
    const call = await transport(deps),
      endpoint = `/v1/customer/partners/${env.PAYPAL_PARTNER_ID}/merchant-integrations`;
    const observed = integrationSchema.parse(
      await call(endpoint + "/" + merchantId.parse(candidate)),
    );
    let tracking = observed.tracking_id;
    if (!tracking) {
      const data = await call(
        endpoint + "?tracking_id=" + encodeURIComponent(row.tracking_id),
      );
      const direct = integrationSchema.safeParse(data);
      const listing = z
        .object({ merchant_integrations: z.array(integrationSchema) })
        .safeParse(data);
      const match = direct.success
        ? direct.data
        : listing.success
          ? listing.data.merchant_integrations.find(
              (value) => value.merchant_id === candidate,
            )
          : undefined;
      if (match?.merchant_id === candidate) tracking = match.tracking_id;
    }
    if (observed.merchant_id !== candidate || tracking !== row.tracking_id)
      throw new PartnerOnboardingError(
        "MERCHANT_IDENTITY_MISMATCH",
        "PayPal could not verify this merchant against the onboarding request.",
        409,
      );
    const granted = observed.oauth_integrations.some(
      (integration) =>
        integration.integration_type === "OAUTH_THIRD_PARTY" &&
        integration.integration_method === "PAYPAL" &&
        integration.oauth_third_party.some(
          (grant) =>
            grant.partner_client_id === env.PAYPAL_PARTNER_CLIENT_ID &&
            grant.scopes.includes(
              "https://uri.paypal.com/services/payments/refund",
            ) &&
            (grant.scopes.includes(
              "https://uri.paypal.com/services/payments/payment/authcapture",
            ) ||
              grant.scopes.includes(
                "https://uri.paypal.com/services/payments/realtimepayment",
              )),
        ),
    );
    business.merchantId = observed.merchant_id;
    business.paymentsReceivable = observed.payments_receivable;
    business.emailConfirmed = observed.primary_email_confirmed;
    business.permissionsGranted = granted;
    business.status =
      business.paymentsReceivable &&
      business.emailConfirmed &&
      granted &&
      observed.products.some(
        (product) =>
          product.name === "EXPRESS_CHECKOUT" && product.status === "ACTIVE",
      )
        ? "connected"
        : "pending";
    business.reason =
      business.status === "connected"
        ? "PayPal sandbox verified this merchant's payment/refund permissions. No payments or migration evidence have been imported."
        : "PayPal onboarding is not complete. Confirm the seller email, permissions and payment eligibility on PayPal, then check status again.";
    business.verifiedAt = new Date(now).toISOString();
    business.updatedAt = new Date(now).toISOString();
    delete business.lastError;
    save(business);
    return business;
  } catch (error) {
    const failure = safeFailure(error);
    if (business.status !== "connected") {
      business.status = "unavailable";
      business.reason = failure.message;
    }
    business.lastError = {
      code: failure.code,
      message: failure.message,
      httpStatus: failure.upstreamStatus ?? failure.status,
      ...(failure.debugId ? { debugId: failure.debugId } : {}),
    };
    business.updatedAt = new Date(now).toISOString();
    save(business);
    throw failure;
  } finally {
    db.prepare(
      "UPDATE business_connections SET verify_until=0,verify_owner=NULL WHERE id=? AND verify_owner=?",
    ).run(row.id, owner);
  }
}
export async function verifyBusinessConnection(
  id: string,
  deps: Dependencies = {},
) {
  z.uuid().parse(id);
  configured(deps.env || process.env);
  const row = rowById(id);
  if (!row)
    throw new PartnerOnboardingError(
      "BUSINESS_NOT_FOUND",
      "Business connection not found.",
      404,
    );
  if (!row.candidate_merchant_id)
    throw new PartnerOnboardingError(
      "APPROVAL_REQUIRED",
      "The merchant must return from PayPal before its connection can be verified.",
      409,
    );
  return verify(row, row.candidate_merchant_id, deps);
}
export async function completePartnerOnboarding(
  url: URL,
  deps: Dependencies = {},
): Promise<"connected" | "pending"> {
  const env = configured(deps.env || process.env),
    now = (deps.now || Date.now)();
  const state = z
    .string()
    .regex(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/)
    .safeParse(url.searchParams.get("state"));
  if (!state.success)
    throw new PartnerOnboardingError(
      "INVALID_CALLBACK",
      "The onboarding return is invalid or expired.",
    );
  const row = db
    .prepare("SELECT * FROM business_connections WHERE state_hash=?")
    .get(hash(state.data)) as unknown as Row | undefined;
  if (
    !row ||
    row.consumed !== null ||
    row.expires <= now ||
    url.searchParams.get("merchantId") !== row.tracking_id
  )
    throw new PartnerOnboardingError(
      "INVALID_CALLBACK",
      "The onboarding return is invalid or expired.",
    );
  const [id, nonce, provided] = state.data.split(".");
  const expected = createHmac("sha256", env.PAYPAL_PARTNER_CLIENT_SECRET)
    .update(`${id}.${nonce}.${row.tracking_id}`)
    .digest("hex");
  if (
    id !== row.id ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    throw new PartnerOnboardingError(
      "INVALID_CALLBACK",
      "The onboarding return is invalid or expired.",
    );
  const candidate = merchantId.safeParse(
    url.searchParams.get("merchantIdInPayPal"),
  );
  if (!candidate.success)
    throw new PartnerOnboardingError(
      "INVALID_CALLBACK",
      "PayPal did not return a valid merchant identity.",
    );
  if (
    !db
      .prepare(
        "UPDATE business_connections SET consumed=?,candidate_merchant_id=? WHERE id=? AND consumed IS NULL AND expires>?",
      )
      .run(now, candidate.data, row.id, now).changes
  )
    throw new PartnerOnboardingError(
      "INVALID_CALLBACK",
      "This onboarding return was already used.",
    );
  return (await verify(row, candidate.data, deps)).status === "connected"
    ? "connected"
    : "pending";
}
export function onboardingResultOrigin(env: Env = process.env) {
  return applicationOrigin(env);
}
