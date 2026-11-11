/** One immutable issued snapshot per site; reissue explicitly to refresh evidence. */
import { createHash } from "node:crypto";
import { merchants } from "@sundown/engine";
import { evidenceLabel, compareEvidence } from "@sundown/engine/live-evidence";
import {
  defaultEstimateInputs,
  estimateRevenue,
  issuePassport,
  passportSettingsSchema,
  sunsetDays,
  verifyPassport,
  type Passport,
} from "@sundown/engine/passport";
import { fixtures, getFlag, setFlag, snapshot } from "./store";
import { siteOrders } from "./agent-shop";
export function passportSite(siteId: number) {
  const site = merchants.find((s) => s.id === siteId);
  if (!site) throw new Error("Unknown site");
  return site;
}
export function createPassport(siteId: number, settings?: unknown): Passport {
  const site = passportSite(siteId),
    now = new Date();
  const saved = getFlag(`passport-settings:${siteId}`);
  const config = passportSettingsSchema.parse(
    settings ??
      (saved
        ? JSON.parse(saved)
        : { inputs: defaultEstimateInputs, sunsetDate: null }),
  );
  const state = snapshot();
  const applies = siteId === 1;
  const live = applies ? state.liveSandbox : null;
  const scenarios = live
    ? live.scenarios.map((s) => ({
        id: s.id,
        label: s.label,
        differences: compareEvidence(s.legacy, s.migrated).differences.map(
          (d) => d.field,
        ),
        notComparable: compareEvidence(s.legacy, s.migrated).notComparable,
        legacyEvidence: s.legacy,
        migratedEvidence: s.migrated,
      }))
    : applies && state.checked
      ? state.results.map(({ id, label, differences }) => ({
          id,
          label,
          differences: differences.map((d) => d.field),
        }))
      : [];
  const passport = issuePassport({
    issuedAt: now.toISOString(),
    site: {
      id: site.id,
      name: site.name,
      currency: site.currency,
      provenance: "seeded-demo-site",
    },
    parity: {
      status: !applies
        ? "no-site-evidence"
        : live
          ? scenarios.every((s) => !s.differences.length)
            ? "pass"
            : "fail"
          : !state.checked
            ? "not-run"
            : state.results.every((r) => !r.differences.length)
              ? "pass"
              : "fail",
      mode: live?.scenarios.some(
        (s) =>
          evidenceLabel(s.id, s.migrated) === "Live sandbox" ||
          s.migrated.orderId,
      )
        ? "mixed-sandbox-replay"
        : "synthetic-replay",
      inputsSha256: applies
        ? createHash("sha256").update(JSON.stringify(fixtures())).digest("hex")
        : null,
      scenarios,
    },
    transactions: siteOrders(siteId).map((o) => {
      const scenario = live?.scenarios.find((s) => s.migrated.orderId === o.id);
      return {
        orderId: o.id,
        captureId: o.capture_id,
        mode: o.mode,
        status: o.status,
        ...(scenario?.migrated.refundId
          ? { refundId: scenario.migrated.refundId, scenarioId: scenario.id }
          : {}),
      };
    }),
    estimate: {
      label: "Estimate - not measured revenue",
      inputs: config.inputs,
      inputSource:
        settings || saved ? "Operator assumptions" : "Demo assumptions",
      amount: estimateRevenue(config.inputs),
      formula:
        "dailyOrders * averageOrderValue * paypalShare * failureProbability * exposureDays",
    },
    sunset: {
      date: config.sunsetDate,
      basis: "Merchant target - not a universal PayPal deadline",
      daysRemainingAtIssue: sunsetDays(config.sunsetDate, now),
    },
  });
  if (settings) setFlag(`passport-settings:${siteId}`, JSON.stringify(config));
  setFlag(`passport:${siteId}`, JSON.stringify(passport));
  return passport;
}
export function loadPassport(siteId: number): Passport {
  passportSite(siteId);
  const saved = getFlag(`passport:${siteId}`);
  if (!saved) return createPassport(siteId);
  const passport: unknown = JSON.parse(saved);
  if (!verifyPassport(passport))
    throw new Error("Stored passport integrity check failed");
  return passport as Passport;
}
