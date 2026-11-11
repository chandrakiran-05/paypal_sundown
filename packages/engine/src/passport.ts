/** Canonical, portable evidence chain. A retained head hash is the external trust anchor. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sideEvidenceSchema } from "./live-evidence";
export const estimateInputsSchema = z
  .object({
    dailyOrders: z.number().int().min(0).max(1_000_000),
    averageOrderValue: z.number().min(0).max(1_000_000),
    paypalShare: z.number().min(0).max(1),
    failureProbability: z.number().min(0).max(1),
    exposureDays: z.number().int().min(0).max(3650),
  })
  .strict();
export type EstimateInputs = z.infer<typeof estimateInputsSchema>;
export const defaultEstimateInputs: EstimateInputs = {
  dailyOrders: 100,
  averageOrderValue: 24,
  paypalShare: 0.4,
  failureProbability: 1,
  exposureDays: 30,
};
export const passportSettingsSchema = z
  .object({ inputs: estimateInputsSchema, sunsetDate: z.iso.date().nullable() })
  .strict();
export function estimateRevenue(inputs: EstimateInputs) {
  const i = estimateInputsSchema.parse(inputs);
  return (
    Math.round(
      i.dailyOrders *
        i.averageOrderValue *
        i.paypalShare *
        i.failureProbability *
        i.exposureDays *
        100,
    ) / 100
  );
}
const payloadSchema = z
  .object({
    issuedAt: z.iso.datetime(),
    site: z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      currency: z.string().length(3),
      provenance: z.literal("seeded-demo-site"),
    }),
    parity: z.object({
      status: z.enum(["pass", "fail", "not-run", "no-site-evidence"]),
      mode: z.enum(["synthetic-replay", "mixed-sandbox-replay"]),
      inputsSha256: z.string().nullable(),
      scenarios: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          differences: z.array(z.string()),
          notComparable: z
            .array(z.object({ field: z.string(), reason: z.string() }))
            .optional(),
          legacyEvidence: sideEvidenceSchema.optional(),
          migratedEvidence: sideEvidenceSchema.optional(),
        }),
      ),
    }),
    transactions: z.array(
      z.object({
        orderId: z.string(),
        captureId: z.string().nullable(),
        refundId: z.string().nullable().optional(),
        scenarioId: z.string().optional(),
        mode: z.enum(["sandbox", "simulated"]),
        status: z.string(),
      }),
    ),
    estimate: z.object({
      label: z.literal("Estimate - not measured revenue"),
      inputs: estimateInputsSchema,
      inputSource: z.enum(["Demo assumptions", "Operator assumptions"]),
      amount: z.number().nonnegative(),
      formula: z.literal(
        "dailyOrders * averageOrderValue * paypalShare * failureProbability * exposureDays",
      ),
    }),
    sunset: z.object({
      date: z.iso.date().nullable(),
      basis: z.literal("Merchant target - not a universal PayPal deadline"),
      daysRemainingAtIssue: z.number().int().nullable(),
    }),
  })
  .strict();
export type PassportPayload = z.infer<typeof payloadSchema>;
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  throw new Error("Passport data must be finite JSON");
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function issuePassport(input: PassportPayload) {
  const payload = payloadSchema.parse(input);
  let previousHash = "0".repeat(64);
  const sections = [
    ["identity", { issuedAt: payload.issuedAt, site: payload.site }],
    ["parity", payload.parity],
    ["transactions", payload.transactions],
    ["estimate", payload.estimate],
    ["sunset", payload.sunset],
  ] as const;
  const chain = sections.map(([kind, data], index) => {
    const link = { schemaVersion: 1, index, kind, data, previousHash };
    const hash = digest(link);
    previousHash = hash;
    return { ...link, hash };
  });
  return { schemaVersion: 1 as const, payload, chain, head: previousHash };
}
export type Passport = ReturnType<typeof issuePassport>;
export function verifyPassport(input: unknown, trustedHead?: string) {
  try {
    const p = z
      .object({
        schemaVersion: z.literal(1),
        payload: payloadSchema,
        chain: z.array(z.unknown()),
        head: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(input);
    if (canonical(input) !== canonical(p)) return false;
    const expected = issuePassport(p.payload);
    return (
      canonical(expected) === canonical(p) &&
      (!trustedHead || p.head === trustedHead)
    );
  } catch {
    return false;
  }
}
export function sunsetDays(date: string | null, now = new Date()) {
  return date === null
    ? null
    : Math.ceil((Date.parse(date + "T00:00:00Z") - now.getTime()) / 86_400_000);
}
