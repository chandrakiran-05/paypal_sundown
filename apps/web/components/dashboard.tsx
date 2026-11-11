/** Operational workspace: streamed evidence, reviewable changes, release gates and command palette. */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Command } from "cmdk";
import { motion } from "framer-motion";
import {
  Sunset,
  LayoutDashboard,
  GitBranch,
  FlaskConical,
  ShieldCheck,
  Layers,
  ArrowUpRight,
  ArrowRight,
  Play,
  Download,
  X,
  Check,
  AlertTriangle,
  RotateCcw,
  Terminal,
  Search,
} from "lucide-react";
import type { Snapshot } from "../lib/store";
import { Matrix } from "./widgets";
import { compareEvidence } from "@sundown/engine/live-evidence";
import ShoppingDemo from "./shopping-demo";
import PassportView from "./passport";
const Scene = dynamic(() => import("./scene"), { ssr: false });
const Studio = dynamic(() => import("./studio"), {
  ssr: false,
  loading: () => <div className="skeleton">Loading evidence canvas…</div>,
});
const Timeline = dynamic(() => import("./timeline"), {
  ssr: false,
  loading: () => <div className="skeleton">Loading migration timeline…</div>,
});
const pages = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "plan", name: "Migration plan", icon: GitBranch },
  { id: "parity", name: "Parity testing", icon: FlaskConical },
  { id: "readiness", name: "Agent readiness", icon: ShieldCheck },
  { id: "portfolio", name: "Portfolio", icon: Layers },
  { id: "agent-demo", name: "Shopping agent", icon: Terminal },
  { id: "passport", name: "Migration Passport", icon: ShieldCheck },
];
export default function Dashboard({
  page,
  siteId,
}: {
  page: string;
  siteId?: number;
}) {
  const [s, setS] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [palette, setPalette] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [diff, setDiff] = useState(false),
    [prompt, setPrompt] = useState(""),
    [answer, setAnswer] = useState(""),
    [focus, setFocus] = useState(""),
    [highlight, setHighlight] = useState("");
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (e) => {
      setS(JSON.parse(e.data));
      setConnected(true);
    };
    events.onerror = () => setConnected(false);
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") {
        setSelected(null);
        setDiff(false);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      events.close();
      window.removeEventListener("keydown", keyboard);
    };
  }, []);
  async function action(name: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setS(await (await fetch("/api/state")).json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setAnswer("Reading evidence…");
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setAnswer(result.provider + " · " + result.answer);
      setFocus(result.widget);
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : "Assistant unavailable");
    }
  }
  useEffect(() => {
    if (diff && s)
      import("shiki")
        .then(({ codeToHtml }) =>
          codeToHtml(s.diff, { lang: "diff", theme: "github-dark" }),
        )
        .then(setHighlight)
        .catch(() => setHighlight(""));
  }, [diff, s?.diff]);
  const passed = s?.liveSandbox
    ? s.liveSandbox.scenarios.filter(
        (r) => !compareEvidence(r.legacy, r.migrated).differences.length,
      ).length
    : s?.results.filter((r) => !r.differences.length).length || 0;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <Sunset size={27} />
          sundown<span className="brand-dot">.</span>
        </Link>
        <div className="merchant-select">
          <span className="merchant-avatar">H</span>
          <span>
            Horizon Supply<small>Migration workspace</small>
          </span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {pages.map((p) => (
            <Link
              aria-current={page === p.id ? "page" : undefined}
              href={"/" + p.id}
              className={page === p.id ? "active" : ""}
              key={p.id}
            >
              <p.icon size={17} />
              {p.name}
              {p.id === "parity" && passed < 6 && (
                <span className="nav-count">{6 - passed}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sandbox-note">
            <ShieldCheck size={17} />
            <span>
              Sandbox protected<small>No production payments</small>
            </span>
          </div>
          <button className="command-trigger" onClick={() => setPalette(true)}>
            <Search size={15} />
            Quick commands<kbd>⌘ K</kbd>
          </button>
          <span className="avatar">SA</span>
          <span className="operator">
            Sundown operator<small>Demo workspace</small>
          </span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span>{" "}
            <strong>{pages.find((p) => p.id === page)?.name}</strong>
          </span>
          <div>
            <span className="connection">
              <i className={connected ? "green" : "red"} />
              {connected ? "Stream connected" : "Reconnecting"}
            </span>
            <span className="mode-badge">
              <i />
              Replay data
            </span>
            <a
              href="/api/export?format=postman"
              aria-label="Download Postman collection"
            >
              <Download size={16} />
            </a>
          </div>
        </header>
        <main className="product-main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "passport"
                  ? `SITE ${siteId ?? 1} / MIGRATION PASSPORT`
                  : "HORIZON SUPPLY / PAYPAL MIGRATION"}
              </span>
              <h1>
                {page === "agent-demo"
                  ? "A checkout an agent can finish."
                  : page === "passport"
                    ? "Carry the proof forward."
                    : page === "overview"
                      ? "A clearer path forward."
                      : page === "plan"
                        ? "Every step, in order."
                        : page === "parity"
                          ? "Confidence, scenario by scenario."
                          : page === "readiness"
                            ? "Ready for what comes next."
                            : "One horizon. Twelve stores."}
              </h1>
              <p>
                {page === "agent-demo"
                  ? "From legacy friction to an auditable shop order."
                  : page === "passport"
                    ? "One site. One portable record of migration evidence."
                    : page === "overview"
                      ? "Your legacy checkout. A modern foundation. The evidence between."
                      : page === "plan"
                        ? "Infrastructure before cutover. Proof before traffic."
                        : page === "parity"
                          ? "Identical inputs. Normalized outcomes. Every difference accounted for."
                          : page === "readiness"
                            ? "Technical prerequisites for PayPal’s agentic commerce services."
                            : "Coordinate sandbox cutover windows across your merchant portfolio."}
              </p>
            </div>
            <button
              className="button"
              disabled={busy || s?.running}
              onClick={() =>
                action(page === "readiness" ? "migrate" : "parity")
              }
            >
              {busy || s?.running ? (
                <span className="spinner" />
              ) : (
                <Play size={14} />
              )}{" "}
              {page === "readiness" ? "Apply migration" : "Run parity check"}
            </button>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="info-banner">
            <span>
              <i />
              Replay workspace · synthetic fixtures, real migration logic. No
              credentials required.
            </span>
            <span>
              {s?.configuration.llm
                ? "AI connected"
                : "Deterministic assistant"}{" "}
              ·{" "}
              {s?.configuration.license
                ? "License configured"
                : "Trial components"}
            </span>
          </div>
          {!s ? (
            <div className="skeleton">Connecting to migration evidence…</div>
          ) : (
            <>
              {page === "agent-demo" && <ShoppingDemo migrated={s.migrated} />}
              {page === "passport" && <PassportView siteId={siteId} />}
              {page === "overview" && (
                <>
                  <div className="stats-grid">
                    {[
                      {
                        label: "LEGACY FINDINGS",
                        value: s.findings.length.toString(),
                        note:
                          "Across " +
                          new Set(s.findings.map((f) => f.file)).size +
                          " source files",
                        color: "amber-text",
                      },
                      {
                        label: "PARITY SCENARIOS",
                        value: passed + " / 6",
                        note:
                          passed === 6
                            ? "All replay outcomes match"
                            : "1 flow needs verification",
                        color: passed === 6 ? "green-text" : "amber-text",
                      },
                      {
                        label: "MIGRATION PROGRESS",
                        value: s.migrated ? "100%" : "0%",
                        note: s.migrated
                          ? "Orders v2 template applied"
                          : "Ready for review",
                        color: "cyan-text",
                      },
                      {
                        label: "AGENT READINESS",
                        value: s.checks.filter((c) => c.pass).length + " / 4",
                        note: "Replay prerequisites only",
                        color: "muted",
                      },
                    ].map((stat) => (
                      <div className="stat" key={stat.label}>
                        <span>{stat.label}</span>
                        <motion.strong
                          key={stat.value}
                          initial={{ opacity: 0.4, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={stat.color}
                        >
                          {stat.value}
                        </motion.strong>
                        <small>{stat.note}</small>
                      </div>
                    ))}
                  </div>
                  <section className="pipeline-panel">
                    <div className="panel-title">
                      <div>
                        <span className="eyebrow">THE MIGRATION PIPELINE</span>
                        <h2>A new route. The same promise.</h2>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => setDiff(true)}
                      >
                        Review migration diff <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <Scene
                      pipeline
                      statuses={s.results.map((r) => !r.differences.length)}
                      onSelect={setSelected}
                    />
                    <div className="pipeline-labels">
                      <span>
                        <i className="amber" />
                        LEGACY CHECKOUT <small>NVP / SOAP / Payments v1</small>
                      </span>
                      <span className="gate-label">ORDERS V2 CONVERSION</span>
                      <span>
                        <i className="cyan" />
                        VERIFIED OUTCOMES{" "}
                        <small>{passed} of 6 replay scenarios matching</small>
                      </span>
                    </div>
                  </section>
                  <div className="section-heading">
                    <h2>Evidence at a glance</h2>
                    <span className="mono muted">
                      AG STUDIO / SYNTHETIC REPLAY
                    </span>
                  </div>
                  <Studio s={s} focus={focus} onSelect={setSelected} />
                </>
              )}
              {page === "plan" && (
                <>
                  <div className="section-heading">
                    <h2>Migration dependencies</h2>
                    <button className="text-link" onClick={() => setDiff(true)}>
                      Review & apply diff <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {s.tasks.some((t) => t.flagged) && (
                    <div className="warning-banner">
                      <AlertTriangle size={16} />
                      Planner deferred parity and cutover by two working days
                      after a mismatch. Review the updated window.
                    </div>
                  )}
                  <Timeline s={s} />
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Depends on</th>
                        <th>Scheduled</th>
                        <th>Gate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.tasks.map((t) => (
                        <tr key={t.id}>
                          <td>
                            {t.id.toString().padStart(2, "0")} · {t.name}
                          </td>
                          <td>{t.predecessors.join(", ") || "—"}</td>
                          <td>{t.startDate}</td>
                          <td className={t.flagged ? "amber-text" : "muted"}>
                            {t.flagged ? "Review deferred window" : "Scheduled"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    className="button secondary"
                    onClick={() => action("migrate")}
                  >
                    Apply Orders v2 migration <GitBranch size={15} />
                  </button>
                </>
              )}
              {page === "parity" && (
                <>
                  <div className="two-column">
                    <section className="border-panel">
                      <div className="panel-title">
                        <h2>Differential parity matrix</h2>
                        <span className="tag">
                          {passed} / 6 COMPARED DIMENSIONS MATCH
                        </span>
                      </div>
                      <Matrix s={s} onSelect={setSelected} />
                      <div className="panel-foot">
                        Click a scenario to compare normalized outcomes.
                      </div>
                    </section>
                    <section className="border-panel">
                      <div className="panel-title">
                        <h2>Verifier journal</h2>
                        <Terminal size={16} />
                      </div>
                      <div className="journal">
                        {s.logs.length ? (
                          s.logs.map((l, i) => (
                            <div key={i}>
                              <span>{String(l.created).slice(11, 19)}</span>
                              <p>{String(l.message)}</p>
                            </div>
                          ))
                        ) : (
                          <p className="muted">
                            No runs yet. Run parity to generate a persisted
                            verification journal.
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
                  <div className="export-row">
                    <span className="muted">Take the evidence with you.</span>
                    {["json", "html", "postman"].map((f) => (
                      <a
                        key={f}
                        className="button secondary small"
                        href={"/api/export?format=" + f}
                      >
                        <Download size={14} />
                        {f.toUpperCase()}
                      </a>
                    ))}
                  </div>
                </>
              )}
              {page === "readiness" && (
                <>
                  <div className="readiness-intro">
                    <ShieldCheck size={36} />
                    <h2>
                      {s.checks.every((c) => c.pass)
                        ? "Replay prerequisites met."
                        : "A few steps from the next chapter."}
                    </h2>
                    <p>
                      These checks inspect generated source and synthetic replay
                      outcomes; they do not verify live checkout parity. Store
                      Sync has limited availability. PayPal must approve access.
                      <br />
                      Current scope: physical goods, US customers, USD.
                    </p>
                  </div>
                  <div className="checks">
                    {s.checks.map((c, i) => (
                      <div key={c.name}>
                        <span
                          className={
                            c.pass ? "check-circle" : "check-circle pending"
                          }
                        >
                          {c.pass ? <Check size={15} /> : i + 1}
                        </span>
                        <span>{c.name}</span>
                        <span className={c.pass ? "green-text" : "muted"}>
                          {c.pass ? "Replay check passed" : "Pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="two-column">
                    <section className="border-panel">
                      <div className="panel-title">
                        <h2>Product catalog</h2>
                        <span className="tag">
                          {s.products.length} PRODUCTS
                        </span>
                      </div>
                      {s.products.map((p) => (
                        <div className="catalog-row" key={p.id}>
                          <span className="product-object">
                            {p.id.slice(-2)}
                          </span>
                          <span>
                            {p.name}
                            <small>{p.id} · Physical goods</small>
                          </span>
                          <code>${p.price}</code>
                        </div>
                      ))}
                      <p className="panel-foot">
                        {s.migrated
                          ? "catalog.json generated in workspace/migrated-shop"
                          : "Apply migration to generate catalog.json."}
                      </p>
                    </section>
                    <section className="border-panel padded">
                      <span className="eyebrow">A SAFE CUTOVER</span>
                      <h2>Watch the first light.</h2>
                      <p>
                        Simulate a canary window. EWMA and z-score analysis
                        detect a seeded error spike and calculate a rollback
                        decision. No real traffic is routed.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => action("canary")}
                        disabled={busy}
                      >
                        Simulate canary <ArrowRight size={15} />
                      </button>
                      {s.canary && (
                        <p className="amber-text">
                          Simulated traffic · anomaly detected · automatic
                          rollback decision.
                        </p>
                      )}
                      <Link
                        className="text-link"
                        href="/checkout"
                        style={{ display: "flex", marginTop: 20 }}
                      >
                        Try the sandbox checkout <ArrowUpRight size={14} />
                      </Link>
                      <a
                        className="text-link"
                        href="https://developer.paypal.com/store-sync/overview"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read Store Sync requirements <ArrowUpRight size={14} />
                      </a>
                    </section>
                  </div>
                </>
              )}
              {page === "portfolio" && (
                <>
                  <div className="section-heading">
                    <h2>Agency cutover windows</h2>
                    <span className="tag">12 DEMO MERCHANTS · LOCAL TIME</span>
                  </div>
                  <Timeline s={s} portfolio />
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Merchant</th>
                        <th>Legacy integration</th>
                        <th>Region</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.merchants.map((m) => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>{m.integration}</td>
                          <td>
                            {m.region} / {m.currency}
                          </td>
                          <td>
                            <span
                              className={m.risk > 70 ? "amber-text" : "muted"}
                            >
                              {m.risk}/100
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <section className="assistant-bar">
                <div>
                  <span className="assistant-mark">✦</span>
                  <h3>Ask your workspace</h3>
                  <span className="muted">Evidence, in plain language.</span>
                </div>
                <form onSubmit={ask}>
                  <input
                    aria-label="Ask dashboard agent"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Which flows still fail refund parity?"
                    required
                  />
                  <button aria-label="Ask agent">
                    <ArrowUpRight size={20} />
                  </button>
                </form>
                {answer && <p role="status">{answer}</p>}
                {focus && (
                  <span className="tag">
                    Evidence widget: {focus} (open Overview)
                  </span>
                )}
              </section>
              <div className="product-bottom">
                <span>SUNDOWN / CHECKOUT WITH A FUTURE</span>
                <button
                  disabled={busy || s.running}
                  onClick={() => action("reset")}
                >
                  <RotateCcw size={12} /> Reset replay
                </button>
              </div>
            </>
          )}
        </main>
      </div>
      <Command.Dialog
        open={palette}
        onOpenChange={setPalette}
        label="Workspace commands"
      >
        <Command.Input placeholder="Where would you like to go?" />
        <Command.List>
          <Command.Empty>No matching command.</Command.Empty>
          {pages.map((p) => (
            <Command.Item
              key={p.id}
              onSelect={() => {
                window.location.href = "/" + p.id;
              }}
            >
              {p.name}
              <ArrowUpRight size={14} />
            </Command.Item>
          ))}
          <Command.Item
            onSelect={() => {
              setPalette(false);
              action("parity");
            }}
          >
            Run parity check
          </Command.Item>
          <Command.Item
            onSelect={() => {
              setPalette(false);
              setDiff(true);
            }}
          >
            Review migration diff
          </Command.Item>
        </Command.List>
      </Command.Dialog>
      {(selected !== null || diff) && s && (
        <motion.div
          className="drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            setSelected(null);
            setDiff(false);
          }}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Evidence detail"
            className="drawer"
            initial={{ x: 500 }}
            animate={{ x: 0 }}
            exit={{ x: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-drawer"
              aria-label="Close details"
              onClick={() => {
                setSelected(null);
                setDiff(false);
              }}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">
              {diff
                ? "REWRITER / REVIEWABLE CHANGE"
                : "PARITY / NORMALIZED EVIDENCE"}
            </span>
            <h2>
              {diff ? "From NVP to Orders v2." : s.results[selected!]?.label}
            </h2>
            {diff ? (
              <>
                <p>
                  Known-shop template transform. Generated files and diff are
                  retained in the workspace.
                </p>
                <button
                  className="button"
                  disabled={busy || s.running}
                  onClick={() => action("migrate")}
                >
                  {s.migrated
                    ? "Reapply migration"
                    : "Apply to isolated branch"}{" "}
                  <GitBranch size={14} />
                </button>
                {s.migrated && (
                  <p role="status">
                    Migration files and catalog written to
                    workspace/migrated-shop.
                  </p>
                )}
                {highlight ? (
                  <div
                    className="diff-code"
                    dangerouslySetInnerHTML={{ __html: highlight }}
                  />
                ) : (
                  <pre>{s.diff}</pre>
                )}
              </>
            ) : (
              <>
                <span className="tag">SYNTHETIC REPLAY TRANSCRIPT</span>
                <h3>Legacy</h3>
                <pre>
                  {JSON.stringify(s.results[selected!].legacy, null, 2)}
                </pre>
                <h3>Orders v2</h3>
                <pre>
                  {JSON.stringify(s.results[selected!].migrated, null, 2)}
                </pre>
                <h3>Differences</h3>
                <pre>
                  {JSON.stringify(s.results[selected!].differences, null, 2)}
                </pre>
              </>
            )}
          </motion.aside>
        </motion.div>
      )}
    </div>
  );
}
