/** Live labels require execution receipts, not credentials or a global mode flag. */
import { z } from "zod";
import { outcomeSchema, compare } from "./index";
export const sideEvidenceSchema = z.object({
  label: z.string().optional(),
  source: z.enum([
    "paypal-sandbox",
    "synthetic-replay",
    "recorded-transcript",
    "not-run",
  ]),
  status: z.enum(["completed", "pending", "failed", "not-run"]),
  orderId: z.string().optional(),
  captureId: z.string().optional(),
  refundId: z.string().optional(),
  buyerApproved: z.boolean().optional(),
  webhookVerified: z.boolean().optional(),
  settled: z.boolean().optional(),
  webhookEventId: z.string().optional(),
  outcome: outcomeSchema.optional(),
  error: z
    .object({
      stage: z.string(),
      code: z.string(),
      message: z.string(),
      httpStatus: z.number().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
  recording: z
    .object({
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      recordedAt: z.iso.datetime(),
    })
    .optional(),
});
export type SideEvidence = z.infer<typeof sideEvidenceSchema>;
export const liveReportSchema = z.object({
  version: z.literal(1),
  runId: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: z.enum(["running", "completed", "incomplete"]),
  scenarios: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        legacy: sideEvidenceSchema,
        migrated: sideEvidenceSchema,
      }),
    )
    .length(6),
});
export type LiveReport = z.infer<typeof liveReportSchema>;
export const legacyEventsUnavailable =
  "Not comparable: legacy IPN is unreachable from loopback";
export function compareEvidence(legacy: SideEvidence, migrated: SideEvidence) {
  const notComparable =
    legacy.source === "paypal-sandbox" &&
    legacy.outcome?.notifications.length === 0
      ? [{ field: "notifications", reason: legacyEventsUnavailable }]
      : [];
  const differences =
    legacy.outcome && migrated.outcome
      ? compare(legacy.outcome, migrated.outcome).filter(
          (d) => !notComparable.some((n) => n.field === d.field),
        )
      : [
          {
            field: "No comparable completed legacy/migrated outcomes",
            legacy: null,
            migrated: null,
          },
        ];
  return { differences, notComparable };
}
export function evidenceLabel(
  id: string,
  side?: SideEvidence,
  shop: "legacy" | "migrated" = "migrated",
) {
  if (!side || side.source === "synthetic-replay") return "Replay";
  if (side.source === "recorded-transcript") {
    if (!side.recording) return "Not run";
    if (shop === "legacy" && side.error)
      return `Replayed: live NVP unavailable (${side.error.code}: ${side.error.message})`;
    return "replayed from recorded transcript";
  }
  if (side.source === "not-run") return "Not run";
  const realId = (value?: string) =>
    Boolean(
      value &&
      /^[A-Z0-9-]{5,64}$/.test(value) &&
      !/^(SIM|REPLAY|RECORDED)-/i.test(value),
    );
  if (!["success", "refund"].includes(id)) return "Replay";
  const completed =
    side.status === "completed" &&
    side.buyerApproved === true &&
    realId(side.captureId) &&
    (shop === "legacy" || realId(side.orderId));
  const settled =
    side.webhookVerified === true &&
    side.settled === true &&
    realId(side.webhookEventId);
  if (
    completed &&
    (id === "refund" ? realId(side.refundId) : true) &&
    (shop === "legacy" || settled)
  )
    return "Live sandbox";
  return "Sandbox attempt";
}
export function parseLiveReport(value: string): LiveReport | null {
  try {
    const parsed = liveReportSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
