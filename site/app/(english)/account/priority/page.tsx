"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  newRequestId,
  normalizeApiBase,
} from "@/app/account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const PRIORITY_RELEASED = process.env.NEXT_PUBLIC_CUSTOMER_PRIORITY_ENABLED === "true";
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

type PriorityName = "standard" | "express" | "priority" | "critical";
type StoredSource = { fingerprint: string; bytes: number };
type Quote = {
  priority: PriorityName;
  label: string;
  creditMultiplier: number;
  baseCredits: number;
  weightedCredits: number;
  inputTokens: number;
  outputTokens: number;
};
type Job = {
  jobId: string;
  status: string;
  priority: PriorityName;
  weightedCredits: number;
  createdAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  result?: { reportId?: string; provider?: string } | null;
  errorCode?: string | null;
};

async function uploadSource(file: File, csrfToken: string): Promise<StoredSource> {
  if (file.size < 4 || file.size > MAX_SOURCE_BYTES) throw new Error("Choose a ZIP archive up to 5 MiB.");
  const response = await fetch(`${API_BASE}/customer/priority/source`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/zip",
      "x-solvelang-csrf": csrfToken,
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({ error: "Invalid server response." }));
  if (!response.ok) throw new Error(payload.error || "Repository source could not be uploaded.");
  return payload.source as StoredSource;
}

export default function CustomerPriorityPage() {
  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [source, setSource] = useState<StoredSource | null>(null);
  const [priority, setPriority] = useState<PriorityName>("standard");
  const [inputTokens, setInputTokens] = useState("5000");
  const [outputTokens, setOutputTokens] = useState("1000");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!PRIORITY_RELEASED) return;
    let active = true;
    customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" })
      .then((account) => { if (active) setDashboard(account); })
      .catch((caught) => {
        if (!active) return;
        const message = caught instanceof CustomerApiError && caught.status === 401
          ? "Sign in to your API account before using priority processing."
          : caught instanceof Error ? caught.message : "API account could not be loaded.";
        setError(message);
      });
    return () => { active = false; };
  }, []);

  if (!PRIORITY_RELEASED) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
        <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Customer priority</p>
          <h1 className="mt-3 text-4xl font-bold">Priority processing is not released yet.</h1>
          <p className="mt-5 text-slate-300">The queue, source-storage, and provider-execution gates remain disabled. No weighted priority credits can be consumed from this page.</p>
          <Link className="mt-8 inline-block font-semibold text-cyan-300 underline" href="/account/api-keys/">Return to API account</Link>
        </section>
      </main>
    );
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;
    const input = event.currentTarget.elements.namedItem("source") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setQuote(null); setJob(null);
    try {
      setSource(await uploadSource(file, dashboard.csrfToken));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Repository source could not be uploaded.");
    } finally { setBusy(false); }
  }

  async function requestQuote() {
    if (!dashboard || !source) return;
    setBusy(true); setError(""); setJob(null);
    try {
      const result = await customerApi<{ quote: Quote }>(API_BASE, "/customer/priority/quote", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
        body: JSON.stringify({ priority, inputTokens: Number(inputTokens), outputTokens: Number(outputTokens) }),
      });
      setQuote(result.quote);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Priority quote could not be calculated.");
    } finally { setBusy(false); }
  }

  async function submitJob() {
    if (!dashboard || !source || !quote) return;
    setBusy(true); setError("");
    try {
      const result = await customerApi<{ job: Job }>(API_BASE, "/customer/priority/jobs", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
        body: JSON.stringify({
          requestId: newRequestId(),
          sourceFingerprint: source.fingerprint,
          priority: quote.priority,
          inputTokens: quote.inputTokens,
          outputTokens: quote.outputTokens,
        }),
      });
      setJob(result.job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Priority job could not be submitted.");
    } finally { setBusy(false); }
  }

  async function refreshJob() {
    if (!job) return;
    setBusy(true); setError("");
    try {
      const result = await customerApi<{ job: Job }>(API_BASE, `/customer/priority/jobs/${encodeURIComponent(job.jobId)}`, { method: "GET" });
      setJob(result.job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Priority job status could not be loaded.");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
      <section className="mx-auto max-w-4xl space-y-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Customer priority</p>
          <h1 className="mt-2 text-4xl font-bold">Repository Audit priority processing</h1>
          <p className="mt-3 text-slate-300">Upload a ZIP, review the weighted-credit quote, then submit. Source ownership and existence are checked before credits are consumed.</p>
        </header>

        {!dashboard ? <div className="rounded-2xl border border-white/10 bg-white/5 p-6">Loading your signed-in API account…</div> : null}
        {dashboard ? (
          <>
            <form onSubmit={handleUpload} className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <label className="block text-sm font-semibold" htmlFor="source">Repository ZIP (max 5 MiB)</label>
              <input id="source" name="source" type="file" accept=".zip,application/zip" required className="mt-3 block w-full" />
              <button disabled={busy} className="mt-4 rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 disabled:opacity-60">Upload source</button>
              {source ? <p className="mt-3 break-all text-sm text-slate-300">Stored {source.bytes.toLocaleString()} bytes · SHA-256 {source.fingerprint}</p> : null}
            </form>

            <section className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 md:grid-cols-3">
              <label className="text-sm">Lane<select value={priority} onChange={(event) => setPriority(event.target.value as PriorityName)} className="mt-2 w-full rounded-lg bg-slate-900 p-3"><option value="standard">Standard · 1x</option><option value="express">Express · 2x</option><option value="priority">Priority · 5x</option><option value="critical">Critical · 10x</option></select></label>
              <label className="text-sm">Input tokens<input value={inputTokens} onChange={(event) => setInputTokens(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-lg bg-slate-900 p-3" /></label>
              <label className="text-sm">Output tokens<input value={outputTokens} onChange={(event) => setOutputTokens(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-lg bg-slate-900 p-3" /></label>
              <button disabled={busy || !source} onClick={requestQuote} className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 disabled:opacity-50">Get quote</button>
            </section>

            {quote ? <section className="rounded-2xl border border-cyan-300/30 bg-cyan-300/5 p-6"><h2 className="text-xl font-bold">Quote</h2><p className="mt-2">{quote.label}: {quote.baseCredits} base credits × {quote.creditMultiplier} = <strong>{quote.weightedCredits} weighted credits</strong></p><button disabled={busy} onClick={submitJob} className="mt-4 rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950">Submit job</button></section> : null}
            {job ? <section className="rounded-2xl border border-white/10 bg-white/5 p-6"><h2 className="text-xl font-bold">Job {job.jobId}</h2><p className="mt-2">Status: <strong>{job.status}</strong> · {job.weightedCredits} weighted credits</p>{job.result?.reportId ? <p className="mt-2">Report: {job.result.reportId}</p> : null}{job.errorCode ? <p className="mt-2 text-red-200">Error: {job.errorCode}</p> : null}<button disabled={busy} onClick={refreshJob} className="mt-4 rounded-xl bg-white px-5 py-3 font-bold text-slate-950">Refresh status</button></section> : null}
          </>
        ) : null}
        {error ? <p className="rounded-xl bg-red-400/10 p-4 text-red-200">{error}</p> : null}
        <Link className="inline-block font-semibold text-cyan-300 underline" href="/account/api-keys/">Back to API account</Link>
      </section>
    </main>
  );
}
