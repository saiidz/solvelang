"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { analyzeN8nWorkflow, createHtmlReport, parseN8nWorkflow, type PreflightReport } from "./core/n8nPreflight";
import { recoverPaidScan } from "./core/paidRecovery";
import { PENDING_PAID_SCAN_STORAGE_KEY, type PendingPaidScan } from "./core/pendingPaidScan";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const apiBase = process.env.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "") ?? "";

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
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "workflow";
}

function recordEvent(name: string) {
  window.dispatchEvent(new CustomEvent("solvelang:analytics", { detail: { name } }));
  if (apiBase) void fetch(`${apiBase}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }), keepalive: true }).catch(() => undefined);
}

export function WorkflowPreflight() {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [scanId, setScanId] = useState("");
  const [entitlement, setEntitlement] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [recoveryState, setRecoveryState] = useState<"idle" | "verifying" | "waiting" | "retry" | "refunded" | "failed">("idle");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  const paidMode = Boolean(apiBase);
  const unlocked = !paidMode || Boolean(entitlement);
  const previewFindings = useMemo(() => report?.findings.slice(0, 3) ?? [], [report]);

  useEffect(() => {
    recordEvent("check_page_view");
    let cancelled = false;

    async function restorePaidScan() {
      const stored = sessionStorage.getItem(PENDING_PAID_SCAN_STORAGE_KEY);
      const hasPaymentReturn = new URLSearchParams(window.location.search).has("payment_intent");
      if (hasPaymentReturn) {
        setRecoveryState("verifying");
        setError("");
      }

      try {
        const recovery = await recoverPaidScan({
          apiBase,
          search: window.location.search,
          stored,
          verify: (url, init) => window.fetch(url, init),
          clearPending: () => sessionStorage.removeItem(PENDING_PAID_SCAN_STORAGE_KEY),
          replaceUrl: (url) => window.history.replaceState({}, "", url),
          onRetry: (attempt) => {
            if (!cancelled) {
              setRecoveryAttempt(attempt);
              setRecoveryState("waiting");
            }
          },
        });
        if (!recovery || cancelled) return;

        setReport(recovery.pending.report);
        setScanId(recovery.pending.scanId);
        setFileName(recovery.pending.fileName);
        setEntitlement(recovery.token);
        setRecoveryState("idle");
        recordEvent("payment_completed");
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : "Payment verification failed.";
          setError(message);
          setRecoveryState(message.includes("fully refunded") ? "refunded" : message.includes("still pending") ? "retry" : "failed");
        }
      }
    }

    void restorePaidScan();
    return () => {
      cancelled = true;
    };
  }, [recoveryNonce]);

  async function scanFile(file: File) {
    setBusy(true);
    setError("");
    setReport(null);
    setEntitlement("");
    setFileName(file.name);
    recordEvent("workflow_selected");
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Upload an exported n8n JSON workflow.");
      if (file.size === 0) throw new Error("The selected file is empty.");
      if (file.size > MAX_FILE_BYTES) throw new Error("The file exceeds the 2 MB browser-scan limit.");
      const workflow = parseN8nWorkflow(JSON.parse(await file.text()) as unknown);
      const nextReport = analyzeN8nWorkflow(workflow);
      const nextScanId = crypto.randomUUID();
      setReport(nextReport);
      setScanId(nextScanId);
      recordEvent("scan_completed");
    } catch (caught) {
      recordEvent("scan_failed");
      setError(caught instanceof Error ? caught.message : "The workflow could not be scanned.");
    } finally {
      setBusy(false);
    }
  }

  function startCheckout() {
    if (!report || !scanId || !apiBase) return;
    setBusy(true);
    setError("");
    sessionStorage.setItem(PENDING_PAID_SCAN_STORAGE_KEY, JSON.stringify({ scanId, report, fileName } satisfies PendingPaidScan));
    recordEvent("checkout_started");
    window.location.assign(`/checkout/?scan_id=${encodeURIComponent(scanId)}`);
  }

  function exportReport(format: "html" | "json") {
    if (!report || !unlocked) return;
    const base = `${safeFilename(report.workflowName)}-solvelang-preflight`;
    if (format === "html") download(`${base}.html`, createHtmlReport(report), "text/html;charset=utf-8");
    else download(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "application/json;charset=utf-8");
    recordEvent("report_downloaded");
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 lg:px-8">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
        <div className="rounded-[2rem] border border-line bg-panel p-6 shadow-xl shadow-slate-200/40 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Automated scan</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Upload an n8n workflow</h2>
          <label onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void scanFile(file); }} className={`mt-8 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 text-center transition ${dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-canvas hover:border-line-strong"}`}>
            <span className="text-4xl" aria-hidden="true">⇧</span>
            <span className="mt-4 text-lg font-semibold">Drop exported workflow JSON here</span>
            <span className="mt-2 max-w-md text-sm leading-6 text-muted">Maximum 2 MB and 5,000 nodes. Initial analysis stays in this browser.</span>
            <input className="sr-only" type="file" accept="application/json,.json" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void scanFile(file); event.target.value = ""; }} disabled={busy} />
            <span className="mt-5 rounded-xl bg-canvas px-5 py-3 text-sm font-semibold text-ink">{busy ? "Working…" : "Choose n8n JSON"}</span>
          </label>
          {fileName ? <p className="mt-4 break-all text-sm text-muted">Selected: {fileName}</p> : null}
          {recoveryState === "verifying" || recoveryState === "waiting" ? <div role="status" className="mt-5 rounded-2xl border border-accent bg-accent-soft p-4 text-sm font-medium text-accent">{recoveryState === "waiting" ? `Payment succeeded. Waiting for secure webhook verification (retry ${recoveryAttempt} of 3)…` : "Payment succeeded. Verifying your access…"}</div> : null}
          {error ? <div role="alert" className="mt-5 rounded-2xl border border-danger bg-danger-soft p-4 text-sm font-medium text-danger"><p>{error}</p>{recoveryState === "retry" ? <button type="button" onClick={() => setRecoveryNonce((value) => value + 1)} className="mt-3 rounded-lg bg-danger px-4 py-2 text-ink">Retry verification</button> : null}</div> : null}
        </div>
        <aside className="rounded-[2rem] border border-line bg-canvas p-6 text-ink shadow-2xl sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">What it checks</p>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-body"><li>✓ Missing triggers and disconnected nodes</li><li>✓ Missing error and terminal paths</li><li>✓ Code, command, HTTP, and AI risk signals</li><li>✓ Human-review and credential warnings</li><li>✓ Deterministic evidence report</li></ul>
          <p className="mt-8 rounded-2xl border border-line bg-panel p-5 text-sm leading-6 text-body">SolveLang does not execute uploaded workflows or inspect credential values.</p>
        </aside>
      </section>

      {report ? <section className="mt-10" aria-live="polite">
        <div className="grid gap-5 md:grid-cols-4"><div className="rounded-3xl border border-line bg-panel p-6 shadow-sm md:col-span-2"><p className="text-sm text-muted">Preflight score</p><div className="mt-2 text-6xl font-semibold">{report.score}<span className="text-2xl text-muted">/100</span></div><p className="mt-4 text-muted">{report.summary}</p></div><div className="rounded-3xl border border-line bg-panel p-6 shadow-sm"><p className="text-sm text-muted">Workflow</p><p className="mt-2 text-xl font-semibold">{report.workflowName}</p><p className="mt-3 text-sm text-muted">{report.nodeCount} nodes · {report.connectionCount} connections</p></div><div className="rounded-3xl border border-line bg-panel p-6 shadow-sm"><p className="text-sm text-muted">Severity</p><p className="mt-2 text-sm">{report.severityCounts.critical} critical · {report.severityCounts.high} high</p><p className="mt-2 text-sm">{report.severityCounts.medium} medium · {report.severityCounts.low} low</p></div></div>
        <div className="mt-8 rounded-[2rem] border border-line bg-panel p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">Free preview</p><h2 className="mt-2 text-2xl font-semibold">First three findings</h2><div className="mt-6 grid gap-4">{previewFindings.map((finding) => <article key={finding.id} className="rounded-2xl border border-line bg-canvas p-5"><span className="rounded-full bg-panel px-3 py-1 text-xs font-semibold uppercase text-ink">{finding.severity}</span><h3 className="mt-3 text-lg font-semibold">{finding.title}</h3><p className="mt-2 leading-7 text-muted">{finding.detail}</p></article>)}</div></div>
        <div className="mt-8 rounded-[2rem] border border-accent bg-accent-soft p-6 sm:p-8"><div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Complete evidence</p><h2 className="mt-2 text-2xl font-semibold">{paidMode ? (unlocked ? "Payment verified" : "Unlock the complete report for $49") : "Free complete report"}</h2><p className="mt-3 max-w-3xl leading-7 text-body">{paidMode ? (unlocked ? "Your signed entitlement is active for this scan." : "Pay securely without leaving SolveLang. Access is enabled only after server-side verification.") : "Checkout is disabled until the production entitlement API is configured."}</p></div><div className="flex flex-col gap-3">{paidMode && !unlocked ? <button type="button" onClick={startCheckout} disabled={busy} className="rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60">Pay securely on SolveLang</button> : <><button type="button" onClick={() => exportReport("html")} className="rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-ink">Download HTML report</button><button type="button" onClick={() => exportReport("json")} className="rounded-xl border border-line-strong bg-panel px-5 py-3 text-sm font-semibold text-ink">Download JSON evidence</button></>}</div></div></div>
      </section> : null}
    </div>
  );
}
