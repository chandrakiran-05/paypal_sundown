/** Runtime PDF generation stays in the Node web app; no system renderer is needed in production. */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Passport } from "@sundown/engine/passport";
import { evidenceLabel } from "@sundown/engine/live-evidence";
export async function passportPdf(passport: Passport) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const p = passport.payload;
  pdf.setTitle(`Sundown Migration Passport / ${p.site.name}`);
  pdf.setSubject(`Evidence head: ${passport.head}`);
  let page = pdf.addPage([595, 842]),
    y = 786;
  const ink = rgb(0.12, 0.18, 0.22),
    muted = rgb(0.36, 0.42, 0.45);
  function line(value: string, size = 11, strong = false, code = false) {
    const font = code ? mono : strong ? bold : regular;
    const safe = value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "-");
    const words = safe.split(/\s+/);
    let row = "";
    function draw(text: string) {
      if (y < 65) {
        page = pdf.addPage([595, 842]);
        y = 786;
      }
      page.drawText(text, {
        x: 44,
        y,
        size,
        font,
        color: strong ? ink : muted,
      });
      y -= size + 7;
    }
    for (const word of words) {
      if (font.widthOfTextAtSize(row + word, size) > 505 && row) {
        draw(row.trim());
        row = "";
      }
      row += word + " ";
    }
    if (row) draw(row.trim());
  }
  function section(title: string) {
    if (y < 180) {
      page = pdf.addPage([595, 842]);
      y = 786;
    }
    y -= 15;
    line(title, 12, true);
    y -= 3;
  }
  line("SUNDOWN / MIGRATION PASSPORT", 10, true);
  y -= 12;
  line(p.site.name, 27, true);
  line(`Site ${p.site.id} / Seeded demo site / Issued ${p.issuedAt}`, 9);
  section("01  Parity evidence");
  line(
    `${p.parity.scenarios.some((r) => (r.legacyEvidence && !r.legacyEvidence.outcome) || (r.migratedEvidence && !r.migratedEvidence.outcome)) ? "INCOMPLETE" : p.parity.status.toUpperCase()} / ${p.parity.mode === "mixed-sandbox-replay" ? "Mixed sandbox + Replay" : "Replay evidence"}`,
    12,
    true,
  );
  line(
    "Live sandbox labels apply per side/scenario. Replayed outcomes are not live proof.",
  );
  for (const r of p.parity.scenarios) {
    line(
      `${(r.legacyEvidence && !r.legacyEvidence.outcome) || (r.migratedEvidence && !r.migratedEvidence.outcome) ? "BLOCKED" : r.differences.length ? "FAIL" : r.notComparable?.length ? "COMPARED DIMENSIONS MATCH" : "PASS"}  ${r.label}${r.differences.length ? ": " + r.differences.join(", ") : ""}`,
      10,
    );
    for (const neutral of r.notComparable || []) line(neutral.reason, 9);
    if (r.notComparable?.length)
      line(
        "Result covers compared dimensions: Amount, State and DB row; Events is neutral.",
        9,
      );
    line(
      `Migrated: ${evidenceLabel(r.id, r.migratedEvidence)} / Legacy: ${evidenceLabel(r.id, r.legacyEvidence, "legacy")}`,
      9,
    );
    for (const side of [r.migratedEvidence, r.legacyEvidence])
      if (side) {
        if (side.orderId) line(`Order: ${side.orderId}`, 8, false, true);
        if (side.captureId) line(`Capture: ${side.captureId}`, 8, false, true);
        if (side.refundId) line(`Refund: ${side.refundId}`, 8, false, true);
        if (side.error) line(`${side.error.code}: ${side.error.message}`, 9);
      }
  }
  if (!p.parity.scenarios.length)
    line("No completed site-specific parity run is attached.");
  section("02  Revenue at risk - estimate");
  line(
    `${p.site.currency} ${p.estimate.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} / Estimate, not measured revenue`,
    15,
    true,
  );
  line(`Inputs: ${p.estimate.inputSource}. Currency: ${p.site.currency}.`);
  const i = p.estimate.inputs;
  line(
    `${i.dailyOrders} orders/day x ${i.averageOrderValue} average order value x ${i.paypalShare * 100}% PayPal share x ${i.failureProbability * 100}% failure probability x ${i.exposureDays} exposure days.`,
  );
  section("03  Sunset countdown");
  line(
    p.sunset.date
      ? `${p.sunset.daysRemainingAtIssue} days at issue / ${p.sunset.date} (UTC)`
      : "Not configured - enter the merchant's target date.",
    12,
    true,
  );
  line(p.sunset.basis);
  section("04  Transaction evidence");
  const sandbox = p.transactions.filter((t) => t.mode === "sandbox");
  line(
    sandbox.length
      ? `${sandbox.length} sandbox order(s) attached; PAID requires a verified webhook.`
      : "No sandbox transaction IDs recorded.",
  );
  for (const t of p.transactions) {
    if (y < 145) {
      page = pdf.addPage([595, 842]);
      y = 786;
    }
    line(
      `${t.mode === "simulated" ? "SIMULATED" : "SANDBOX"} / ${t.status}`,
      10,
      true,
    );
    line(`Order: ${t.orderId}`, 9, false, true);
    line(`Capture: ${t.captureId ?? "Not captured"}`, 9, false, true);
    if (t.refundId) line(`Refund: ${t.refundId}`, 9, false, true);
  }
  section("05  Tamper detection");
  line(
    "SHA-256 chain head - retain separately to detect a rewritten chain.",
    10,
  );
  line(passport.head, 8, false, true);
  line(
    "The JSON download contains the complete hash chain. This detects changed evidence against a retained head; it does not authenticate the issuer.",
    10,
  );
  const pages = pdf.getPages();
  pages.forEach((sheet, index) =>
    sheet.drawText(
      `Sundown / ${p.site.name} / ${index + 1} of ${pages.length}`,
      { x: 44, y: 30, size: 8, font: regular, color: muted },
    ),
  );
  return pdf.save();
}
