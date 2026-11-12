"use client";
import { useState } from "react";
import Link from "next/link";
export default function LoginForm({
  workspacePassword,
}: {
  workspacePassword: string | null;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign("/overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 560, margin: "10vh auto", padding: 28 }}>
      <Link className="brand" href="/">
        sundown.
      </Link>
      <p className="eyebrow" style={{ marginTop: 40 }}>
        WELCOME TO SUNDOWN
      </p>
      <h1 style={{ fontSize: 42, margin: "18px 0" }}>
        Explore the full workspace.
      </h1>
      <p className="muted">
        Sign in to explore the dashboard, migration plan, parity matrix,
        readiness, agent checkout and Migration Passports.
      </p>
      <form
        onSubmit={login}
        style={{ display: "grid", gap: 16, marginTop: 36 }}
      >
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: 14,
            color: "#e5eadb",
            background: "#172218",
            border: "1px solid #55634e",
            borderRadius: 5,
          }}
        />
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <button className="button secondary" disabled={busy}>
          {busy ? "Signing in…" : "Open workspace"}
        </button>
      </form>
      {workspacePassword && (
        <aside
          style={{
            marginTop: 24,
            padding: 20,
            border: "1px solid #55634e",
            borderRadius: 8,
          }}
        >
          <p className="eyebrow">WORKSPACE ACCESS</p>
          <p>Use this password to explore every workspace page:</p>
          <code
            style={{ fontSize: 20, color: "#ffc18f", overflowWrap: "anywhere" }}
          >
            {workspacePassword}
          </code>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Payments run in the PayPal sandbox. Replay and simulated results are
            labelled.
          </p>
        </aside>
      )}
    </main>
  );
}
