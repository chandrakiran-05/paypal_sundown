"use client";
import { useState } from "react";
import Link from "next/link";
export default function Login() {
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
        PRIVATE OPERATOR WORKSPACE
      </p>
      <h1 style={{ fontSize: 42, margin: "18px 0" }}>Admin sign in.</h1>
      <p className="muted">
        Judging the project? The interactive demo opens immediately, without an
        account.
      </p>
      <Link className="button" href="/demo">
        Open Judge Demo →
      </Link>
      <form
        onSubmit={login}
        style={{ display: "grid", gap: 16, marginTop: 36 }}
      >
        <label htmlFor="admin-password">Admin password</label>
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
          {busy ? "Signing in…" : "Sign in to private workspace"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 24, fontSize: 13 }}>
        Private business records and real sandbox payment controls require admin
        access. The server-side admin password must be configured only if you
        want to use those tools.
      </p>
    </main>
  );
}
