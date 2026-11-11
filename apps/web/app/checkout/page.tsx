/** Redirect-based sandbox checkout; the catalog price is always computed on the server. */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { products } from "@sundown/engine";
export default function Checkout() {
  const [productId, setProductId] = useState(products[0].id),
    [quantity, setQuantity] = useState(1),
    [orderId, setOrderId] = useState(""),
    [captureId, setCaptureId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refund, setRefund] = useState("12.00");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setOrderId(params.get("token") || "");
    if (params.has("cancelled"))
      setMessage("Buyer cancelled. No capture was requested.");
  }, []);
  async function execute(action: "create" | "capture" | "refund") {
    setBusy(true);
    setMessage("");
    const storageKey =
      "sundown-" +
      action +
      "-" +
      (action === "create" ? productId + "-" + quantity : orderId) +
      (action === "refund" ? "-" + refund : "");
    const requestId = sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, requestId);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          requestId,
          ...(action === "create" ? { productId, quantity } : { id: orderId }),
          ...(action === "refund" ? { amount: refund } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === "create") {
        location.assign(result.approvalUrl);
        return;
      }
      if (action === "capture") {
        setCaptureId(result.captureId);
        sessionStorage.removeItem(
          "sundown-create-" + productId + "-" + quantity,
        );
        setMessage(
          "Sandbox capture " + result.status + " · $" + result.amount + " USD.",
        );
      } else
        setMessage(
          "Sandbox refund " + result.status + " · $" + result.amount + " USD.",
        );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sandbox request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="landing-section" style={{ maxWidth: 800, margin: "auto" }}>
      <Link className="brand" href="/">
        sundown.
      </Link>
      <span className="eyebrow" style={{ marginTop: 45 }}>
        HORIZON SUPPLY / SANDBOX CHECKOUT
      </span>
      <h1 style={{ fontSize: 48, margin: "16px 0" }}>
        Try the migrated checkout.
      </h1>
      <p className="muted">
        Sandbox account required. Replay mode rejects these operations
        explicitly.
      </p>
      <div className="checks" style={{ marginTop: 30 }}>
        {products.map((p) => (
          <label
            key={p.id}
            style={{
              display: "flex",
              gap: 14,
              padding: 20,
              borderBottom: "1px solid var(--line)",
            }}
          >
            <input
              type="radio"
              name="product"
              checked={productId === p.id}
              onChange={() => setProductId(p.id)}
            />
            {p.name}
            <span style={{ marginLeft: "auto" }}>${p.price} USD</span>
          </label>
        ))}
      </div>
      <label>
        Quantity{" "}
        <input
          aria-label="Quantity"
          type="number"
          min={1}
          max={10}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          style={{
            background: "var(--panel)",
            padding: 10,
            width: 75,
            margin: 15,
            border: "1px solid var(--line)",
          }}
        />
      </label>
      <button
        className="button"
        disabled={busy}
        onClick={() => execute("create")}
      >
        Approve in PayPal sandbox →
      </button>
      {orderId && (
        <section className="border-panel padded" style={{ marginTop: 25 }}>
          <span className="eyebrow">RETURN URL · APPROVAL NOT VERIFIED</span>
          <p>Order {orderId}</p>
          <button
            className="button"
            disabled={busy || !!captureId}
            onClick={() => execute("capture")}
          >
            Request sandbox capture
          </button>
          {captureId && (
            <div style={{ marginTop: 20 }}>
              <p>Capture {captureId}</p>
              <label>
                Refund amount (USD){" "}
                <input
                  aria-label="Refund amount"
                  value={refund}
                  onChange={(e) => setRefund(e.target.value)}
                  style={{
                    background: "var(--panel)",
                    padding: 10,
                    width: 100,
                    border: "1px solid var(--line)",
                  }}
                />
              </label>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => execute("refund")}
              >
                Refund capture
              </button>
            </div>
          )}
        </section>
      )}
      {message && (
        <p role="status" className="warning-banner">
          {message}
        </p>
      )}
      <p style={{ marginTop: 30 }}>
        <Link className="text-link" href="/overview">
          Return to migration workspace →
        </Link>
      </p>
    </main>
  );
}
