"use client";
import { useState } from "react";
import Link from "next/link";
import {
  executeFixture,
  plan,
  type Fixture,
  type Finding,
} from "@sundown/engine";
import styles from "./public-demo.module.css";
export default function PublicDemo({
  fixtures,
  findings,
  source,
}: {
  fixtures: Fixture[];
  findings: Finding[];
  source: string;
}) {
  const [fixed, setFixed] = useState(false),
    [ran, setRan] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [stage, setStage] = useState(0);
  const results = fixtures.map((f) => executeFixture(f, fixed));
  const passed = results.filter((r) => !r.differences.length).length;
  const tasks = plan(findings, ran);
  function download() {
    const report = {
      provenance: "synthetic-replay",
      business: "Horizon Supply reference demo",
      findings,
      tasks,
      results,
      verified: ran,
      limitations: [
        "Public demo runs only synthetic fixtures in this browser.",
        "No private business records, merchant connections, PayPal calls or live transactions are used.",
        "Suggested plan dates are illustrative. No deployment is performed.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sundown-judge-demo.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={styles.demo}>
      <header>
        <Link href="/" className="brand">
          sundown.
        </Link>
        <span className="tag">Public judge demo · Replay</span>
        <Link href="/login">Admin sign in ↗</Link>
      </header>
      <main>
        <section className={styles.hero}>
          <span className="eyebrow">
            NO ACCOUNT · NO CREDENTIALS · NO REAL PAYMENTS
          </span>
          <h1>
            See a checkout migration
            <br />
            <em>from problem to proof.</em>
          </h1>
          <p>
            Explore the reference checkout, see what needs to change, then run
            the actual replay verifier. Everything here is isolated from the
            private workspace.
          </p>
          <div className={styles.steps}>
            {["Inspect checkout", "Review the plan", "Verify & share"].map(
              (name, i) => (
                <button
                  key={name}
                  onClick={() => setStage(i)}
                  aria-current={stage === i ? "step" : undefined}
                >
                  <b>{i + 1}</b>
                  {name}
                </button>
              ),
            )}
          </div>
        </section>
        <div className={styles.metrics}>
          <div>
            <strong>{findings.length}</strong>
            <span>Legacy source findings</span>
          </div>
          <div>
            <strong>{passed} / 6</strong>
            <span>
              {ran ? "Replay scenarios match" : "Initial replay baseline"}
            </span>
          </div>
          <div>
            <strong>0</strong>
            <span>Real payments attempted</span>
          </div>
        </div>
        {stage === 0 && (
          <section className={styles.panel}>
            <span className="eyebrow">1 · INSPECT</span>
            <h2>What is holding this checkout back?</h2>
            <p>
              Sundown scans this example with its real rule engine. Each finding
              points to the matching source line and a review recommendation.
            </p>
            <pre>{source}</pre>
            <div className={styles.scroll}>
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Migration recommendation</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={i}>
                      <td>{f.line}</td>
                      <td>{f.replacement}</td>
                      <td>{f.risk}/10</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="button" onClick={() => setStage(1)}>
              Review the plan →
            </button>
          </section>
        )}
        {stage === 1 && (
          <section className={styles.panel}>
            <span className="eyebrow">2 · PLAN</span>
            <h2>Make the change in a safe order.</h2>
            <p>
              These suggested tasks come from the same dependency planner used
              in the workspace. Source changes, rollout and dates are
              illustrative here.
            </p>
            <ol className={styles.tasks}>
              {tasks.map((t) => (
                <li key={t.id}>
                  <strong>{t.name}</strong>
                  <span>
                    {t.predecessors.length
                      ? `Depends on steps ${t.predecessors.join(", ")}`
                      : "Start here"}
                  </span>
                  {t.flagged && (
                    <small>
                      Planner deferred this gate after the replay mismatch.
                    </small>
                  )}
                </li>
              ))}
            </ol>
            <button className="button" onClick={() => setStage(2)}>
              Check the checkout behavior →
            </button>
          </section>
        )}
        {stage === 2 && (
          <section className={styles.panel}>
            <span className="eyebrow">3 · VERIFY</span>
            <h2>
              {ran
                ? "The replay repair holds."
                : "One duplicate callback breaks parity."}
            </h2>
            <p>
              The initial fixture contains a duplicate-event defect. Run the
              verifier to apply the known replay repair and see the Planner
              defer dependent gates. This does not modify any merchant’s code or
              run a payment.
            </p>
            <div className={styles.buttons}>
              <button
                className="button"
                onClick={() => {
                  setFixed(true);
                  setRan(true);
                }}
              >
                Run replay verification
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setFixed(false);
                  setRan(false);
                  setSelected(null);
                }}
              >
                Reset demo
              </button>
              <button className="button secondary" onClick={download}>
                Download demo report ↓
              </button>
            </div>
            <div className={styles.results}>
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(selected === r.id ? null : r.id)}
                >
                  <span>
                    {r.label}
                    <small>Synthetic replay</small>
                  </span>
                  <b
                    className={r.differences.length ? styles.fail : styles.pass}
                  >
                    {r.differences.length ? "Difference" : "Match"}
                  </b>
                </button>
              ))}
            </div>
            {selected && (
              <pre>
                {JSON.stringify(
                  results.find((r) => r.id === selected),
                  null,
                  2,
                )}
              </pre>
            )}
            {ran && (
              <div role="status" className={styles.journal}>
                <strong>Verifier → Planner → Repair → Recheck</strong>
                <p>
                  Duplicate-event mismatch detected → dependent gates deferred →
                  event uniqueness repair applied in replay → six scenarios
                  match.
                </p>
                <button className="text-link" onClick={() => setStage(1)}>
                  See the deferred plan →
                </button>
              </div>
            )}
          </section>
        )}
        <footer>
          <h2>What this proves</h2>
          <p>
            A real scan and replay engine can explain the problem, plan the work
            and compare outcomes. The admin workspace adds business-source
            assessments, protected merchant onboarding and separately labelled
            sandbox transaction evidence.
          </p>
          <p>
            This public demo contains no customer uploads, account credentials
            or live transaction records.
          </p>
          <Link href="/login">Open private admin workspace →</Link>
        </footer>
      </main>
    </div>
  );
}
