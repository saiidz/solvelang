"use client";

import { useState } from "react";
import { createCanonicalPreviewSession } from "../../run/canonicalRunner";
import wasmPin from "../../run/wasmPreviewPin.json";
const starterCode = `let ticket_type = "billing"
let priority = "urgent"
let lead_intent = "demo"

print("Review incoming workflow")
print(ticket_type)

if priority == "urgent" {
  print("Escalate support ticket")
}

if lead_intent == "demo" {
  print("Create founder follow-up task")
}`;
type RunStatus = "idle" | "loading" | "running" | "success" | "error";
export default function RunPage() {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [session] = useState(() => createCanonicalPreviewSession(async () => {
    const { loadAuditedWasm } = await import("../../../../solvec-wasm/browser/loader.mjs");
    return loadAuditedWasm(wasmPin);
  }));
  const busy = status === "loading" || status === "running";
  async function runCode() {
    if (busy) return;
    setOutput(""); setError("");
    const result = await session.run(code, setStatus);
    if (result.kind === "busy") return;
    if (result.ok) { setOutput(result.output); setStatus("success"); return; }
    setOutput(result.output); setError(result.error || "The local runtime could not complete this script."); setStatus("error");
  }
  function resetCode() { setCode(starterCode); setOutput(""); setError(""); setStatus("idle"); }
  const statusLabel = { idle: "Ready", loading: "Loading audited runtime", running: "Running locally", success: "Completed", error: "Needs review" }[status];
  return (
    <main className="min-h-screen bg-canvas px-5 py-8 text-ink sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10"><div className="flex flex-wrap items-center gap-3"><span className="rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-accent">Preview</span><span className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-body">Browser-only · no server execution</span></div><h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">Preview SolveLang with the canonical safe core.</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-body">This preview uses a pinned, audited WebAssembly build of the Rust core. Scripts run locally with a deny-all host policy. It is not the hosted full runtime and does not execute integrations, agents, or file/network side effects.</p></header>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3"><div className="flex items-center gap-3"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${status === "error" ? "bg-warning" : status === "success" ? "bg-success" : "bg-accent-solid"}`} /><span className="text-sm font-semibold">{statusLabel}</span></div><p className="text-sm text-muted">For full language behavior, use <code className="text-body">solvec</code>.</p></div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="script-heading" className="rounded-3xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 id="script-heading" className="text-xl font-semibold">Script</h2><p className="mt-1 text-sm text-muted">Edit the supported subset, then run it locally in this browser.</p></div><div className="flex gap-2"><button type="button" onClick={resetCode} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Reset</button><button type="button" onClick={runCode} disabled={busy} className="rounded-xl bg-accent-solid px-5 py-2 text-sm font-semibold text-ink transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-60">{status === "loading" ? "Loading…" : status === "running" ? "Running…" : "Run preview"}</button></div></div>
            <label htmlFor="solve-preview-source" className="sr-only">SolveLang preview source</label><textarea id="solve-preview-source" value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} className="h-[420px] w-full resize-y rounded-2xl border border-line bg-panel p-4 font-mono text-sm leading-6 text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent" spellCheck={false} aria-describedby="preview-syntax-note" />
          </section>
          <section aria-labelledby="output-heading" className="rounded-3xl border border-line bg-panel p-5 shadow-2xl"><div className="mb-4"><h2 id="output-heading" className="text-xl font-semibold">Output</h2><p className="mt-1 text-sm text-muted">Deterministic output for the supported browser subset.</p></div><div aria-live="polite" aria-atomic="true" role={error ? "alert" : "status"}><pre className={`min-h-[420px] whitespace-pre-wrap rounded-2xl border p-4 font-mono text-sm leading-6 ${error ? "border-warning bg-warning-soft text-warning" : "border-line bg-black text-cyan-100"}`}>{error ? `Error: ${error}` : output || "Run the preview to see output here."}</pre></div></section>
        </div>
        <section id="preview-syntax-note" className="mt-8 rounded-2xl border border-accent bg-accent-soft p-5 text-sm leading-6 text-accent"><h2 className="font-semibold text-ink">Supported in this preview</h2><p className="mt-2">Variables, text, numbers, booleans, arrays, objects, functions, bounded loops, comparisons and <code>print</code> use the canonical pure runtime. Imports, HTTP, files, environment variables and AI calls are denied, including unreachable calls.</p></section>
        <section className="mt-5 rounded-2xl border border-warning bg-warning-soft p-5 text-sm leading-6 text-warning"><h2 className="font-semibold text-ink">Capability boundary</h2><p className="mt-2">This browser preview uses a pinned safe-core build. Native <code>solvec</code> remains canonical for the full language and host capabilities. General managed production workflow execution is not live.</p></section>
      </div>
    </main>
  );
}
