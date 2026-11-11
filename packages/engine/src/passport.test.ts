import { describe, it, expect } from "vitest";
import {
  defaultEstimateInputs,
  estimateRevenue,
  issuePassport,
  verifyPassport,
  sunsetDays,
  canonical,
  type PassportPayload,
} from "./passport";
const payload: PassportPayload = {
  issuedAt: "2026-11-11T00:00:00.000Z",
  site: {
    id: 1,
    name: "Horizon Supply",
    currency: "USD",
    provenance: "seeded-demo-site",
  },
  parity: {
    status: "pass",
    mode: "synthetic-replay",
    inputsSha256: "fixture-hash",
    scenarios: [{ id: "success", label: "Success", differences: [] }],
  },
  transactions: [
    {
      orderId: "SIM-ORDER",
      captureId: "SIM-CAPTURE",
      mode: "simulated",
      status: "PAID",
    },
  ],
  estimate: {
    label: "Estimate - not measured revenue",
    inputs: defaultEstimateInputs,
    inputSource: "Demo assumptions",
    amount: 28800,
    formula:
      "dailyOrders * averageOrderValue * paypalShare * failureProbability * exposureDays",
  },
  sunset: {
    date: "2026-11-15",
    basis: "Merchant target - not a universal PayPal deadline",
    daysRemainingAtIssue: 4,
  },
};
describe("Migration Passport", () => {
  it("is canonical across object key ordering and preserves simulated provenance", () => {
    const p = issuePassport(payload);
    expect(verifyPassport(JSON.parse(JSON.stringify(p)), p.head)).toBe(true);
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
    expect(p.payload.transactions[0].mode).toBe("simulated");
    expect(p.chain).toHaveLength(5);
  });
  it("detects payload changes, link edits, reordering, truncation and a replaced head", () => {
    const p = issuePassport(payload);
    const copies = Array.from({ length: 5 }, () => structuredClone(p));
    copies[0].payload.transactions[0].mode = "sandbox";
    copies[1].chain[1].previousHash = "a".repeat(64);
    copies[2].chain.reverse();
    copies[3].chain.pop();
    copies[4].head = "f".repeat(64);
    expect(copies.map((x) => verifyPassport(x))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    const replacement = issuePassport({
      ...payload,
      site: { ...payload.site, name: "Other merchant" },
    });
    expect(verifyPassport(replacement)).toBe(true);
    expect(verifyPassport(replacement, p.head)).toBe(false);
  });
  it("calculates an explicit estimate and rejects invalid assumptions", () => {
    expect(estimateRevenue(defaultEstimateInputs)).toBe(28800);
    expect(estimateRevenue({ ...defaultEstimateInputs, paypalShare: 0 })).toBe(
      0,
    );
    expect(() =>
      estimateRevenue({ ...defaultEstimateInputs, failureProbability: 1.1 }),
    ).toThrow();
    expect(() => canonical({ amount: Number.NaN })).toThrow();
  });
  it("handles unset and expired merchant dates without inventing a PayPal deadline", () => {
    expect(sunsetDays(null)).toBeNull();
    expect(sunsetDays("2026-11-15", new Date(payload.issuedAt))).toBe(4);
    expect(sunsetDays("2026-11-10", new Date(payload.issuedAt))).toBe(-1);
  });
});
