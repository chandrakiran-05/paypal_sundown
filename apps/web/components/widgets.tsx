/** Shared evidence widgets used inside AG Studio and the product detail pages. */
"use client";
import type { Snapshot } from "../lib/store";
import { Check, ArrowUpRight } from "lucide-react";
import { compareEvidence, evidenceLabel } from "@sundown/engine/live-evidence";
export function Matrix({
  s,
  onSelect,
}: {
  s: Snapshot;
  onSelect?: (i: number) => void;
}) {
  return (
    <div className="matrix">
      <div className="matrix-head">
        <span>CHECKOUT SCENARIO</span>
        {["Amount", "State", "DB row", "Events"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      {s.results.map((r, i) => {
        const live = s.liveSandbox?.scenarios.find((item) => item.id === r.id);
        const comparison = live
          ? compareEvidence(live.legacy, live.migrated)
          : { differences: r.differences, notComparable: [] };
        const blocked = Boolean(
          live && (!live.legacy.outcome || !live.migrated.outcome),
        );
        return (
          <button
            key={r.id}
            className="matrix-row"
            onClick={() => onSelect?.(i)}
          >
            <span>
              {r.label}
              <small>
                {live
                  ? evidenceLabel(r.id, live.migrated)
                  : r.id === "duplicate" && !s.fixed
                    ? "Idempotency mismatch"
                    : s.checked
                      ? "Differential replay"
                      : "Seeded transcript"}
              </small>
            </span>
            {["amount", "status", "dbRows", "notifications"].map((field) => {
              const neutral = comparison.notComparable.find(
                (n) => n.field === field,
              );
              const failed = comparison.differences.some(
                (d) => d.field === field,
              );
              const reason =
                neutral?.reason ||
                (blocked
                  ? "Not comparable: completed outcomes unavailable"
                  : failed
                    ? "Difference"
                    : "Match");
              return (
                <span
                  key={field}
                  title={reason}
                  aria-label={`${field}: ${reason}`}
                  className={
                    neutral || blocked
                      ? "heat neutral"
                      : failed
                        ? "heat fail"
                        : "heat pass"
                  }
                >
                  {neutral || blocked ? (
                    "—"
                  ) : failed ? (
                    "×"
                  ) : (
                    <Check size={13} />
                  )}
                </span>
              );
            })}
          </button>
        );
      })}
      <p className="matrix-legend">
        ✓ Match · × Difference · — Not comparable (neutral). Live Events: legacy
        IPN is unreachable from loopback when no notifications were received.
      </p>
    </div>
  );
}
export function Risk({ s }: { s: Snapshot }) {
  const files = [...new Set(s.findings.map((f) => f.file))];
  return (
    <div className="risk-widget">
      {files.map((file) => {
        const fs = s.findings.filter((f) => f.file === file),
          risk = fs.reduce((a, f) => a + f.risk, 0);
        return (
          <div className="risk-row" key={file}>
            <div>
              <code>{file}</code>
              <span>{fs.length} findings</span>
            </div>
            <div className="risk-track">
              <i style={{ width: `${Math.min(100, risk)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="widget-foot">
        Deterministic rules · no AI-invented findings <ArrowUpRight size={13} />
      </p>
    </div>
  );
}
export function Burndown({ s }: { s: Snapshot }) {
  return (
    <div className="burndown">
      <div className="chart-label">
        <strong>
          {s.migrated ? s.migratedFindings.length : s.findings.length}
        </strong>
        <span>
          <b>Source findings</b>
          <small>Selected source scan · illustrative curve</small>
        </span>
      </div>
      <svg
        viewBox="0 0 500 110"
        preserveAspectRatio="none"
        role="img"
        aria-label="Illustrative migration curve; current finding count comes from a source scan"
      >
        <path
          d="M0 20H500M0 60H500M0 100H500"
          stroke="#2a302d"
          strokeDasharray="3 6"
        />
        <path
          d={
            s.migrated
              ? "M0 15L120 15L240 50L360 85L500 100"
              : "M0 15L120 15L240 15L360 15L500 15"
          }
          fill="none"
          stroke="#eca16f"
          strokeWidth="2"
        />
        <path
          d="M0 15L500 100"
          fill="none"
          stroke="#505a55"
          strokeDasharray="4 5"
        />
      </svg>
      <div className="chart-axis">
        <span>Inventory</span>
        <span>Rewrite</span>
        <span>Template applied</span>
      </div>
    </div>
  );
}
export function Countdown() {
  return (
    <div className="countdown">
      <span className="eyebrow">MIGRATION HORIZON</span>
      <strong>
        Orders <em>v2</em>
      </strong>
      <p>
        No universal sunset date is assumed.
        <br />
        Use your merchant’s PayPal notice.
      </p>
      <span className="tag amber-text">Merchant deadline · not configured</span>
    </div>
  );
}
