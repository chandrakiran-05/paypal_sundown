/** Sandbox PayPal integration grounded in APIMatic's installed context and SDK 2.5.0 source. */
import {
  ApiError,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  CheckoutPaymentIntent,
  PaypalExperienceUserAction,
} from "@paypal/paypal-server-sdk";
import type { OAuthToken } from "@paypal/paypal-server-sdk";
import { z } from "zod";
export class PaypalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "PaypalError";
  }
}
const credentialsSchema = z.object({
  PAYPAL_MODE: z.literal("live"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
});
export const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/)
  .refine((value) => Number(value) > 0, "Amount must be positive");
export interface CheckoutInput {
  amount: string;
  currency: "USD";
  returnUrl: string;
  cancelUrl: string;
}
export function buildSandboxClient(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = credentialsSchema.safeParse(env);
  if (!parsed.success)
    throw new PaypalError(
      "SANDBOX_CONFIGURATION",
      "Set PAYPAL_MODE=live and sandbox client credentials.",
      503,
    );
  return new Client({
    environment: Environment.Sandbox,
    timeout: 15000,
    clientCredentialsAuthCredentials: {
      oAuthClientId: parsed.data.PAYPAL_CLIENT_ID,
      oAuthClientSecret: parsed.data.PAYPAL_CLIENT_SECRET,
      oAuthClockSkew: 60,
    },
    httpClientOptions: {
      retryConfig: { maxNumberOfRetries: 0, maximumRetryWaitTime: 0 },
    },
  });
}
let shared: Client | undefined;
export function sandboxClient() {
  if (!credentialsSchema.safeParse(process.env).success)
    throw new PaypalError(
      "SANDBOX_CONFIGURATION",
      "Set PAYPAL_MODE=live and sandbox client credentials.",
      503,
    );
  return (shared ??= buildSandboxClient());
}
export function paypalFailure(error: unknown): PaypalError {
  if (error instanceof PaypalError) return error;
  if (error instanceof ApiError) {
    if (error.statusCode === 422)
      return new PaypalError(
        "PAYPAL_REJECTED",
        "PayPal could not complete this operation. Check approval, payment instrument and available balance.",
        422,
      );
    if (error.statusCode === 401 || error.statusCode === 403)
      return new PaypalError(
        "PAYPAL_AUTH",
        "Sandbox authentication or permissions were rejected.",
        502,
      );
    return new PaypalError(
      "PAYPAL_UPSTREAM",
      "PayPal sandbox is temporarily unavailable.",
      502,
    );
  }
  return new PaypalError(
    "PAYPAL_OUTCOME_UNKNOWN",
    "Sandbox response was not received. Retry with the same request ID to reconcile the outcome.",
    504,
  );
}
export function paypalOperations(client: Client) {
  return {
    async create(requestId: string, input: CheckoutInput) {
      moneySchema.parse(input.amount);
      const response = await new OrdersController(client).createOrder(
        {
          paypalRequestId: requestId,
          prefer: "return=representation",
          body: {
            intent: CheckoutPaymentIntent.Capture,
            purchaseUnits: [
              { amount: { currencyCode: input.currency, value: input.amount } },
            ],
            paymentSource: {
              paypal: {
                experienceContext: {
                  brandName: "Horizon Supply",
                  userAction: PaypalExperienceUserAction.PayNow,
                  returnUrl: input.returnUrl,
                  cancelUrl: input.cancelUrl,
                },
              },
            },
          },
        },
        { abortSignal: AbortSignal.timeout(30000) },
      );
      return response.result;
    },
    async capture(id: string, requestId: string) {
      return (
        await new OrdersController(client).captureOrder(
          { id, paypalRequestId: requestId, prefer: "return=representation" },
          { abortSignal: AbortSignal.timeout(30000) },
        )
      ).result;
    },
    async refund(id: string, requestId: string, amount: string) {
      moneySchema.parse(amount);
      return (
        await new PaymentsController(client).refundCapturedPayment(
          {
            captureId: id,
            paypalRequestId: requestId,
            prefer: "return=representation",
            body: { amount: { currencyCode: "USD", value: amount } },
          },
          { abortSignal: AbortSignal.timeout(30000) },
        )
      ).result;
    },
    async get(id: string) {
      return (
        await new OrdersController(client).getOrder(
          { id },
          { abortSignal: AbortSignal.timeout(30000) },
        )
      ).result;
    },
  };
}
export async function createOrder(requestId: string, input: CheckoutInput) {
  return paypalOperations(sandboxClient()).create(requestId, input);
}
export async function captureOrder(id: string, requestId: string) {
  return paypalOperations(sandboxClient()).capture(id, requestId);
}
export async function refundCapture(
  id: string,
  requestId: string,
  amount: string,
) {
  return paypalOperations(sandboxClient()).refund(id, requestId, amount);
}
export const webhookEventSchema = z
  .object({
    id: z.string().min(1),
    event_type: z.string().min(1),
    resource: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export const signatureSchema = z.object({
  auth_algo: z.string().min(1),
  cert_url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" &&
        url.hostname === "api.sandbox.paypal.com") ||
      (url.protocol === "https:" && url.hostname === "api-m.sandbox.paypal.com")
    );
  }),
  transmission_id: z.string().min(1),
  transmission_sig: z.string().min(1),
  transmission_time: z.iso.datetime(),
});
let verificationToken: Promise<OAuthToken> | undefined;
export async function verifyWebhook(
  event: unknown,
  headers: Headers,
  dependencies?: { client: Client; fetch: typeof fetch; webhookId: string },
) {
  webhookEventSchema.parse(event);
  const signature = signatureSchema.parse(
    Object.fromEntries(
      [
        "auth_algo",
        "cert_url",
        "transmission_id",
        "transmission_sig",
        "transmission_time",
      ].map((key) => [key, headers.get("paypal-" + key.replaceAll("_", "-"))]),
    ),
  );
  const client = dependencies?.client ?? sandboxClient();
  const webhookId = dependencies?.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId)
    throw new PaypalError(
      "WEBHOOK_CONFIGURATION",
      "Configure the sandbox webhook ID.",
      503,
    );
  const pending = dependencies
    ? client.clientCredentialsAuthManager.updateToken()
    : (verificationToken ??= client.clientCredentialsAuthManager.updateToken());
  let token: OAuthToken;
  try {
    token = await pending;
    if (client.clientCredentialsAuthManager.isExpired(token)) {
      verificationToken =
        client.clientCredentialsAuthManager.updateToken(token);
      token = await verificationToken;
    }
  } catch {
    verificationToken = undefined;
    throw new PaypalError(
      "PAYPAL_AUTH",
      "Sandbox webhook authentication failed.",
      502,
    );
  }
  const response = await (dependencies?.fetch ?? fetch)(
    "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...signature,
        webhook_id: webhookId,
        webhook_event: event,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new PaypalError(
      "WEBHOOK_UPSTREAM",
      "Sandbox signature verification unavailable.",
      502,
    );
  return (
    z
      .object({ verification_status: z.enum(["SUCCESS", "FAILURE"]) })
      .parse(await response.json()).verification_status === "SUCCESS"
  );
}
