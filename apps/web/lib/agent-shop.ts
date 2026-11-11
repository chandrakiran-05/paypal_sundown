/** Agent-demo shop persistence. Only a completed webhook moves an order to PAID. */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { z } from "zod";
import { root } from "./store";
const db = new DatabaseSync(path.join(root, "workspace/sundown.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS agent_shop_orders(
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, site_id INTEGER NOT NULL,
  mode TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL,
  capture_id TEXT, status TEXT NOT NULL, approval_url TEXT, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shop_webhooks(id TEXT PRIMARY KEY, mode TEXT NOT NULL, order_id TEXT NOT NULL)`);
export type ShopOrder = {
  id: string;
  owner: string;
  site_id: number;
  mode: "sandbox" | "simulated";
  amount: string;
  currency: string;
  capture_id: string | null;
  status: string;
  approval_url: string | null;
  created: string;
};
export function publicShopOrder(order: ShopOrder) {
  const { owner: _owner, ...publicOrder } = order;
  return publicOrder;
}
export function saveShopOrder(order: ShopOrder) {
  db.prepare(
    "INSERT OR IGNORE INTO agent_shop_orders VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    order.id,
    order.owner,
    order.site_id,
    order.mode,
    order.amount,
    order.currency,
    order.capture_id,
    order.status,
    order.approval_url,
    order.created,
  );
}
export function shopOrder(id: string, owner: string) {
  const order = db
    .prepare("SELECT * FROM agent_shop_orders WHERE id=? AND owner=?")
    .get(id, owner) as ShopOrder | undefined;
  if (!order) throw new Error("Order does not belong to this browser");
  return order;
}
export function siteOrders(siteId: number) {
  return db
    .prepare(
      "SELECT id,site_id,mode,amount,currency,capture_id,status,created FROM agent_shop_orders WHERE site_id=? ORDER BY created DESC LIMIT 20",
    )
    .all(siteId) as Omit<ShopOrder, "owner" | "approval_url">[];
}
export function recordShopCapture(id: string, captureId: string) {
  db.prepare(
    "UPDATE agent_shop_orders SET capture_id=?,status=CASE WHEN status='PAID' THEN status ELSE 'AWAITING_WEBHOOK' END WHERE id=? AND (capture_id IS NULL OR capture_id=?)",
  ).run(captureId, id, captureId);
}
export function sandboxSettlement(id: string) {
  const receipt = db
    .prepare(
      "SELECT id FROM shop_webhooks WHERE order_id=? AND mode='sandbox' LIMIT 1",
    )
    .get(id);
  return receipt
    ? { eventId: String(receipt.id).slice("sandbox:".length) }
    : null;
}
const captureEvent = z.object({
  id: z.string().min(1),
  event_type: z.literal("PAYMENT.CAPTURE.COMPLETED"),
  resource: z.object({
    id: z.string().min(1),
    status: z.literal("COMPLETED"),
    amount: z.object({ value: z.string(), currency_code: z.string() }),
    supplementary_data: z.object({
      related_ids: z.object({ order_id: z.string().min(1) }),
    }),
  }),
});
/** Caller MUST verify PayPal's signature for sandbox events. Simulations use a separate namespace. */
export function applyShopWebhook(
  input: unknown,
  mode: "sandbox" | "simulated",
) {
  const event = captureEvent.safeParse(input);
  if (!event.success) return { applied: false, duplicate: false };
  const e = event.data,
    r = e.resource;
  db.exec("BEGIN IMMEDIATE");
  try {
    const order = db
      .prepare("SELECT * FROM agent_shop_orders WHERE id=? AND mode=?")
      .get(r.supplementary_data.related_ids.order_id, mode) as
      ShopOrder | undefined;
    if (
      !order ||
      order.amount !== r.amount.value ||
      order.currency !== r.amount.currency_code ||
      (order.capture_id && order.capture_id !== r.id)
    ) {
      db.exec("COMMIT");
      return { applied: false, duplicate: false };
    }
    const inserted = db
      .prepare("INSERT OR IGNORE INTO shop_webhooks VALUES (?,?,?)")
      .run(`${mode}:${e.id}`, mode, order.id).changes;
    if (inserted)
      db.prepare(
        "UPDATE agent_shop_orders SET status='PAID',capture_id=? WHERE id=?",
      ).run(r.id, order.id);
    db.exec("COMMIT");
    return { applied: true, duplicate: !inserted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
