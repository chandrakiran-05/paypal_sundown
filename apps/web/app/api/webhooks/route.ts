/** Verify PayPal signatures before accepting unique event IDs; fail closed on transport errors. */
import { z } from "zod";
import {
  verifyWebhook,
  webhookEventSchema,
  paypalFailure,
} from "../../../lib/paypal";
import { acceptWebhook } from "../../../lib/store";
import { applyShopWebhook } from "../../../lib/agent-shop";
export async function POST(request: Request) {
  try {
    const event = webhookEventSchema.parse(await request.json());
    if (!(await verifyWebhook(event, request.headers)))
      return Response.json(
        { error: "Invalid webhook signature" },
        { status: 400 },
      );
    const shop = applyShopWebhook(event, "sandbox");
    return Response.json({
      accepted: true,
      duplicate: !acceptWebhook(event.id, event.event_type),
      shop,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "Invalid webhook event or signature metadata" },
        { status: 400 },
      );
    const failure = paypalFailure(error);
    return Response.json(
      { error: failure.message, code: failure.code },
      { status: failure.status },
    );
  }
}
