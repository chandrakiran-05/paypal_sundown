import { it, expect } from "vitest";
import {
  evidenceLabel,
  compareEvidence,
  legacyEventsUnavailable,
  type SideEvidence,
} from "./live-evidence";
const completed: SideEvidence = {
  source: "paypal-sandbox",
  status: "completed",
  orderId: "ORDER123456789",
  captureId: "CAPTURE123456",
  buyerApproved: true,
  webhookVerified: true,
  settled: true,
  webhookEventId: "WH-123456",
};
it("keeps live Events neutral for empty legacy IPN, even when both sides are empty, without hiding other differences", () => {
  const outcome = {
    amount: "24.00",
    currency: "USD" as const,
    status: "COMPLETED" as const,
    transitions: ["CREATED", "COMPLETED"],
    dbRows: 1,
    notifications: [] as string[],
  };
  const legacy = { ...completed, outcome };
  for (const notifications of [[], ["captured"]]) {
    const result = compareEvidence(legacy, {
      ...completed,
      outcome: { ...outcome, notifications },
    });
    expect(result.notComparable).toEqual([
      { field: "notifications", reason: legacyEventsUnavailable },
    ]);
    expect(result.differences).toEqual([]);
  }
  const mismatched = compareEvidence(legacy, {
    ...completed,
    outcome: {
      ...outcome,
      amount: "12.00",
      status: "DECLINED",
      dbRows: 2,
      notifications: ["captured"],
    },
  });
  expect(mismatched.differences.map((d) => d.field)).toEqual([
    "amount",
    "status",
    "dbRows",
  ]);
  expect(
    compareEvidence(
      { ...legacy, source: "synthetic-replay" },
      { ...completed, outcome: { ...outcome, notifications: ["captured"] } },
    ).differences.map((d) => d.field),
  ).toContain("notifications");
  const received = compareEvidence(
    { ...legacy, outcome: { ...outcome, notifications: ["ipn"] } },
    { ...completed, outcome },
  );
  expect(received.notComparable).toEqual([]);
  expect(received.differences.map((d) => d.field)).toContain("notifications");
});
it("labels only the two executed, approved and webhook-settled scenarios Live sandbox", () => {
  expect(evidenceLabel("success", completed)).toBe("Live sandbox");
  expect(
    evidenceLabel("refund", { ...completed, refundId: "REFUND123456" }),
  ).toBe("Live sandbox");
  expect(evidenceLabel("refund", completed)).toBe("Sandbox attempt");
  for (const id of ["cancel", "decline", "duplicate", "rounding"])
    expect(evidenceLabel(id, completed)).toBe("Replay");
});
it("never promotes simulated IDs, unapproved/pending captures or unsigned events", () => {
  for (const patch of [
    { orderId: "SIM-ORDER" },
    { orderId: undefined },
    { captureId: "REPLAY-CAPTURE" },
    { buyerApproved: false },
    { webhookVerified: false },
    { settled: false },
    { webhookEventId: undefined },
    { webhookEventId: "SIM-EVENT-123" },
    { webhookEventId: "REPLAY-EVENT-123" },
    { status: "pending" as const },
  ])
    expect(evidenceLabel("success", { ...completed, ...patch })).toBe(
      "Sandbox attempt",
    );
  expect(
    evidenceLabel("success", { ...completed, source: "synthetic-replay" }),
  ).toBe("Replay");
  expect(
    evidenceLabel("success", { source: "not-run", status: "not-run" }),
  ).toBe("Not run");
});
it("keeps a manual run mixed: only settled checkout and completed partial refund are live", () => {
  const scenarios = [
    "cancel",
    "decline",
    "duplicate",
    "refund",
    "rounding",
    "success",
  ];
  const labels = scenarios.map((id) =>
    evidenceLabel(
      id,
      ["success", "refund"].includes(id)
        ? {
            ...completed,
            ...(id === "refund" ? { refundId: "REFUND123456" } : {}),
          }
        : { source: "synthetic-replay", status: "completed" },
    ),
  );
  expect(labels).toEqual([
    "Replay",
    "Replay",
    "Replay",
    "Live sandbox",
    "Replay",
    "Live sandbox",
  ]);
  for (const patch of [
    { refundId: "SIM-REFUND-123" },
    { refundId: "REPLAY-REFUND-123" },
    { status: "pending" as const },
    { status: "failed" as const },
    { settled: false },
    { webhookVerified: false },
  ])
    expect(
      evidenceLabel("refund", {
        ...completed,
        refundId: "REFUND123456",
        ...patch,
      }),
    ).toBe("Sandbox attempt");
});
it("a rejected legacy call replays only a retained transcript, without claiming live parity", () => {
  const legacy: SideEvidence = {
    source: "recorded-transcript",
    status: "failed",
    error: {
      stage: "SetExpressCheckout",
      code: "10002",
      message: "Security header is not valid",
    },
    recording: {
      path: "recordings/rejected.json",
      sha256: "a".repeat(64),
      recordedAt: "2026-11-11T00:00:00.000Z",
    },
  };
  expect(evidenceLabel("success", legacy)).toBe(
    "replayed from recorded transcript",
  );
  expect(evidenceLabel("success", { ...legacy, recording: undefined })).toBe(
    "Not run",
  );
  expect(evidenceLabel("success", legacy, "legacy")).toBe(
    "Replayed: live NVP unavailable (10002: Security header is not valid)",
  );
  expect(
    evidenceLabel("success", { ...legacy, recording: undefined }, "legacy"),
  ).toBe("Not run");
  expect(evidenceLabel("success")).toBe("Replay");
});
