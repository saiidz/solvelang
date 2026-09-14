"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CustomerApiError, type CustomerDashboard, customerApi, normalizeApiBase } from "@/app/account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
const SUPPORT_AUTOMATION_RELEASED = process.env.NEXT_PUBLIC_SUPPORT_AUTOMATION_ENABLED === "true";

type SupportStatus = {
  configured: boolean;
  automationState: string;
  provider?: "gmail" | "imap_smtp";
  inboxEmail?: string;
  mailHost?: string;
  mailFolder?: string;
  sourceInitialized?: boolean;
  taskProvider?: string;
  linearTeamId?: string;
  policyVersion?: string;
  allowedActions?: string[];
  revision?: number;
  updatedAt?: string;
  activationEnabled: boolean;
  message?: string;
};
type SupportEvent = {
  eventId: string;
  state: string;
  category?: string;
  urgency?: string;
  requiresReview: boolean;
  sensitiveReasons: string[];
  policyVersion?: string;
  actions: Array<{ action: string; status: string; reference?: string }>;
  createdAt?: string;
  updatedAt?: string;
};

type SetupForm = {
  inboxEmail: string;
  mailHost: string;
  mailFolder: string;
  mailCredentialSecretArn: string;
  linearCredentialSecretArn: string;
  linearTeamId: string;
  allowReply: boolean;
};

const initialForm: SetupForm = {
  inboxEmail: "hello@solve-lang.com",
  mailHost: "mx1.upcomingsounds.com",
  mailFolder: "INBOX",
  mailCredentialSecretArn: "",
  linearCredentialSecretArn: "",
  linearTeamId: "",
  allowReply: false,
};

function errorMessage(caught: unknown): string {
  if (caught instanceof CustomerApiError && caught.status === 401) return "Sign in to your SolveLang account before managing support automation.";
  return caught instanceof Error ? caught.message : "Support automation request failed.";
}

export default function SupportAutomationPage() {
  const [dashboard, setDashboard] = useState<CustomerDashboard | null>(null);
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [form, setForm] = useState<SetupForm>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (account: CustomerDashboard) => {
    const [nextStatus, history] = await Promise.all([
      customerApi<SupportStatus>(API_BASE, "/customer/support-automation", { method: "GET" }),
      customerApi<{ events: SupportEvent[] }>(API_BASE, "/customer/support-automation/history?limit=20", { method: "GET" }),
    ]);
    setStatus(nextStatus);
    setEvents(history.events);
    if (nextStatus.provider === "imap_smtp") {
      setForm((current) => ({
        ...current,
        inboxEmail: nextStatus.inboxEmail ?? current.inboxEmail,
        mailHost: nextStatus.mailHost ?? current.mailHost,
        mailFolder: nextStatus.mailFolder ?? current.mailFolder,
        linearTeamId: nextStatus.linearTeamId ?? current.linearTeamId,
        allowReply: nextStatus.allowedActions?.includes("send_reply") ?? current.allowReply,
      }));
    }
    return account;
  }, []);

  useEffect(() => {
    if (!SUPPORT_AUTOMATION_RELEASED) return;
    let active = true;
    customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" })
      .then(async (account) => {
        if (!active) return;
        setDashboard(account);
        await refresh(account);
      })
      .catch((caught) => { if (active) setError(errorMessage(caught)); });
    return () => { active = false; };
  }, [refresh]);

  if (!SUPPORT_AUTOMATION_RELEASED) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
        <section className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Support automation</p>
          <h1 className="mt-3 text-4xl font-bold">Connected support automation is not activated.</h1>
          <p className="mt-5 text-slate-300">The repository path can be qualified while inbox reads, provider actions, and email sending remain separately disabled.</p>
          <Link className="mt-8 inline-block font-semibold text-cyan-300 underline" href="/account/api-keys/">Return to API account</Link>
        </section>
      </main>
    );
  }

  async function runControl(path: "pause" | "resume" | "revoke") {
    if (!dashboard) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await customerApi(API_BASE, `/customer/support-automation/${path}`, { method: "POST", csrfToken: dashboard.csrfToken, body: "{}" });
      await refresh(dashboard);
      setNotice(path === "pause" ? "Processing paused." : path === "resume" ? "Resume requested. Activation still depends on the protected environment gate." : "Connection revoked and credential references removed from the configuration.");
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const allowedActions = form.allowReply ? ["create_linear_issue", "send_reply"] : ["create_linear_issue"];
      await customerApi(API_BASE, "/customer/support-automation/config", {
        method: "POST",
        csrfToken: dashboard.csrfToken,
        body: JSON.stringify({
          provider: "imap_smtp",
          inboxEmail: form.inboxEmail,
          mailHost: form.mailHost,
          mailFolder: form.mailFolder,
          mailCredentialSecretArn: form.mailCredentialSecretArn,
          taskProvider: "linear",
          linearCredentialSecretArn: form.linearCredentialSecretArn,
          linearTeamId: form.linearTeamId,
          policyVersion: "support-v1",
          allowedActions,
        }),
      });
      setForm((current) => ({ ...current, mailCredentialSecretArn: "", linearCredentialSecretArn: "" }));
      await refresh(dashboard);
      setNotice("Configuration saved paused. Secret values were not entered here; only pre-provisioned secret references are accepted.");
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  const state = status?.automationState ?? "NOT_CONFIGURED";
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-16 text-white sm:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Support automation</p>
          <h1 className="mt-3 text-4xl font-bold">Inbox connection and controls</h1>
          <p className="mt-4 max-w-3xl text-slate-300">Connect the existing SolveLang mailbox through a tenant-scoped secret reference. Saving never activates processing; activation and email sending remain independent protected gates.</p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-white/10 px-4 py-2">State: <strong>{state}</strong></span>
            <span className="rounded-full bg-white/10 px-4 py-2">Activation gate: <strong>{status?.activationEnabled ? "enabled" : "off"}</strong></span>
            {status?.provider === "imap_smtp" && <span className="rounded-full bg-white/10 px-4 py-2">Cutover: <strong>{status.sourceInitialized ? "captured" : "not captured"}</strong></span>}
          </div>
          {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">{error}</p>}
          {notice && <p className="mt-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-100">{notice}</p>}
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <form onSubmit={configure} className="rounded-3xl border border-white/10 bg-white/5 p-7">
            <h2 className="text-2xl font-bold">Mailcow / IMAP setup</h2>
            <p className="mt-2 text-sm text-slate-400">Enter references to credentials already stored in the approved secret namespace. Never paste mailbox passwords or provider keys into this form.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {([
                ["Inbox", "inboxEmail", form.inboxEmail],
                ["Approved mail host", "mailHost", form.mailHost],
                ["Folder", "mailFolder", form.mailFolder],
                ["Linear team ID", "linearTeamId", form.linearTeamId],
              ] as const).map(([label, key, value]) => (
                <label key={key} className="text-sm font-medium text-slate-200">{label}
                  <input required value={value} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-white outline-none focus:border-cyan-400" />
                </label>
              ))}
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-200">Mailbox credential secret ARN
              <input required value={form.mailCredentialSecretArn} autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, mailCredentialSecretArn: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cyan-400" />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-200">Linear credential secret ARN
              <input required value={form.linearCredentialSecretArn} autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, linearCredentialSecretArn: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cyan-400" />
            </label>
            <label className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm text-slate-300">
              <input type="checkbox" checked={form.allowReply} onChange={(event) => setForm((current) => ({ ...current, allowReply: event.target.checked }))} className="mt-1" />
              <span><strong className="text-white">Permit reply action in policy.</strong><br />This does not turn sending on; the environment send gate must also be separately authorized and enabled.</span>
            </label>
            <button disabled={busy || !dashboard} className="mt-6 rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">Save paused configuration</button>
          </form>

          <aside className="rounded-3xl border border-white/10 bg-white/5 p-7">
            <h2 className="text-2xl font-bold">Current connection</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div><dt className="text-slate-400">Provider</dt><dd>{status?.provider ?? "Not configured"}</dd></div>
              <div><dt className="text-slate-400">Inbox</dt><dd>{status?.inboxEmail ?? "—"}</dd></div>
              <div><dt className="text-slate-400">Host / folder</dt><dd>{status?.mailHost ? `${status.mailHost} / ${status.mailFolder}` : "—"}</dd></div>
              <div><dt className="text-slate-400">Actions</dt><dd>{status?.allowedActions?.join(", ") ?? "—"}</dd></div>
              <div><dt className="text-slate-400">Policy</dt><dd>{status?.policyVersion ?? "—"}</dd></div>
            </dl>
            <div className="mt-7 grid gap-3">
              <button disabled={busy || !status?.configured || state === "PAUSED"} onClick={() => runControl("pause")} className="rounded-xl border border-white/15 px-4 py-3 font-semibold disabled:opacity-40">Pause</button>
              <button disabled={busy || !status?.configured || state === "ACTIVE"} onClick={() => runControl("resume")} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-3 font-semibold text-cyan-200 disabled:opacity-40">Resume / initialize cutover</button>
              <button disabled={busy || !status?.configured || state === "REVOKED"} onClick={() => runControl("revoke")} className="rounded-xl border border-red-300/30 bg-red-300/5 px-4 py-3 font-semibold text-red-200 disabled:opacity-40">Revoke connection</button>
            </div>
          </aside>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-7">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-2xl font-bold">Processing history</h2><p className="mt-1 text-sm text-slate-400">Redacted event outcomes only; raw support message bodies are not shown here.</p></div>
            <button disabled={busy || !dashboard} onClick={() => dashboard && refresh(dashboard).catch((caught) => setError(errorMessage(caught)))} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold disabled:opacity-40">Refresh</button>
          </div>
          <div className="mt-5 space-y-3">
            {events.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-5 text-slate-400">No retained processing events.</p>}
            {events.map((item) => (
              <article key={item.eventId} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2"><strong>{item.state}</strong><span className="text-slate-400">{item.category ?? "unclassified"}</span>{item.requiresReview && <span className="rounded-full bg-amber-300/15 px-2 py-1 text-xs text-amber-200">review required</span>}</div>
                <p className="mt-2 break-all font-mono text-xs text-slate-500">{item.eventId}</p>
                {item.sensitiveReasons.length > 0 && <p className="mt-2 text-sm text-amber-200">Reasons: {item.sensitiveReasons.join(", ")}</p>}
                {item.actions.length > 0 && <p className="mt-2 text-sm text-slate-300">Actions: {item.actions.map((action) => `${action.action}:${action.status}`).join(" · ")}</p>}
              </article>
            ))}
          </div>
        </section>

        <Link className="inline-block font-semibold text-cyan-300 underline" href="/account/api-keys/">Return to API account</Link>
      </div>
    </main>
  );
}
