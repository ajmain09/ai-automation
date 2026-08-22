"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", body: form });
    if (!response.ok) { const data = await response.json().catch(() => null); setError(data?.error ?? "Unable to sign in"); setLoading(false); return; }
    window.location.href = "/dashboard";
  }

  return <form onSubmit={submit}>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="field"><label htmlFor="email">Email address</label><input className="input" id="email" name="email" type="email" autoComplete="email" placeholder="admin@example.com" required /></div>
    <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></div>
    <button className="button primary full" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
  </form>;
}
