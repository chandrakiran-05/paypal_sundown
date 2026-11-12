"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Check,
  FileCode2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { BusinessAssessment } from "../lib/business-assessment";
import type { BusinessConnection } from "../lib/partner-onboarding";
import styles from "./business-connect.module.css";
type Setup = {
  ready: boolean;
  missing: string[];
  mode: "sandbox";
  requirement: string;
};
export default function BusinessConnect() {
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [assessments, setAssessments] = useState<BusinessAssessment[]>([]);
  const [selected, setSelected] = useState<BusinessAssessment | null>(null);
  const [businesses, setBusinesses] = useState<BusinessConnection[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const assessmentRequest = useRef({ fingerprint: "", id: "" });
  const invitationRequest = useRef({ name: "", id: "" });
  const latestLoad = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  async function load() {
    if (!mounted.current) return;
    latestLoad.current?.abort();
    const controller = new AbortController();
    latestLoad.current = controller;
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/assessments", { signal: controller.signal }),
        fetch("/api/businesses", { signal: controller.signal }),
      ]);
      if (!a.ok || !b.ok)
        throw new Error(
          "Could not load business records. Check workspace access and try again.",
        );
      const [assessmentData, businessData] = await Promise.all([
        a.json(),
        b.json(),
      ]);
      if (
        !Array.isArray(assessmentData.assessments) ||
        !Array.isArray(businessData.businesses) ||
        typeof businessData.setup?.ready !== "boolean"
      )
        throw new Error("Invalid business records response");
      if (!controller.signal.aborted) {
        setAssessments(assessmentData.assessments);
        setBusinesses(businessData.businesses);
        setSetup(businessData.setup);
        setLoadError("");
      }
    } catch {
      if (!controller.signal.aborted)
        setLoadError(
          "Could not load business records. Check workspace access and try again.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      latestLoad.current?.abort();
    };
  }, []);
  async function assess(event: React.FormEvent) {
    event.preventDefault();
    setBusy("assess");
    setError("");
    setNotice("");
    try {
      if (files.length < 1 || files.length > 10)
        throw new Error("Choose between 1 and 10 checkout source files.");
      if (
        files.some((f) => f.size > 100 * 1024) ||
        files.reduce((sum, f) => sum + f.size, 0) > 300 * 1024
      )
        throw new Error(
          "Use files up to 100 KiB each, with a 300 KiB total limit.",
        );
      const sourceFiles = await Promise.all(
        files.map(async (f) => ({ name: f.name, content: await f.text() })),
      );
      const fingerprint = JSON.stringify({ name, siteUrl, files: sourceFiles });
      if (assessmentRequest.current.fingerprint !== fingerprint)
        assessmentRequest.current = { fingerprint, id: crypto.randomUUID() };
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          siteUrl: siteUrl || undefined,
          files: sourceFiles,
          requestId: assessmentRequest.current.id,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.assessment)
        throw new Error(
          data?.error ||
            "Source assessment could not complete. Check workspace access and try again.",
        );
      if (!mounted.current) return;
      setSelected(data.assessment);
      setNotice(
        "Assessment saved. These findings come from your uploaded files.",
      );
      await load();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Source assessment failed.");
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function partner(
    action: "create" | "verify" | "resume",
    business?: BusinessConnection,
  ) {
    setBusy(business?.id || "partner");
    setError("");
    setNotice("");
    setApprovalUrl(null);
    try {
      if (action === "create" && (!consent || !name.trim()))
        throw new Error(
          "Enter a business name and confirm that you have the seller’s permission to request onboarding.",
        );
      if (invitationRequest.current.name !== name)
        invitationRequest.current = { name, id: crypto.randomUUID() };
      const body =
        action === "create"
          ? {
              action,
              name,
              consent: true,
              requestId: invitationRequest.current.id,
            }
          : { action, id: business!.id };
      const response = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data)
        throw new Error(
          data?.error ||
            "PayPal connection could not be verified. Check workspace access and try again.",
        );
      if (!mounted.current) return;
      setApprovalUrl(data.approvalUrl || null);
      setNotice(
        data.approvalUrl
          ? "Invitation ready. The seller must open PayPal and approve the requested permissions."
          : "Connection status refreshed from PayPal.",
      );
      await load();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "PayPal connection failed.");
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  return (
    <div className={styles.connect}>
      <section className={styles.demoChoice}>
        <div>
          <span className="eyebrow">FIRST TIME HERE?</span>
          <h2>See a complete example first.</h2>
          <p>
            Explore the reference migration and inspect each scenario’s sandbox
            or replay labels. Your business records stay separate.
          </p>
        </div>
        <Link className="button secondary" href="/overview">
          Explore the reference demo <ArrowUpRight size={15} />
        </Link>
      </section>
      {loadError && (
        <div role="alert" className="error-banner">
          {loadError}
          <button
            className="text-link"
            onClick={() => void load()}
            disabled={loading}
          >
            Reload business records
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button className="text-link" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          <Check size={16} aria-hidden="true" />
          {notice}
          {notice.startsWith("Assessment saved.") && (
            <a href="#assessment-results">View assessment ↓</a>
          )}
        </p>
      )}
      <div className={styles.columns}>
        <section className={styles.card}>
          <span className={styles.step}>1 · ASSESS YOUR CHECKOUT</span>
          <h2>Start with your business.</h2>
          <p>
            Get a review plan from your actual checkout code. You can do this
            before connecting PayPal.
          </p>
          <form onSubmit={assess} className={styles.form}>
            <label>
              Business name
              <input
                name="businessName"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your business name"
              />
            </label>
            <label>
              Website <span className="muted">(optional)</span>
              <input
                name="siteUrl"
                type="url"
                maxLength={2048}
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://your-business.com"
              />
              <small>
                For reference only. Sundown does not crawl your website.
              </small>
            </label>
            <label className={styles.upload}>
              <Upload size={22} />
              <strong>Checkout source files</strong>
              <input
                type="file"
                multiple
                required
                accept=".php,.js,.ts,.tsx,.html"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files || []));
                  setError("");
                }}
              />
              <small>
                PHP, JavaScript, TypeScript or HTML. Up to 10 files · 100 KiB
                each · 300 KiB total.
              </small>
            </label>
            {files.length > 0 && (
              <p className={styles.fileList}>
                {files.map((f) => f.name).join(" · ")}
              </p>
            )}
            <a
              className="text-link"
              href="/examples/legacy-checkout.php"
              download="legacy-checkout.php"
            >
              Try an example checkout file ↓
            </a>
            <p className={styles.boundary}>
              <ShieldCheck size={17} />
              Files are analyzed, never executed. Raw source is not retained.
              Remove secrets before uploading.
            </p>
            <button className="button" disabled={!!busy || !files.length}>
              <FileCode2 size={16} />
              {busy === "assess" ? "Assessing source…" : "Find migration work"}
            </button>
          </form>
        </section>
        <section className={styles.card}>
          <span className={styles.step}>OPTIONAL · CONNECT THROUGH PAYPAL</span>
          <h2>The seller keeps control.</h2>
          <p>
            Generate an onboarding invitation. The seller signs in on PayPal and
            grants permissions there; Sundown verifies the result with PayPal.
          </p>
          {loading ? (
            <p role="status">Checking partner setup…</p>
          ) : setup?.ready ? (
            <p className={styles.ready}>
              <Check size={16} />
              Partner app configured · sandbox
            </p>
          ) : (
            <div className={styles.setup}>
              <strong>
                {setup
                  ? "Partner setup required"
                  : "Partner setup could not be checked"}
              </strong>
              <p>
                {setup
                  ? "PayPal Partner Referrals needs an approved partner app. No merchant is connected until PayPal confirms it."
                  : "Reload business records before requesting an invitation. Source assessment is still available."}
              </p>
              {setup && (
                <details>
                  <summary>What the operator needs to configure</summary>
                  <ul>
                    {setup?.missing.map((key) => (
                      <li key={key}>
                        <code>{key}</code>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Add these server settings to the hosting environment.
                    Sellers never enter API secrets here.
                  </p>
                  <a
                    href="https://developer.paypal.com/platforms/seller-onboarding/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    PayPal onboarding guide ↗
                  </a>
                </details>
              )}
            </div>
          )}
          <ol className={styles.steps}>
            <li>Create a sandbox seller invitation</li>
            <li>The seller approves on PayPal</li>
            <li>Sundown checks account and permission status</li>
          </ol>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={!setup?.ready || !!busy}
            />
            I have the seller’s permission to request a PayPal onboarding
            invitation.
          </label>
          <p className={styles.invitationHint}>
            Use the business name entered in step 1. The seller reviews and
            grants permissions on PayPal.
          </p>
          <button
            className="button secondary"
            onClick={() => void partner("create")}
            disabled={!setup?.ready || !name.trim() || !consent || !!busy}
          >
            {busy === "partner"
              ? "Creating invitation…"
              : "Create PayPal invitation"}
            <ArrowUpRight size={16} />
          </button>
          {approvalUrl && (
            <div className={styles.approval}>
              <strong>Invitation ready</strong>
              <p>
                Only the seller should sign in and approve this sandbox
                connection.
              </p>
              <a
                className="button"
                href={approvalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Continue on PayPal <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          <p className={styles.boundary}>
            Connection status is separate from migration evidence. Connecting a
            seller does not copy Horizon’s tests or enable real-money payments.
          </p>
        </section>
      </div>
      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.step}>YOUR BUSINESS RECORDS</span>
            <h2>Pick up where you left off.</h2>
          </div>
          <button
            className="text-link"
            onClick={() => void load()}
            disabled={loading || !!busy}
          >
            Refresh records
          </button>
        </div>
        {loading ? (
          <p role="status">Loading your business records…</p>
        ) : assessments.length === 0 && businesses.length === 0 ? (
          <div className={styles.empty}>
            <Building2 size={26} />
            <p>
              No business records yet. Assess your checkout source above, or
              explore the reference demo.
            </p>
          </div>
        ) : null}
        {assessments.length > 0 && (
          <div className={styles.records}>
            {assessments.map((a) => (
              <button
                className={
                  selected?.id === a.id ? styles.selected : styles.record
                }
                key={a.id}
                aria-pressed={selected?.id === a.id}
                disabled={!!busy}
                onClick={() => {
                  setSelected(a);
                  setName(a.name);
                  setSiteUrl(a.siteUrl || "");
                }}
              >
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.files.length} source files · {a.findings.length} findings
                  </small>
                </span>
                <span className="tag">Source assessed</span>
              </button>
            ))}
          </div>
        )}
        {businesses.length > 0 && (
          <div className={styles.connections}>
            {businesses.map((b) => (
              <article key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <span className="tag">
                    {b.status === "connected"
                      ? "Connected in sandbox"
                      : b.status === "pending"
                        ? "Waiting for PayPal"
                        : "Not verified"}
                  </span>
                  <p>
                    {b.reason ||
                      "Use Check with PayPal to verify this connection record."}
                  </p>
                  <small>
                    {b.verifiedAt
                      ? `Last verified ${new Date(b.verifiedAt).toLocaleString()}`
                      : "Not yet verified with PayPal"}
                  </small>
                  {b.lastError && (
                    <p className={styles.connectionError}>
                      Latest check did not complete: {b.lastError.message}. The
                      saved status above has not been refreshed.
                    </p>
                  )}
                  {b.merchantId && (
                    <small>
                      PayPal merchant ID: <code>{b.merchantId}</code>
                    </small>
                  )}
                </div>
                <div className={styles.buttons}>
                  <button
                    className="button secondary small"
                    disabled={!!busy}
                    onClick={() => void partner("verify", b)}
                  >
                    {busy === b.id ? "Checking…" : "Check with PayPal"}
                  </button>
                  {b.status === "pending" && (
                    <button
                      className="text-link"
                      disabled={!!busy}
                      onClick={() => void partner("resume", b)}
                    >
                      Resume invitation
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {selected && (
        <section
          id="assessment-results"
          className={styles.card}
          aria-label="Business assessment results"
        >
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.step}>
                UPLOADED SOURCE ANALYSIS · {selected.name}
              </span>
              <h2>
                {selected.findings.length
                  ? `${selected.findings.length} findings to review.`
                  : "No supported legacy patterns found."}
              </h2>
              <p>
                {selected.findings.length
                  ? "Each finding points to a line in your uploaded source."
                  : "This does not certify the checkout or prove payment readiness. Review integrations outside the supported rules separately."}
              </p>
            </div>
            <a
              className="button secondary"
              href={`/api/assessments?id=${selected.id}&format=json`}
            >
              Download assessment ↓
            </a>
          </div>
          {selected.findings.length > 0 && (
            <div className={styles.tableScroll}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Review recommendation</th>
                    <th>Risk score</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.findings.map((f, i) => (
                    <tr key={f.id + ":" + i}>
                      <td>
                        <code>
                          {f.file}:{f.line}
                        </code>
                      </td>
                      <td>{f.replacement}</td>
                      <td>{f.risk} / 10</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selected.tasks.length > 0 && (
            <div className={styles.plan}>
              <h3>Suggested review plan</h3>
              <p>
                Dependencies for planning a review. No code has been changed or
                deployed.
              </p>
              <ol>
                {selected.tasks.map((task) => (
                  <li key={task.id}>
                    <strong>{task.name}</strong>
                    <small>
                      {task.predecessors.length
                        ? `After steps ${task.predecessors.join(", ")}`
                        : "Start here"}
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <details className={styles.proof}>
            <summary>Evidence and limitations</summary>
            <p>
              Uploaded source analysis ·{" "}
              {new Date(selected.createdAt).toLocaleString()}
            </p>
            <p>
              Source fingerprint: <code>{selected.sourceHash}</code>
            </p>
            <ul>
              {selected.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}
