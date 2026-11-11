/** Deterministic migration rules, parity normalization, dependency planning and canary analysis. */
import { z } from "zod";
export const ruleRegistry = [
  {
    id: "nvp-create",
    pattern: "\\bSetExpressCheckout\\b",
    replacement: "POST /v2/checkout/orders",
    risk: 9,
  },
  {
    id: "nvp-details",
    pattern: "\\bGetExpressCheckoutDetails\\b",
    replacement: "GET /v2/checkout/orders/{id}",
    risk: 5,
  },
  {
    id: "nvp-capture",
    pattern: "\\bDoExpressCheckoutPayment\\b",
    replacement: "POST /v2/checkout/orders/{id}/capture",
    risk: 10,
  },
  {
    id: "nvp-refund",
    pattern: "\\bRefundTransaction\\b",
    replacement: "POST /v2/payments/captures/{id}/refund",
    risk: 8,
  },
  {
    id: "nvp-endpoint",
    pattern: "api-3t\\.(?:sandbox\\.)?paypal\\.com",
    replacement: "api-m.sandbox.paypal.com",
    risk: 8,
  },
  {
    id: "standard",
    pattern: "(?:cmd.{0,20}_xclick|_xclick)",
    replacement: "JavaScript SDK + Orders v2",
    risk: 8,
  },
  {
    id: "ipn",
    pattern: "(?:notify_url|ipn_verify|\\bIPN\\b|[\"']VERIFIED[\"'])",
    replacement: "Verified REST webhooks",
    risk: 9,
  },
  {
    id: "v1-payments",
    pattern: "/v1/payments/payment",
    replacement: "Orders v2",
    risk: 10,
  },
  {
    id: "app-context",
    pattern: "\\bapplication_context\\b",
    replacement: "payment_source.paypal.experience_context",
    risk: 4,
  },
  {
    id: "billing",
    pattern: "(?:CreateBillingAgreement|billing-agreements)",
    replacement:
      "Review Subscriptions / vaulting separately; no automatic Orders substitution",
    risk: 10,
  },
].map((rule) => ({
  ...rule,
  doc: "https://developer.paypal.com/api/nvp-soap/upgrade-integration/",
}));
export interface Finding {
  id: string;
  file: string;
  line: number;
  excerpt: string;
  replacement: string;
  risk: number;
  doc: string;
}
export function scan(files: Record<string, string>): Finding[] {
  return Object.entries(files).flatMap(([file, source]) =>
    source.split("\n").flatMap((excerpt, i) =>
      ruleRegistry
        .filter((r) => new RegExp(r.pattern, "i").test(excerpt))
        .map((r) => ({
          id: r.id,
          file,
          line: i + 1,
          excerpt: excerpt.trim(),
          replacement: r.replacement,
          risk: r.risk,
          doc: r.doc,
        })),
    ),
  );
}
export interface Task {
  id: number;
  name: string;
  startDate: string;
  duration: number;
  percentDone: number;
  predecessors: number[];
  flagged: boolean;
}
export function plan(findings: Finding[], failed = false): Task[] {
  const names = [
    "Inventory legacy endpoints",
    "Orders v2 + client token",
    "Webhook signature-verification source",
    "Differential replay parity",
    "Canary window · 5%",
    "Orders v2 · 100%",
  ];
  const cursor = new Date("2026-11-10T00:00:00Z");
  const advance = (days: number) => {
    for (let n = 0; n < days;) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (![0, 6].includes(cursor.getUTCDay())) n++;
    }
  };
  return names.map((name, i) => {
    if (failed && i === 3) advance(2);
    const startDate = cursor.toISOString().slice(0, 10),
      duration = i === 0 ? 1 : 2;
    advance(duration);
    return {
      id: i + 1,
      name,
      startDate,
      duration,
      percentDone: i === 0 && findings.length ? 100 : 0,
      predecessors: i === 0 ? [] : i === 3 ? [2, 3] : [i],
      flagged: failed && i >= 3,
    };
  });
}
export const outcomeSchema = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.enum(["USD", "EUR", "JPY"]),
  status: z.enum(["COMPLETED", "DECLINED", "CANCELLED", "PARTIALLY_REFUNDED"]),
  transitions: z.array(z.string()),
  dbRows: z.number().int().nonnegative(),
  notifications: z.array(z.string()),
});
export type Outcome = z.infer<typeof outcomeSchema>;
export const fixtureSchema = z.object({
  id: z.string(),
  label: z.string(),
  provenance: z.literal("synthetic-replay"),
  legacy: outcomeSchema,
  migrated: outcomeSchema,
  defect: z.enum(["none", "duplicate-callback"]),
});
export type Fixture = z.infer<typeof fixtureSchema>;
export function normalize(input: unknown): Outcome {
  const o = outcomeSchema.parse(input);
  return {
    ...o,
    currency: o.currency.toUpperCase() as Outcome["currency"],
    notifications: [...o.notifications].sort(),
  };
}
export interface Difference {
  field: string;
  legacy: unknown;
  migrated: unknown;
}
export function compare(legacy: unknown, migrated: unknown): Difference[] {
  const a = normalize(legacy),
    b = normalize(migrated);
  return (Object.keys(a) as (keyof Outcome)[])
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((field) => ({ field, legacy: a[field], migrated: b[field] }));
}
export function executeFixture(fixture: Fixture, idempotent: boolean) {
  const migrated = { ...fixture.migrated };
  if (fixture.defect === "duplicate-callback" && !idempotent) {
    migrated.dbRows = 2;
    migrated.notifications = [
      ...migrated.notifications,
      ...migrated.notifications,
    ];
  }
  return {
    id: fixture.id,
    label: fixture.label,
    legacy: fixture.legacy,
    migrated,
    differences: compare(fixture.legacy, migrated),
    mode: "replay" as const,
  };
}
export function canary(samples: number[], baseline = 0.01) {
  let ewma = baseline;
  const points = samples.map((rate, i) => {
    if (rate < 0 || rate > 1)
      throw new Error("Error rate must be between zero and one");
    ewma = 0.3 * rate + 0.7 * ewma;
    const zScore =
      (ewma - baseline) / Math.sqrt((baseline * (1 - baseline)) / 100);
    return { index: i, rate, ewma, zScore, rollback: zScore > 3 };
  });
  return {
    points,
    rollback: points.some((p) => p.rollback),
    label: "Simulated traffic",
  };
}
export function readiness(
  source: string,
  catalog: unknown[],
  parityPassed: boolean,
) {
  return [
    {
      name: "Orders v2 integration",
      pass: source.includes("/v2/checkout/orders"),
    },
    {
      name: "Webhook signature-verification source",
      pass:
        source.includes("/verify-webhook-signature") &&
        source.includes("verification_status") &&
        source.includes("SUCCESS"),
    },
    {
      name: "USD physical-goods catalog",
      pass:
        catalog.length > 0 &&
        catalog.every(
          (p) =>
            z
              .object({
                currency: z.literal("USD"),
                type: z.literal("PHYSICAL_GOODS"),
              })
              .safeParse(p).success,
        ),
    },
    { name: "All synthetic replay scenarios pass", pass: parityPassed },
  ];
}
export const products = [
  {
    id: "SD-001",
    name: "Horizon ceramic cup",
    price: "24.00",
    currency: "USD",
    type: "PHYSICAL_GOODS",
    inventory: 48,
  },
  {
    id: "SD-002",
    name: "Dune linen tote",
    price: "32.00",
    currency: "USD",
    type: "PHYSICAL_GOODS",
    inventory: 72,
  },
  {
    id: "SD-003",
    name: "Ember desk lamp",
    price: "89.00",
    currency: "USD",
    type: "PHYSICAL_GOODS",
    inventory: 16,
  },
];
export const merchants = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: [
    "Horizon Supply",
    "Northstar Goods",
    "Atelier No. 8",
    "Fieldwork Co.",
    "Sunday Objects",
    "Kinfolk Market",
    "Dune & Thread",
    "Stillwater Home",
    "Forma Studio",
    "Cedar Collective",
    "Ordinary Things",
    "Westward Supply",
  ][i],
  region: i === 9 ? "EU" : "US",
  currency: i === 9 ? "EUR" : "USD",
  integration:
    i % 3 === 0
      ? "Payments Standard"
      : i % 3 === 1
        ? "NVP Express Checkout"
        : "Payments v1",
  risk: 35 + ((i * 7) % 60),
  startDate: `2026-11-${12 + (i % 5)}T02:00:00`,
  endDate: `2026-11-${12 + (i % 5)}T05:00:00`,
}));
export { migratedSource, webhookSource, unifiedDiff } from "./rewriter";
