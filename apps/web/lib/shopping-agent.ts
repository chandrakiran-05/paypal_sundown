/** Deterministic shopping policy invokes the official PayPal Agent Toolkit's tool interface. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { z } from "zod";
import { products, scan } from "@sundown/engine";
import { root, snapshot, sourceFiles } from "./store";
import { claimed } from "./checkout-store";
import {
  applyShopWebhook,
  recordShopCapture,
  saveShopOrder,
  shopOrder,
} from "./agent-shop";
type ToolCall = (
  name: "create_order" | "pay_order" | "get_order",
  args: Record<string, unknown>,
  requestId: string,
) => Promise<unknown>;
export const sandboxAgentAvailable = () =>
  Boolean(
    process.env.PAYPAL_MODE === "live" &&
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_WEBHOOK_ID,
  );
export const legacyAttempt = () => {
  const findings = scan(sourceFiles());
  return {
    shop: "legacy",
    status: "failed",
    mode: "source-inspection",
    reason: findings.length
      ? "Legacy source exposes NVP/Payments Standard and IPN. The Orders v2 create_order tool cannot execute that checkout contract."
      : "Legacy source has no agent checkout adapter. No payment attempted.",
    findings: findings.map((f) => f.id),
  };
};
export const toolkitCall: ToolCall = async (name, args, requestId) => {
  if (!sandboxAgentAvailable())
    throw new Error("Sandbox credentials and PAYPAL_WEBHOOK_ID are required");
  const toolkit = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: { orders: { create: true, get: true, capture: true } },
      context: { sandbox: true, request_id: requestId, debug: false },
    },
  });
  if (!toolkit.getTools().some((t) => t.function.name === name))
    throw new Error("Toolkit tool unavailable");
  const result = await toolkit.handleToolCall({
    id: requestId,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  if (typeof result.content !== "string")
    throw new Error("Unexpected toolkit response");
  const parsed: unknown = JSON.parse(result.content);
  return parsed;
};
const orderResult = z.object({
  id: z.string().regex(/^[A-Z0-9]{5,64}$/),
  links: z
    .array(z.object({ rel: z.string(), href: z.string().url() }))
    .default([]),
});
const capturedResult = z.object({
  id: z.string().min(1),
  status: z.literal("COMPLETED"),
  purchase_units: z.array(
    z.object({
      payments: z.object({
        captures: z.array(
          z.object({
            id: z.string().min(1),
            status: z.literal("COMPLETED"),
            amount: z.object({
              value: z.literal("24.00"),
              currency_code: z.literal("USD"),
            }),
          }),
        ),
      }),
    }),
  ),
});
export async function startShoppingAgent(
  owner: string,
  mode: "sandbox" | "simulated",
  requestId: string,
  origin: string,
  call: ToolCall = toolkitCall,
) {
  const state = snapshot();
  if (!state.migrated || !state.checks.slice(0, 3).every((c) => c.pass))
    throw new Error(
      "Apply the migration before running the migrated-shop agent",
    );
  const legacy = legacyAttempt();
  const catalog = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        price: z.string(),
        currency: z.string(),
        inventory: z.number(),
      }),
    )
    .parse(
      JSON.parse(
        readFileSync(
          path.join(root, "workspace/migrated-shop/catalog.json"),
          "utf8",
        ),
      ),
    );
  const product = catalog.find((p) => p.id === products[0].id);
  if (
    !product ||
    product.price !== "24.00" ||
    product.currency !== "USD" ||
    product.inventory < 1
  )
    throw new Error(
      "Generated shop catalog no longer matches the demo intent: one available USD 24.00 cup",
    );
  return claimed(
    `agent-create:${owner}:${requestId}`,
    mode,
    requestId,
    async (stableId) => {
      if (
        mode === "sandbox" &&
        !sandboxAgentAvailable() &&
        call === toolkitCall
      )
        throw new Error(
          "Sandbox unavailable. Choose the labelled Simulated demo.",
        );
      let id: string,
        approval: string | null = null;
      if (mode === "simulated") id = `SIM-ORDER-${randomUUID()}`;
      else {
        const raw = await call(
          "create_order",
          {
            currencyCode: "USD",
            items: [
              {
                name: product.name,
                quantity: 1,
                itemCost: 24,
                itemTotal: 24,
                taxPercent: 0,
              },
            ],
            returnUrl: `${origin}/agent-demo?approved=1`,
            cancelUrl: `${origin}/agent-demo?cancelled=1`,
          },
          stableId,
        );
        const result = orderResult.parse(raw);
        id = result.id;
        const url = result.links.find(
          (l) => l.rel === "approve" || l.rel === "payer-action",
        )?.href;
        if (!url || new URL(url).hostname !== "www.sandbox.paypal.com")
          throw new Error("Toolkit did not return a sandbox approval link");
        approval = url;
      }
      saveShopOrder({
        id,
        owner,
        site_id: 1,
        mode,
        amount: "24.00",
        currency: "USD",
        capture_id: null,
        status: "CREATED",
        approval_url: approval,
        created: new Date().toISOString(),
      });
      if (mode === "simulated") {
        const captureId = `SIM-CAPTURE-${randomUUID()}`;
        recordShopCapture(id, captureId);
        applyShopWebhook(
          {
            id: `SIM-EVENT-${randomUUID()}`,
            event_type: "PAYMENT.CAPTURE.COMPLETED",
            resource: {
              id: captureId,
              status: "COMPLETED",
              amount: { value: "24.00", currency_code: "USD" },
              supplementary_data: { related_ids: { order_id: id } },
            },
          },
          "simulated",
        );
      }
      return {
        legacy,
        order: shopOrder(id, owner),
        steps:
          mode === "simulated"
            ? [
                "Simulated: create_order",
                "Simulated: buyer approval and pay_order",
                "Simulated: capture webhook delivered; shop DB marked PAID",
              ]
            : [
                "PayPal Agent Toolkit: create_order",
                "Buyer approval required",
                "Capture then await a verified PayPal webhook",
              ],
      };
    },
  );
}
export async function finishShoppingAgent(
  id: string,
  owner: string,
  call: ToolCall = toolkitCall,
) {
  const order = shopOrder(id, owner);
  if (order.mode !== "sandbox")
    throw new Error("Simulated orders cannot be captured in sandbox");
  if (order.capture_id || order.status === "PAID") return shopOrder(id, owner);
  await claimed(`agent-capture:${id}`, id, randomUUID(), async (requestId) => {
    const raw = await call("pay_order", { id }, requestId);
    const unwrapped = z.object({ response: z.unknown() }).safeParse(raw);
    const result = capturedResult.parse(
      unwrapped.success ? unwrapped.data.response : raw,
    );
    if (result.id !== id) throw new Error("Toolkit returned a different order");
    const captures = result.purchase_units.flatMap((u) => u.payments.captures);
    if (captures.length !== 1)
      throw new Error("Expected exactly one matching capture");
    recordShopCapture(id, captures[0].id);
    return { captureId: captures[0].id };
  });
  return shopOrder(id, owner);
}
