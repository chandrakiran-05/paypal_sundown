/** Regression coverage for migration evidence and release gates. */
import { describe, it, expect } from "vitest";
import {
  scan,
  ruleRegistry,
  plan,
  compare,
  normalize,
  canary,
  executeFixture,
  readiness,
  products,
  type Fixture,
} from "./index";
const outcome = {
  amount: "10.00",
  currency: "USD" as const,
  status: "COMPLETED" as const,
  transitions: ["CREATED", "COMPLETED"],
  dbRows: 1,
  notifications: ["captured"],
};
describe("scanner", () => {
  it.each(ruleRegistry)("detects $id at its actual location", (r) => {
    const examples: Record<string, string> = {
      "nvp-create": "SetExpressCheckout",
      "nvp-details": "GetExpressCheckoutDetails",
      "nvp-capture": "DoExpressCheckoutPayment",
      "nvp-refund": "RefundTransaction",
      "nvp-endpoint": "api-3t.sandbox.paypal.com",
      standard: "cmd=_xclick",
      ipn: "notify_url",
      "v1-payments": "/v1/payments/payment",
      "app-context": "application_context",
      billing: "CreateBillingAgreement",
    };
    expect(
      scan({ "checkout.php": "\n" + examples[r.id] }).some(
        (f) => f.id === r.id && f.line === 2,
      ),
    ).toBe(true);
  });
  it("has no invented findings", () =>
    expect(scan({ "safe.ts": "const x = 1;" })).toEqual([]));
});
it("keeps both infrastructure prerequisites before parity and blocks cutover", () => {
  const tasks = plan([], true);
  expect(tasks[3].predecessors).toEqual([2, 3]);
  expect(tasks[4].predecessors).toEqual([4]);
  expect(tasks[4].flagged).toBe(true);
  expect(tasks[4].startDate > plan([])[4].startDate).toBe(true);
  for (const task of tasks)
    for (const id of task.predecessors) {
      const before = tasks.find((t) => t.id === id)!;
      const end = new Date(before.startDate + "T00:00:00Z");
      for (let n = 0; n < before.duration;) {
        end.setUTCDate(end.getUTCDate() + 1);
        if (![0, 6].includes(end.getUTCDay())) n++;
      }
      expect(task.startDate >= end.toISOString().slice(0, 10)).toBe(true);
    }
});
it("normalizes notification ordering but preserves duplicates and cents", () => {
  expect(
    compare(
      { ...outcome, notifications: ["b", "a"] },
      { ...outcome, notifications: ["a", "b"] },
    ),
  ).toEqual([]);
  expect(
    compare(outcome, {
      ...outcome,
      amount: "10.01",
      notifications: ["captured", "captured"],
    }),
  ).toHaveLength(2);
  expect(() => normalize({ ...outcome, amount: "NaN" })).toThrow();
});
it("verifies idempotency patch against identical transcript", () => {
  const f: Fixture = {
    id: "duplicate",
    label: "Duplicate",
    provenance: "synthetic-replay",
    defect: "duplicate-callback",
    legacy: outcome,
    migrated: outcome,
  };
  expect(executeFixture(f, false).differences).toHaveLength(2);
  expect(executeFixture(f, true).differences).toHaveLength(0);
});
it("detects a sustained error spike without flagging steady traffic", () => {
  expect(canary([0.01, 0.012, 0.009]).rollback).toBe(false);
  expect(canary([0.01, 0.2, 0.25]).rollback).toBe(true);
  expect(() => canary([2])).toThrow();
});
it("never calls an unmigrated store ready", () => {
  expect(readiness("", products, true).every((c) => c.pass)).toBe(false);
  expect(
    readiness(
      "/v2/checkout/orders /verify-webhook-signature verification_status SUCCESS",
      products,
      true,
    ).every((c) => c.pass),
  ).toBe(true);
});

it("does not mistake generic verified webhook prose for an IPN listener", () => {
  expect(
    scan({ "webhook.php": "// Verified webhook listener\nverifyWebhook()" }),
  ).toEqual([]);
});
