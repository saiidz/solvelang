"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Turnstile = {
  render(container: HTMLElement, options: { sitekey: string; action: "withdrawal"; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  remove(widgetId: string): void;
};

function withdrawalTurnstile(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile;
}

export function WithdrawalRequestClient() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const requestIdRef = useRef("");

  useEffect(() => {
    const turnstile = withdrawalTurnstile();
    if (!turnstileReady || !turnstileSiteKey || !turnstileContainerRef.current || !turnstile) return;
    const widgetId = turnstile.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "withdrawal",
      callback: setTurnstileToken,
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken(""),
    });
    turnstileWidgetRef.current = widgetId;
    return () => withdrawalTurnstile()?.remove(widgetId);
  }, [turnstileReady]);

  async function submit(form: HTMLFormElement) {
    if (!apiBase) {
      setError("Withdrawal confirmation is not configured. Email hello@solve-lang.com instead.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the human verification before sending your request.");
      return;
    }
    const data = new FormData(form);
    const requestId = requestIdRef.current || crypto.randomUUID();
    requestIdRef.current = requestId;
    setSubmitting(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`${apiBase}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          contractReference: data.get("contractReference"),
          email: data.get("email"),
          statement: data.get("statement"),
          turnstileToken,
          requestId,
        }),
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Your request could not be recorded.");
      form.reset();
      setTurnstileToken("");
      requestIdRef.current = "";
      setStatus(body.message || "Your request was received. Eligibility will be reviewed under applicable law.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your request could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mt-8 space-y-5 rounded-xl border border-line bg-panel p-6 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setTurnstileReady(true)} /> : null}
      <label className="block text-sm font-semibold text-ink" htmlFor="withdraw-name">Name
        <input id="withdraw-name" name="name" required maxLength={160} className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-ink" htmlFor="withdraw-contract-reference">Payment or contract reference
        <input id="withdraw-contract-reference" name="contractReference" required maxLength={160} className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-ink" htmlFor="withdraw-email">Email
        <input id="withdraw-email" name="email" type="email" autoComplete="email" required maxLength={254} className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-ink" htmlFor="withdraw-statement">Withdrawal statement
        <textarea id="withdraw-statement" name="statement" required minLength={8} maxLength={1000} className="mt-1 min-h-28 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" placeholder="I hereby withdraw from the contract for Workflow Preflight." />
      </label>
      <div ref={turnstileContainerRef} className="cf-turnstile" data-sitekey={turnstileSiteKey} data-action="withdrawal" aria-label="Human verification" />
      <p className="text-xs leading-5 text-muted">Do not include card numbers, workflow contents, credentials, or secrets. Submission records your request with a server timestamp and sends a durable confirmation only after the required provider is available. It does not decide eligibility or promise a refund.</p>
      {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
      {status ? <p role="status" className="text-sm font-medium text-success">{status}</p> : null}
      <button type="submit" disabled={submitting || !turnstileToken} className="rounded-lg bg-accent-solid px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60">
        {submitting ? "Sending..." : "Submit withdrawal request"}
      </button>
    </form>
  );
}
