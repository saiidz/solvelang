"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { analyzeN8nWorkflow, createHtmlReport, parseN8nWorkflow, type PreflightReport } from "./core/n8nPreflight";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const paymentLink = process.env.NEXT_PUBLIC_STRIPE_PREFLIGHT_PAYMENT_LINK?.trim() ?? "";

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workflow";
}

export function WorkflowPreflight() {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const previewFindings = useMemo(() => report?.findings.slice(0, 3) ?? [], [report]);

  async function scanFile(file: File) {
    setBusy(true);
    setError("");
    setReport(null);
    setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Upload an exported n8n JSON workflow.");
      if (file.size === 0) throw new Error("The selected file is empty.");
      if (file.size > MAX_FILE_BYTES) throw new Error("The file exceeds the 2 MB browser-scan limit.");
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const workflow = parseN8nWorkflow(parsed);
      setReport(analyzeN8nWorkflow(workflow));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The workflow could not be scanned.");
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void scanFile(file);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void scanFile(file);
  }

  function exportReport(format: "html" | "json") {
    if (!report) return;
    const base = `${safeFilename(report.workflowName)}-solvelang-preflight`;
    if (format === "html") download(`${base}.html`, createHtmlReport(report), "text/html;charset=utf-8");
    else download(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "application/json;charset=utf-8");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 lg:px-8">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Automated scan</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Upload an n8n workflow</h2>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Runs in your browser</span>
          </div>

          <label
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className={`mt-8 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 text-center transition ${dragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-slate-500"}`}
          >
            <span className="text-4xl" aria-hidden="true">⇧</span>
            <span className="mt-4 text-lg font-semibold">Drop exported workflow JSON here</span>
            <span className="mt-2 max-w-md text-sm leading-6 text-slate-600">Or choose a file. Maximum 2 MB and 5,000 nodes. The file is analyzed locally and is not uploaded.</span>
            <input className="sr-only" type="file" accept="application/json,.json" onChange={onFileChange} disabled={busy} />
            <span className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">{busy ? "Scanning…" : "Choose n8n JSON"}</span>
          </label>

          {fileName ? <p className="mt-4 break-all text-sm text-slate-500">Selected: {fileName}</p> : null}
          {error ? <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div> : null}
        </div>

        <aside className="rounded-[2rem] border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">What the scanner checks</p>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-200">
            <li>✓ Missing triggers and disconnected nodes</li>
            <li>✓ Missing error and terminal paths</li>
            <li>✓ Code, command, HTTP, and AI risk signals</li>
            <li>✓ Human-review and credential-reference warnings</li>
            <li>✓ Deterministic score and downloadable evidence</li>
          </ul>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-slate-300">
            SolveLang does not execute the workflow, call external APIs, or inspect credential values. Production behavior still requires environment-specific testing.
          </div>
        </aside>
      </section>

      {report ? (
        <section className="mt-10" aria-live="polite">
          <div className="grid gap-5 md:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
              <p className="text-sm font-medium text-slate-500">Preflight score</p>
              <div className="mt-2 text-6xl font-semibold tracking-tight">{report.score}<span className="text-2xl text-slate-400">/100</span></div>
              <p className="mt-4 text-slate-600">{report.summary}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Workflow</p>
              <p className="mt-2 text-xl font-semibold">{report.workflowName}</p>
              <p className="mt-3 text-sm text-slate-600">{report.nodeCount} nodes · {report.connectionCount} connections</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Severity</p>
              <p className="mt-2 text-sm text-slate-700">{report.severityCounts.critical} critical · {report.severityCounts.high} high</p>
              <p className="mt-2 text-sm text-slate-700">{report.severityCounts.medium} medium · {report.severityCounts.low} low</p>
            </div>
          </div>

          <div className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Free preview</p>
                <h2 className="mt-2 text-2xl font-semibold">First three findings</h2>
              </div>
              <p className="text-sm text-slate-500">{report.findings.length} total finding{report.findings.length === 1 ? "" : "s"}</p>
            </div>
            <div className="mt-6 grid gap-4">
              {previewFindings.map((finding) => (
                <article key={finding.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">{finding.severity}</span>
                    <span className="text-xs font-medium text-slate-500">{finding.id}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold">{finding.title}</h3>
                  <p className="mt-2 leading-7 text-slate-600">{finding.detail}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-700"><strong>Recommended:</strong> {finding.recommendation}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-[2rem] border border-blue-200 bg-blue-50 p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Full evidence</p>
                <h2 className="mt-2 text-2xl font-semibold">Download the complete automated report</h2>
                <p className="mt-3 max-w-3xl leading-7 text-slate-700">This beta currently generates the complete deterministic report in-browser. Stripe checkout can be activated by setting <code>NEXT_PUBLIC_STRIPE_PREFLIGHT_PAYMENT_LINK</code> to the live $49 Payment Link.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                {paymentLink ? (
                  <a href={paymentLink} className="rounded-xl bg-blue-700 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-blue-800">Unlock for $49</a>
                ) : (
                  <span className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-center text-sm font-semibold text-amber-900">Checkout configuration required</span>
                )}
                <button type="button" onClick={() => exportReport("html")} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900">Download HTML beta report</button>
                <button type="button" onClick={() => exportReport("json")} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900">Download JSON evidence</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
