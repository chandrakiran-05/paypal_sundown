"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { merchants } from "@sundown/engine";
import type { Passport } from "@sundown/engine/passport";
import { evidenceLabel } from "@sundown/engine/live-evidence";
const fields = [
  ["dailyOrders", "Orders / day", 1],
  ["averageOrderValue", "Average order value", 0.01],
  ["paypalShare", "PayPal share (0–1)", 0.01],
  ["failureProbability", "Failure probability (0–1)", 0.01],
  ["exposureDays", "Exposure days", 1],
] as const;
export default function PassportView({ siteId = 1 }: { siteId?: number }) {
  const [passport, setPassport] = useState<Passport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/passports/${siteId}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setPassport(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [siteId]);
  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/passports/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: Object.fromEntries(
            fields.map(([key]) => [key, Number(data.get(key))]),
          ),
          sunsetDate: data.get("sunsetDate") || null,
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setPassport(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue passport");
    } finally {
      setBusy(false);
    }
  }
  const p = passport?.payload;
  const incomplete = p?.parity.scenarios.some(
    (r) =>
      (r.legacyEvidence && !r.legacyEvidence.outcome) ||
      (r.migratedEvidence && !r.migratedEvidence.outcome),
  );
  const days = p?.sunset.date
    ? Math.ceil(
        (Date.parse(p.sunset.date + "T00:00:00Z") - Date.now()) / 86400000,
      )
    : null;
  return (
    <div className="upgrade-stack">
      <section className="panel upgrade-card">
        <label className="field-label" htmlFor="passport-site">
          SITE PASSPORT
        </label>
        <select
          id="passport-site"
          value={siteId}
          onChange={(e) => {
            window.location.href = `/passport/${e.target.value}`;
          }}
        >
          {merchants.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="muted">
          Twelve seeded demo sites. Only Horizon has local checkout and parity
          evidence; other sites explicitly show no site evidence.
        </p>
      </section>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!p || !passport ? (
        <div className="skeleton">Loading passport…</div>
      ) : (
        <>
          <section className="panel passport-cover">
            <div>
              <span className="eyebrow">
                MIGRATION PASSPORT / SITE{" "}
                {p.site.id.toString().padStart(2, "0")}
              </span>
              <h2>{p.site.name}</h2>
              <p>
                Issued {new Date(p.issuedAt).toLocaleString()} · Seeded demo
                site
              </p>
              <span className="evidence-tag">SHA-256 chain attached</span>
            </div>
            <div className="upgrade-actions">
              <a
                className="button"
                href={`/api/passports/${siteId}?format=pdf`}
              >
                Download PDF ↓
              </a>
              <a
                className="button secondary"
                href={`/api/passports/${siteId}?format=json`}
              >
                Download JSON ↓
              </a>
            </div>
          </section>
          <div className="upgrade-columns">
            <section className="panel upgrade-card">
              <span className="eyebrow">
                PARITY /{" "}
                {p.parity.mode === "mixed-sandbox-replay"
                  ? "MIXED SANDBOX + REPLAY"
                  : "REPLAY"}
              </span>
              <h2>
                {p.parity.status === "pass"
                  ? "Compared dimensions match"
                  : p.parity.status === "not-run"
                    ? "Verification needed"
                    : p.parity.status === "no-site-evidence"
                      ? "No site evidence"
                      : incomplete
                        ? "Verification incomplete"
                        : "Differences found"}
              </h2>
              <p>
                Issued snapshot. Reissue after running parity or shopping-agent
                checkout to include new evidence. Live comparisons cover Amount,
                State and DB row. Events are neutral when legacy IPN is
                unreachable from loopback.
              </p>
              {p.parity.scenarios.length ? (
                <ul className="passport-scenarios">
                  {p.parity.scenarios.map((r) => (
                    <li key={r.id}>
                      <div>
                        <span>{r.label}</span>
                        {r.notComparable?.map((n) => (
                          <small className="scenario-provenance" key={n.field}>
                            {n.reason}
                          </small>
                        ))}
                        <small className="scenario-provenance">
                          Migrated: {evidenceLabel(r.id, r.migratedEvidence)} ·
                          Legacy:{" "}
                          {evidenceLabel(r.id, r.legacyEvidence, "legacy")}
                        </small>
                        {[r.migratedEvidence, r.legacyEvidence].map(
                          (side, index) =>
                            side && (
                              <div key={index} className="scenario-provenance">
                                {side.orderId && (
                                  <code>Order: {side.orderId}</code>
                                )}
                                {side.captureId && (
                                  <code>Capture: {side.captureId}</code>
                                )}
                                {side.refundId && (
                                  <code>Refund: {side.refundId}</code>
                                )}
                                {side.error && (
                                  <span>
                                    {index === 0 ? "Migrated" : "Legacy"}:{" "}
                                    {side.error.code} — {side.error.message}
                                  </span>
                                )}
                              </div>
                            ),
                        )}
                      </div>
                      <strong>
                        {(r.legacyEvidence && !r.legacyEvidence.outcome) ||
                        (r.migratedEvidence && !r.migratedEvidence.outcome)
                          ? "BLOCKED"
                          : r.differences.length
                            ? "FAIL"
                            : r.notComparable?.length
                              ? "COMPARED DIMENSIONS MATCH"
                              : "PASS"}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <Link className="text-link" href="/parity">
                  Run Horizon parity →
                </Link>
              )}
            </section>
            <section className="panel upgrade-card">
              <span className="eyebrow">MERCHANT SUNSET TARGET</span>
              <h2>
                {days === null
                  ? "Date not set"
                  : days < 0
                    ? `${Math.abs(days)} days overdue`
                    : days === 0
                      ? "Target is today"
                      : `${days} days remaining`}
              </h2>
              <p>
                {p.sunset.date
                  ? `${p.sunset.date}, 00:00 UTC`
                  : "Enter the date from your merchant notice or your migration target."}
              </p>
              <p className="muted">
                Merchant target, not a universal PayPal deadline. Downloads
                preserve the countdown at issue.
              </p>
            </section>
          </div>
          <section className="panel upgrade-card">
            <span className="eyebrow">REVENUE AT RISK / ESTIMATE</span>
            <h2>
              {p.site.currency}{" "}
              {p.estimate.amount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </h2>
            <p>
              Estimate, not measured revenue. {p.estimate.inputSource}.
              Orders/day × average order value × PayPal share × failure
              probability × exposure days.
            </p>
            <form onSubmit={issue} key={p.issuedAt}>
              <div className="passport-fields">
                {fields.map(([key, label, step]) => (
                  <label key={key}>
                    {label}
                    <input
                      name={key}
                      type="number"
                      min="0"
                      max={
                        key === "paypalShare" || key === "failureProbability"
                          ? 1
                          : key === "exposureDays"
                            ? 3650
                            : 1000000
                      }
                      step={step}
                      defaultValue={p.estimate.inputs[key]}
                      required
                    />
                  </label>
                ))}
                <label>
                  Merchant sunset date (UTC)
                  <input
                    type="date"
                    name="sunsetDate"
                    defaultValue={p.sunset.date || ""}
                  />
                </label>
              </div>
              <button className="button" disabled={busy}>
                {busy ? "Issuing…" : "Reissue with current evidence & inputs"}
              </button>
            </form>
          </section>
          <section className="panel upgrade-card">
            <h2>Transaction evidence</h2>
            <p className="muted">
              Sandbox IDs and Simulated IDs retain their provenance. PAID in
              sandbox requires a verified capture webhook.
            </p>
            {!p.transactions.some((t) => t.mode === "sandbox") && (
              <p>No sandbox transaction IDs recorded.</p>
            )}
            <div className="passport-transactions">
              {p.transactions.map((t) => (
                <div key={t.orderId}>
                  <span className="evidence-tag">
                    {t.mode === "simulated" ? "Simulated" : "Sandbox"} ·{" "}
                    {t.status}
                  </span>
                  <code>Order: {t.orderId}</code>
                  <code>Capture: {t.captureId || "Not captured"}</code>
                  {t.refundId && <code>Refund: {t.refundId}</code>}
                </div>
              ))}
            </div>
            <Link className="text-link" href="/agent-demo">
              Run shopping agent →
            </Link>
          </section>
          <section className="panel upgrade-card">
            <h2>Keep the evidence verifiable.</h2>
            <p>
              Retain this head hash separately. The JSON contains five linked
              SHA-256 records covering identity, parity, transactions, estimate
              and sunset. A changed payload or reordered link fails
              verification.
            </p>
            <code className="passport-hash">{passport.head}</code>
            <p className="muted">
              This detects tampering against a retained head. It does not
              authenticate the issuer or prevent someone from replacing both the
              file and an untrusted head.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
