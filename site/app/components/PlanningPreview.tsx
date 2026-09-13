"use client";

import { useMemo, useState } from "react";
import { analyzePreview, MAX_PREVIEW_INPUT, type PreviewMode } from "./workflow-preview";

const examples = {
  workflow: [
    { label: "Support routing", text: "When a customer emails support, classify the request, create a task in Linear, assign the owner, draft a reply, and notify the Slack channel for urgent cases." },
    { label: "Form intake", text: "When a form submission arrives, create a task in Jira and draft an email reply using Outlook." },
    { label: "Review boundary", text: "When a billing email arrives, review the invoice and requested refund. Hold financial changes for human approval." },
  ],
  support: [
    { label: "Billing question", text: "We were charged twice and need this fixed before renewal. Can your team review the billing issue?" },
    { label: "Getting started", text: "How do I download the installation guide and get started?" },
    { label: "Account issue", text: "I forgot my password and get an error signing in. What is the approved recovery process?" },
  ],
} as const;

export function PlanningPreview({ mode }: { mode: PreviewMode }) {
  const [value, setValue] = useState<string>(examples[mode][0].text);
  const [notice, setNotice] = useState("");
  const result = useMemo(() => analyzePreview(value, mode), [value, mode]);
  const ready = result.status === "preview-ready";
  const inputId = `${mode}-description`;
  function updateValue(text: string) { setValue(text); setNotice(""); }
  async function copyScript() {
    try { await navigator.clipboard.writeText(result.draft); setNotice("Planning script copied. It prints a proposed map; it does not execute the proposed actions."); }
    catch { setNotice("Clipboard is unavailable. Select and copy the script below."); }
  }
  function downloadPlan() {
    const contents = JSON.stringify({ schemaVersion: 1, mode, ...result }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "solvelang-planning-preview.json"; anchor.click();
    // The browser consumes the object URL after the click task, not synchronously in every engine.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Plan exported locally. No connection or external action was authorized.");
  }
  return (
    <div id={mode === "workflow" ? "audit-agent" : "support-preview"} className="grid scroll-mt-24 gap-6 lg:grid-cols-2" data-planning-preview={mode}>
      <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby={`${inputId}-heading`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Local planning preview</p>
        <h2 id={`${inputId}-heading`} className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{mode === "workflow" ? "Describe the workflow." : "Try a support message."}</h2>
        <p id={`${inputId}-help`} className="mt-4 text-sm leading-7 text-slate-600">The example updates automatically using simple English-language rules. No inbox is connected, no AI model is called, and no task or message is sent. Do not paste secrets or private customer records.</p>
        <label htmlFor={inputId} className="mt-6 block text-sm font-semibold text-slate-900">{mode === "workflow" ? "Workflow description" : "Support message"}</label>
        <textarea id={inputId} value={value} onChange={event => updateValue(event.target.value)} maxLength={MAX_PREVIEW_INPUT} rows={9} aria-describedby={`${inputId}-help ${inputId}-count`} placeholder={mode === "workflow" ? "When [event happens], we [decide], then [take action] using [tools]…" : "Describe the request without passwords, codes or account secrets…"} className="mt-3 min-h-56 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 text-base leading-7 text-slate-950 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-600"><p id={`${inputId}-count`}>{value.length} / {MAX_PREVIEW_INPUT} characters</p><button type="button" onClick={() => updateValue("")} className="rounded-lg px-3 py-2 font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Clear</button></div>
        <p className="mt-5 text-sm font-semibold text-slate-800">Try an example</p>
        <div className="mt-3 flex flex-wrap gap-2">{examples[mode].map(example => <button key={example.label} type="button" onClick={() => updateValue(example.text)} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{example.label}</button>)}</div>
        <p className="mt-6 text-xs leading-6 text-slate-500">Text stays in this page&apos;s memory. Copying or exporting saves only the proposed planning result to your device. Refreshing the page restores the example.</p>
      </section>
      <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-950 p-6 text-white shadow-sm sm:p-8" aria-labelledby={`${mode}-result-heading`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Proposed result · nothing executed</p>
        <h2 id={`${mode}-result-heading`} className="mt-3 text-2xl font-semibold tracking-tight">{ready ? "Review the proposed map." : "More detail is needed."}</h2>
        <p role="status" aria-live="polite" aria-atomic="true" data-preview-status={result.status} className="mt-3 text-sm leading-7 text-slate-300">{result.status === "too-long" ? "The description is too long to analyze. Shorten it; no partial result is treated as complete." : ready ? `Local preview: ${result.category}. No external action has run.` : "Add at least a short sentence describing the trigger or the request. No workflow is marked safe or queued."}</p>
        {ready ? <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">{[["Trigger", result.trigger], ["Suggested category", result.category], ["Urgency signal", result.urgency === "not-determined" ? "Not determined" : result.urgency], ["Suggested owner", result.suggestedOwner]].map(([label, text]) => <div key={label} data-preview-field={label} className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-2 break-words text-sm font-medium text-white">{text}</dd></div>)}</dl>
          <div className="mt-6"><h3 className="text-sm font-semibold text-slate-100">Tools mentioned — not connected</h3><p className="mt-2 text-sm leading-7 text-slate-300">{result.tools.join(" · ") || "No provider specified. Nothing is inferred as connected."}</p></div>
          <div className="mt-6"><h3 className="text-sm font-semibold text-slate-100">Proposed next actions</h3>{result.actions.length ? <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{result.actions.map(action => <li key={action.id}>{action.label} <span className="text-slate-400">(not executed)</span></li>)}</ul> : <p className="mt-2 text-sm leading-7 text-slate-300">Specify the desired next action instead of assuming one.</p>}</div>
          {result.decisions.length ? <div className="mt-6"><h3 className="text-sm font-semibold text-slate-100">Rules to clarify</h3><p className="mt-2 text-sm leading-7 text-slate-300">{result.decisions.join(" · ")}</p></div> : null}
          {result.reply ? <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4"><h3 className="text-sm font-semibold">Suggested reply — not sent</h3><p className="mt-3 text-sm leading-7 text-slate-300">{result.reply}</p></div> : null}
        </> : null}
        {result.reviewReasons.length ? <div className="mt-6 rounded-2xl border border-amber-200/20 bg-amber-200/5 p-4"><h3 className="text-sm font-semibold text-amber-100">Review boundary</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-100/90">{result.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : null}
        {ready ? <details className="mt-6 rounded-2xl border border-white/15 p-4"><summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">Printable SolveLang planning script</summary><p className="mt-3 text-xs leading-6 text-slate-400">This script prints the proposed map in the Browser Preview. It is not an implementation of the external actions.</p><pre data-generated-script="true" className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-4 font-mono text-xs leading-6 text-slate-200">{result.draft}</pre></details> : null}
        <div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={!ready} onClick={copyScript} className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Copy planning script</button><button type="button" disabled={!ready} onClick={downloadPlan} className="rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Export plan JSON</button></div>
        <p role="status" aria-live="polite" className="mt-3 text-xs leading-6 text-slate-300">{notice}</p>
      </section>
    </div>
  );
}
