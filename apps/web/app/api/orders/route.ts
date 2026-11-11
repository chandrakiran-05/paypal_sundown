/** Server-priced sandbox checkout with browser ownership and durable provider request IDs. */
import { z } from "zod";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { products } from "@sundown/engine";
import {
  captureOrder,
  createOrder,
  refundCapture,
  moneySchema,
  paypalFailure,
  PaypalError,
} from "../../../lib/paypal";
import {
  claimed,
  ownOrder,
  saveCapture,
  saveOrder,
} from "../../../lib/checkout-store";
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    requestId: z.uuid(),
    productId: z.string(),
    quantity: z.number().int().min(1).max(10),
  }),
  z.object({
    action: z.literal("capture"),
    requestId: z.uuid(),
    id: z.string().regex(/^[A-Z0-9-]{5,64}$/),
  }),
  z.object({
    action: z.literal("refund"),
    requestId: z.uuid(),
    id: z.string().regex(/^[A-Z0-9-]{5,64}$/),
    amount: moneySchema,
  }),
]);
export async function POST(request: Request) {
  try {
    const data = commandSchema.parse(await request.json());
    if (process.env.PAYPAL_MODE !== "live")
      throw new PaypalError(
        "LIVE_REQUIRED",
        "Checkout requires live sandbox mode. Replay evidence is available in the workspace.",
        503,
      );
    const jar = await cookies();
    let owner = jar.get("sundown-checkout")?.value;
    if (!owner || !z.uuid().safeParse(owner).success) {
      owner = randomUUID();
      jar.set("sundown-checkout", owner, {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
    }
    const browserOwner = owner;
    if (data.action === "create") {
      const product = products.find((p) => p.id === data.productId);
      if (!product)
        throw new PaypalError(
          "INVALID_PRODUCT",
          "Unknown catalog product.",
          400,
        );
      const amount = (
        (Math.round(Number(product.price) * 100) * data.quantity) /
        100
      ).toFixed(2);
      const origin = new URL(request.url).origin;
      const result = await claimed(
        "create:" + owner + ":" + data.requestId,
        JSON.stringify({ productId: data.productId, quantity: data.quantity }),
        data.requestId,
        async (key) => {
          try {
            const order = await createOrder(key, {
              amount,
              currency: "USD",
              returnUrl: origin + "/checkout",
              cancelUrl: origin + "/checkout?cancelled=1",
            });
            const approval = order.links?.find(
              (l) => l.rel === "payer-action" || l.rel === "approve",
            )?.href;
            if (!order.id || !approval)
              throw new PaypalError(
                "INVALID_RESPONSE",
                "Sandbox did not return an approval link. Reuse this request ID.",
                502,
              );
            const url = new URL(approval);
            if (
              url.protocol !== "https:" ||
              url.hostname !== "www.sandbox.paypal.com"
            )
              throw new PaypalError(
                "INVALID_APPROVAL",
                "Sandbox returned an unexpected approval URL.",
                502,
              );
            saveOrder(order.id, browserOwner, amount);
            return {
              id: order.id,
              approvalUrl: approval,
              amount,
              currency: "USD",
              mode: "live",
            };
          } catch (e) {
            throw paypalFailure(e);
          }
        },
      );
      return Response.json(result);
    }
    const order = ownOrder(data.id, owner);
    if (data.action === "capture") {
      return Response.json(
        await claimed(
          "capture:" + owner + ":" + order.id,
          "capture",
          data.requestId,
          async (key) => {
            try {
              const result = await captureOrder(order.id, key);
              const capture = result.purchaseUnits?.flatMap(
                (p) => p.payments?.captures ?? [],
              )[0];
              if (!capture?.id || capture.status !== "COMPLETED")
                throw new PaypalError(
                  "CAPTURE_PENDING",
                  "The sandbox capture is not complete. Check its status before retrying.",
                  409,
                );
              if (
                capture.amount?.value !== order.amount ||
                capture.amount.currencyCode !== "USD"
              )
                throw new PaypalError(
                  "AMOUNT_MISMATCH",
                  "Sandbox captured amount does not match the server-priced order.",
                  502,
                );
              saveCapture(order.id, capture.id, capture.status);
              return {
                id: order.id,
                captureId: capture.id,
                status: capture.status,
                amount: order.amount,
                currency: "USD",
                mode: "live",
              };
            } catch (e) {
              throw paypalFailure(e);
            }
          },
        ),
      );
    }
    if (!order.capture_id)
      throw new PaypalError(
        "NOT_CAPTURED",
        "Capture this order before refunding it.",
        409,
      );
    if (Number(data.amount) > Number(order.amount))
      throw new PaypalError(
        "REFUND_LIMIT",
        "Refund exceeds the original capture.",
        400,
      );
    return Response.json(
      await claimed(
        "refund:" + owner + ":" + order.id + ":" + data.requestId,
        data.amount,
        data.requestId,
        async (key) => {
          try {
            const refund = await refundCapture(
              order.capture_id!,
              key,
              data.amount,
            );
            if (!refund.id)
              throw new PaypalError(
                "INVALID_RESPONSE",
                "Sandbox refund response was incomplete.",
                502,
              );
            return {
              id: refund.id,
              status: refund.status,
              amount: refund.amount?.value,
              currency: "USD",
              mode: "live",
            };
          } catch (e) {
            throw paypalFailure(e);
          }
        },
      ),
    );
  } catch (error) {
    const failure =
      error instanceof z.ZodError
        ? new PaypalError("INVALID_INPUT", "Invalid checkout request.", 400)
        : paypalFailure(error);
    return Response.json(
      { error: failure.message, code: failure.code },
      { status: failure.status },
    );
  }
}
export async function GET(request: Request) {
  try {
    const owner = (await cookies()).get("sundown-checkout")?.value;
    const id = new URL(request.url).searchParams.get("id");
    if (!owner || !id)
      throw new PaypalError(
        "ORDER_NOT_FOUND",
        "No sandbox order selected.",
        404,
      );
    const order = ownOrder(id, owner);
    return Response.json({
      id: order.id,
      amount: order.amount,
      captureId: order.capture_id,
      status: order.status,
      mode: "live",
    });
  } catch (e) {
    const failure = paypalFailure(e);
    return Response.json(
      { error: failure.message },
      { status: failure.status },
    );
  }
}
