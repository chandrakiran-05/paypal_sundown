/** Durable sandbox ownership and idempotent write claims; no buyer or card data is stored. */
import { openDatabase, initializeSchema } from "./database";
import path from "node:path";
import { root } from "./store";
import { PaypalError } from "./paypal";
const db = openDatabase(path.join(root, "workspace/sundown.sqlite"));
initializeSchema(
  db,
  "CREATE TABLE IF NOT EXISTS checkout_orders(id TEXT PRIMARY KEY, owner TEXT NOT NULL, amount TEXT NOT NULL, capture_id TEXT, status TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paypal_claims(id TEXT PRIMARY KEY, payload TEXT NOT NULL, request_id TEXT NOT NULL, state TEXT NOT NULL, result TEXT, updated INTEGER NOT NULL)",
);
export function ownOrder(id: string, owner: string) {
  const row = db
    .prepare("SELECT * FROM checkout_orders WHERE id=? AND owner=?")
    .get(id, owner);
  if (!row)
    throw new PaypalError(
      "ORDER_NOT_FOUND",
      "This sandbox order does not belong to this browser.",
      404,
    );
  return row as {
    id: string;
    owner: string;
    amount: string;
    capture_id: string | null;
    status: string;
  };
}
export function saveOrder(id: string, owner: string, amount: string) {
  db.prepare(
    "INSERT OR IGNORE INTO checkout_orders(id,owner,amount,status) VALUES (?,?,?,'CREATED')",
  ).run(id, owner, amount);
}
export function saveCapture(id: string, capture: string, status: string) {
  db.prepare("UPDATE checkout_orders SET capture_id=?,status=? WHERE id=?").run(
    capture,
    status,
    id,
  );
}
export async function claimed<T>(
  key: string,
  payload: string,
  requestId: string,
  work: (stableRequestId: string) => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO paypal_claims(id,payload,request_id,state,updated) VALUES (?,?,?,'running',?)",
    )
    .run(key, payload, requestId, now);
  const row = db.prepare("SELECT * FROM paypal_claims WHERE id=?").get(key)!;
  if (row.payload !== payload)
    throw new PaypalError(
      "REQUEST_CONFLICT",
      "The request ID was already used for different input.",
      409,
    );
  if (row.state === "done") return JSON.parse(String(row.result));
  if (!inserted.changes) {
    const retry = db
      .prepare(
        "UPDATE paypal_claims SET state='running',updated=? WHERE id=? AND (state IN ('unknown','failed') OR (state='running' AND updated<?))",
      )
      .run(now, key, now - 90000);
    if (!retry.changes)
      throw new PaypalError(
        "REQUEST_IN_PROGRESS",
        "This operation is still in progress. Keep the same request ID.",
        409,
      );
  }
  try {
    const result = await work(String(row.request_id));
    db.prepare(
      "UPDATE paypal_claims SET state='done',result=?,updated=? WHERE id=?",
    ).run(JSON.stringify(result), Date.now(), key);
    return result;
  } catch (error) {
    const known =
      error instanceof PaypalError && error.code !== "PAYPAL_OUTCOME_UNKNOWN";
    db.prepare("UPDATE paypal_claims SET state=?,updated=? WHERE id=?").run(
      known ? "failed" : "unknown",
      Date.now(),
      key,
    );
    throw error;
  }
}
