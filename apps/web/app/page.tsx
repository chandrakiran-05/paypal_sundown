/** Sunset-led product introduction with a lazy procedural horizon. */
"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ArrowRight,
  Sunset,
  GitBranch,
  ShieldCheck,
  Workflow,
} from "lucide-react";
const Scene = dynamic(() => import("../components/scene"), {
  ssr: false,
  loading: () => <div className="horizon-scene static-sun" />,
});
export default function Landing() {
  return (
    <>
      <nav className="landing-nav">
        <Link className="brand" href="/">
          <Sunset />
          sundown<span className="brand-dot">.</span>
        </Link>
        <div>
          <a href="#how">The process</a>
          <a href="#proof">Built on evidence</a>
          <Link className="button small" href="/demo">
            Open Judge Demo <ArrowUpRight size={15} />
          </Link>
        </div>
      </nav>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <i /> THE NEXT CHAPTER OF CHECKOUT
            </span>
            <h1>
              Let legacy set.
              <br />
              <em>Move forward.</em>
            </h1>
            <p>
              Your PayPal integration has a future.
              <br />
              Migrate to Orders v2, prove every flow, and
              <br className="desktop" /> prepare for agentic commerce.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/demo">
                Try the Judge Demo <ArrowRight size={17} />
              </Link>
              <span className="mono muted">NO CREDENTIALS NEEDED</span>
            </div>
          </div>
          <div className="hero-visual">
            <Scene />
            <span className="visual-label mono">
              A NEW HORIZON FOR YOUR CHECKOUT
            </span>
            <div className="horizon-note">
              <span className="status-dot" />
              LEGACY → ORDERS V2<span>Sandbox first. Evidence always.</span>
            </div>
          </div>
          <div className="hero-bottom">
            <span>01 / THE SUNSET IS A BEGINNING</span>
            <span>SCROLL TO EXPLORE ↓</span>
          </div>
        </section>
        <section id="how" className="landing-section">
          <div className="section-intro">
            <span className="eyebrow">FROM ENDPOINTS TO EVIDENCE</span>
            <h2>
              A migration you
              <br />
              can stand behind.
            </h2>
            <p>
              Understand what you have. Change what matters.
              <br />
              Verify the checkout your customers depend on.
            </p>
          </div>
          <div className="steps">
            {[
              {
                n: "01",
                icon: GitBranch,
                title: "Find the legacy.",
                body: "Deterministic scanning. Every finding tied to a file, a line, and an official replacement.",
              },
              {
                n: "02",
                icon: Workflow,
                title: "Make the move.",
                body: "A dependency-aware plan and a reviewable Orders v2 diff. Infrastructure before cutover.",
              },
              {
                n: "03",
                icon: ShieldCheck,
                title: "Prove the parity.",
                body: "Six checkout scenarios. Normalized outcomes. A verifier loop that shows its work.",
              },
            ].map((s) => (
              <article key={s.n}>
                <span className="mono muted">{s.n}</span>
                <s.icon size={24} />
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="proof" className="landing-section proof-section">
          <span className="eyebrow">THE CONVERSION PIPELINE</span>
          <h2>
            Same checkout.
            <br />
            <em>A different horizon.</em>
          </h2>
          <Scene pipeline statuses={[true, true, true, true, false, true]} />
          <div className="pipeline-legend">
            <span>
              <i className="amber" />
              Legacy calls
            </span>
            <span>Conversion gate</span>
            <span>
              <i className="green" />
              Parity verified
            </span>
            <span>
              <i className="red" />
              Needs attention
            </span>
          </div>
          <p>
            Replay data is synthetic and clearly labelled. Live sandbox evidence
            is never inferred from fixtures.
          </p>
          <Link href="/demo" className="text-link">
            Inspect the evidence <ArrowUpRight size={16} />
          </Link>
        </section>
      </main>
      <footer>
        <Link className="brand" href="/">
          sundown.
        </Link>
        <span>Legacy checkout → Orders v2 → agent-ready, with proof.</span>
        <span>BUILT FOR THE NEXT CHAPTER</span>
      </footer>
    </>
  );
}
