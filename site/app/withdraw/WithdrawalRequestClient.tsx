"use client";

import { useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";

export function WithdrawalRequestClient() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(form: HTMLFormElement) {
    if (!apiBase) {
      setError("Withdrawal confirmation is not configured. Email hello@solve-lang.com instead.");
      return;
    }
    const data = new FormData(form);
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
        }),
      });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "Your request could not be recorded.");
      form.reset();
      setStatus(body.message || "Your request was received. Eligibility will be reviewed under applicable law.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your request could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mt-8 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <label className="block text-sm font-semibold text-slate-900" htmlFor="withdraw-name">Name
        <input id="withdraw-name" name="name" required maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-900" htmlFor="withdraw-contract-reference">Payment or contract reference
        <input id="withdraw-contract-reference" name="contractReference" required maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-900" htmlFor="withdraw-email">Email
        <input id="withdraw-email" name="email" type="email" autoComplete="email" required maxLength={254} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
      </label>
      <label className="block text-sm font-semibold text-slate-900" htmlFor="withdraw-statement">Withdrawal statement
        <textarea id="withdraw-statement" name="statement" required minLength={8} maxLength={1000} className="mt-1 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" placeholder="I hereby withdraw from the contract for Workflow Preflight." />
      </label>
      <p className="text-xs leading-5 text-slate-600">Do not include card numbers, workflow contents, credentials, or secrets. Submission records your request with a server timestamp and sends a durable confirmation only after the required provider is available. It does not decide eligibility or promise a refund.</p>
      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      {status ? <p role="status" className="text-sm font-medium text-emerald-700">{status}</p> : null}
      <button type="submit" disabled={submitting} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {submitting ? "Sending..." : "Submit withdrawal request"}
      </button>
    </form>
  );
}
