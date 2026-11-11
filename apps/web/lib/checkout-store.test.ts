/** Verify durable claims exist before writes and prevent duplicate payment operations. */
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PaypalError } from "./paypal";
let directory: string;
let store: typeof import("./checkout-store");
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), "sundown-paypal-"));
  vi.stubEnv("SUNDOWN_ROOT", directory);
  store = await import("./checkout-store");
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
it("claims before provider write, returns cached outcome and rejects changed input", async () => {
  let count = 0;
  const work = async () => {
    count++;
    const db = new DatabaseSync(
      path.join(directory, "workspace/sundown.sqlite"),
    );
    const row = db
      .prepare("SELECT state FROM paypal_claims WHERE id=?")
      .get("create:test");
    db.close();
    expect(row?.state).toBe("running");
    return { id: "ORDER12345" };
  };
  expect(
    await store.claimed("create:test", "24.00", "request-1", work),
  ).toEqual({ id: "ORDER12345" });
  expect(
    await store.claimed("create:test", "24.00", "request-2", work),
  ).toEqual({ id: "ORDER12345" });
  expect(count).toBe(1);
  await expect(
    store.claimed("create:test", "99.00", "request-1", work),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
});
it("blocks a concurrent caller while a payment is in flight", async () => {
  let finish: (value: string) => void = () => {};
  const first = store.claimed(
    "capture:concurrent",
    "capture",
    "original",
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(
    store.claimed(
      "capture:concurrent",
      "capture",
      "other",
      async () => "duplicate",
    ),
  ).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
  finish("completed");
  expect(await first).toBe("completed");
});
it("reconciles an unknown outcome with the original provider request ID", async () => {
  await expect(
    store.claimed("refund:uncertain", "12.00", "stable-key", async () => {
      throw new PaypalError("PAYPAL_OUTCOME_UNKNOWN", "No answer", 504);
    }),
  ).rejects.toThrow("No answer");
  expect(
    await store.claimed(
      "refund:uncertain",
      "12.00",
      "new-attempt",
      async (key) => key,
    ),
  ).toBe("stable-key");
});
it("binds orders to the browser owner", () => {
  store.saveOrder("OWNED12345", "browser-a", "24.00");
  expect(store.ownOrder("OWNED12345", "browser-a").amount).toBe("24.00");
  expect(() => store.ownOrder("OWNED12345", "browser-b")).toThrow(
    "does not belong",
  );
});
