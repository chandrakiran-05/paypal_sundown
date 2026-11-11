"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ShopOrder } from "../lib/agent-shop";
type Result = {
  legacy?: { reason: string };
  order: Omit<ShopOrder, "owner">;
  steps?: string[];
};
export default function ShoppingDemo({ migrated }: { migrated: boolean }) {
  const [available, setAvailable] = useState(false),
    [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/shopping-agent")
      .then((r) => r.json())
      .then((data) => {
        if (active) setAvailable(data.sandboxAvailable);
      })
      .catch(() => {
        if (active) setError("Could not read agent configuration.");
      });
    const id = sessionStorage.getItem("sundown-agent-order");
    if (id)
      fetch(`/api/shopping-agent?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((data) => {
          if (active && data.order) setResult(data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (
      !result ||
      result.order.mode !== "sandbox" ||
      result.order.status === "PAID"
    )
      return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetch(`/api/shopping-agent?id=${encodeURIComponent(result.order.id)}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.order) setResult((old) => ({ ...old, order: data.order }));
        })
        .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [result?.order.id, result?.order.mode, result?.order.status]);
  async function run(command: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/shopping-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Agent operation failed");
      setResult(data);
      sessionStorage.setItem("sundown-agent-order", data.order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent operation failed");
    } finally {
      setBusy(false);
    }
  }
  const steps =
    result?.steps ??
    (result
      ? result.order.mode === "simulated"
        ? [
            "Simulated: create_order",
            "Simulated: buyer approval and pay_order",
            "Simulated: capture webhook delivered; shop DB marked PAID",
          ]
        : [
            "PayPal Agent Toolkit: create_order",
            result.order.capture_id
              ? "Capture recorded"
              : "Buyer approval and capture required",
            result.order.status === "PAID"
              ? "Verified completion webhook; shop DB marked PAID"
              : "Awaiting verified completion webhook",
          ]
      : []);
  return (
    <div className="upgrade-stack">
      <section className="panel upgrade-intro">
        <span className="eyebrow">ONE INTENT / TWO CHECKOUT CONTRACTS</span>
        <h2>Buy one Horizon cup.</h2>
        <p>
          A deterministic shopping agent inspects the legacy contract, then uses
          PayPal Agent Toolkit tools for the migrated shop. One cup, USD 24.00.
          No language-model credentials needed.
        </p>
        {!migrated && (
          <p className="error-banner">
            Apply the migration from{" "}
            <Link href="/readiness">Agent readiness</Link> before starting.
          </p>
        )}
        <div className="upgrade-actions">
          <button
            className="button"
            disabled={busy || !migrated}
            onClick={() =>
              run({
                action: "start",
                mode: "simulated",
                requestId: crypto.randomUUID(),
              })
            }
          >
            {busy ? "Working…" : "Run Simulated checkout"}
          </button>
          <button
            className="button secondary"
            disabled={busy || !migrated || !available}
            onClick={() =>
              run({
                action: "start",
                mode: "sandbox",
                requestId: crypto.randomUUID(),
              })
            }
          >
            Run PayPal sandbox
          </button>
        </div>
        <p className="muted">
          {available
            ? "Sandbox configured. Buyer approval and a publicly reachable, registered webhook are required."
            : "Sandbox unavailable: configure PAYPAL_MODE=live, sandbox credentials and PAYPAL_WEBHOOK_ID. The Simulated path makes no PayPal requests."}
        </p>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
      </section>
      <div className="upgrade-columns">
        <section className="panel upgrade-card">
          <span className="eyebrow">01 / LEGACY SHOP</span>
          <h2>{result ? "Checkout blocked" : "Legacy capability check"}</h2>
          <span className="evidence-tag">Source inspection</span>
          <p>
            {result?.legacy?.reason ||
              "The demo legacy shop uses NVP Express Checkout and IPN. Those interfaces do not implement the agent's Orders v2 tool contract."}
          </p>
          <p className="muted">
            Failure means unsupported contract. No legacy payment is sent.
          </p>
        </section>
        <section className="panel upgrade-card">
          <span className="eyebrow">02 / MIGRATED SHOP</span>
          <h2>
            {result?.order.status === "PAID"
              ? "Order paid in shop DB"
              : result
                ? "Order created"
                : "Ready for an agent"}
          </h2>
          <span className="evidence-tag">
            {result
              ? result.order.mode === "simulated"
                ? "Simulated"
                : "PayPal sandbox"
              : "Not run"}
          </span>
          <p>
            {result
              ? `Shop DB status: ${result.order.status}. ${result.order.mode === "simulated" ? "Simulated capture and webhook; this is not a sandbox transaction." : "A capture response alone does not mark this order paid."}`
              : "Creates an order, requests buyer approval, captures it and waits for a verified completion webhook."}
          </p>
          {result && (
            <dl className="evidence-list">
              <dt>Order ID</dt>
              <dd>{result.order.id}</dd>
              <dt>Capture ID</dt>
              <dd>{result.order.capture_id || "Not captured"}</dd>
              <dt>Amount</dt>
              <dd>USD {result.order.amount}</dd>
            </dl>
          )}
          {result?.order.mode === "sandbox" &&
            result.order.status !== "PAID" && (
              <div className="upgrade-actions">
                {result.order.approval_url && (
                  <a
                    className="button secondary"
                    href={result.order.approval_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Approve in PayPal sandbox ↗
                  </a>
                )}
                <button
                  className="button"
                  disabled={busy || Boolean(result.order.capture_id)}
                  onClick={() =>
                    run({ action: "capture", id: result.order.id })
                  }
                >
                  Capture approved order
                </button>
              </div>
            )}
        </section>
      </div>
      {steps.length > 0 && (
        <section className="panel upgrade-card">
          <h2>Execution trace</h2>
          <ol className="execution-trace">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="muted">
            Persisted in the agent shop table in workspace/sundown.sqlite. A
            simulated webhook cannot settle a sandbox order.
          </p>
        </section>
      )}
      <Link href="/passport/1" className="text-link">
        Attach this evidence to Horizon's Migration Passport →
      </Link>
    </div>
  );
}
