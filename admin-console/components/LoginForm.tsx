"use client";

import { FormEvent, useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password") }),
    });
    if (response.ok) {
      window.location.reload();
      return;
    }
    setBusy(false);
    setError("Administrative sign-in failed.");
  }

  return (
    <main className="login">
      <form className="card stack" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark">S</div>
          <div><strong>SolveLang Admin</strong><div className="muted">Private operations console</div></div>
        </div>
        <div className="notice">This console is separate from customer authentication and never exposes the API admin secret to the browser.</div>
        <label>
          Admin password
          <input name="password" type="password" autoComplete="current-password" minLength={12} required autoFocus />
        </label>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
