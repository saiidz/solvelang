"use client";

import { useState } from "react";
import { createCanonicalPreviewSession, type WorkspaceFile } from "../../run/canonicalRunner";
import wasmPin from "../../run/wasmPreviewPin.json";
const ENTRY_NAME = "main.solve";
const starterFiles: WorkspaceFile[] = [
  {
    name: ENTRY_NAME,
    source: `import { escalate } from "triage.solve"

let ticket_type = "billing"
let priority = "urgent"
let lead_intent = "demo"

print("Review incoming workflow")
print(ticket_type)

if escalate(priority) {
  print("Escalate support ticket")
}

if lead_intent == "demo" {
  print("Create founder follow-up task")
}`,
  },
  {
    name: "triage.solve",
    source: `export fn escalate(priority) {
  return priority == "urgent"
}`,
  },
];
type RunStatus = "idle" | "loading" | "running" | "success" | "error";
export default function RunPage() {
  const [files, setFiles] = useState<WorkspaceFile[]>(starterFiles);
  const [active, setActive] = useState(ENTRY_NAME);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [session] = useState(() => createCanonicalPreviewSession(async () => {
    const { loadAuditedWasm } = await import("../../../../solvec-wasm/browser/loader.mjs");
    return loadAuditedWasm(wasmPin);
  }));
  const busy = status === "loading" || status === "running";
  const activeFile = files.find((file) => file.name === active) ?? files[0];
  async function runCode() {
    if (busy) return;
    setOutput(""); setError("");
    const result = await session.runWorkspace(files, ENTRY_NAME, setStatus);
    if (result.kind === "busy") return;
    if (result.ok) { setOutput(result.output); setStatus("success"); return; }
    setOutput(result.output); setError(result.error || "The local runtime could not complete this script."); setStatus("error");
  }
  function resetCode() { setFiles(starterFiles); setActive(ENTRY_NAME); setNewName(""); setNameError(""); setOutput(""); setError(""); setStatus("idle"); }
  function updateSource(source: string) {
    setFiles((current) => current.map((file) => file.name === activeFile.name ? { ...file, source } : file));
  }
  function addFile() {
    const name = newName.trim();
    if (!name.endsWith(".solve") || name.startsWith("/") || name.includes("..") || name.includes("\\") || name.includes("\0")) {
      setNameError("Use a relative module path ending in .solve, without parent traversal.");
      return;
    }
    if (files.some((file) => file.name === name)) {
      setNameError("A file with that name already exists in this workspace.");
      return;
    }
    setFiles((current) => [...current, { name, source: "" }]);
    setActive(name);
    setNewName("");
    setNameError("");
  }
  function removeFile(name: string) {
    if (name === ENTRY_NAME) return;
    setFiles((current) => current.filter((file) => file.name !== name));
    if (active === name) setActive(ENTRY_NAME);
  }
  const statusLabel = { idle: "Ready", loading: "Loading audited runtime", running: "Running locally", success: "Completed", error: "Needs review" }[status];
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10"><div className="flex flex-wrap items-center gap-3"><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Run</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">Browser-only · no server execution</span></div><h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">Run SolveLang in your browser.</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">The full SolveLang language — including multi-file modules — runs locally in your browser from a pinned, audited WebAssembly build of the Rust runtime. Nothing is sent to a server.</p></header>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div className="flex items-center gap-3"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${status === "error" ? "bg-amber-300" : status === "success" ? "bg-emerald-300" : "bg-cyan-300"}`} /><span className="text-sm font-semibold">{statusLabel}</span></div><p className="text-sm text-slate-400">Pinned audited build <code className="text-slate-200">{wasmPin.sourceCommit.slice(0, 7)}</code></p></div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="script-heading" className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 id="script-heading" className="text-xl font-semibold">Workspace</h2><p className="mt-1 text-sm text-slate-400">Edit any file, then run the workspace locally. Imports resolve between the files listed here.</p></div><div className="flex gap-2"><button type="button" onClick={resetCode} disabled={busy} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Reset</button><button type="button" onClick={runCode} disabled={busy} className="rounded-xl bg-cyan-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60">{status === "loading" ? "Loading…" : status === "running" ? "Running…" : "Run"}</button></div></div>
            <div role="tablist" aria-label="Workspace files" className="mb-3 flex flex-wrap gap-2">
              {files.map((file) => (
                <span key={file.name} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${file.name === activeFile.name ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
                  <button type="button" role="tab" aria-selected={file.name === activeFile.name} onClick={() => setActive(file.name)} disabled={busy} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{file.name}</button>
                  {file.name === ENTRY_NAME ? <span className="text-[10px] uppercase tracking-wider text-cyan-300">entry</span> : <button type="button" onClick={() => removeFile(file.name)} disabled={busy} aria-label={`Remove ${file.name}`} className="text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">×</button>}
                </span>
              ))}
            </div>
            <label htmlFor="solve-preview-source" className="sr-only">SolveLang source for {activeFile.name}</label><textarea id="solve-preview-source" value={activeFile.source} disabled={busy} onChange={(event) => updateSource(event.target.value)} className="h-[420px] w-full resize-y rounded-2xl border border-white/10 bg-slate-900 p-4 font-mono text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" spellCheck={false} aria-describedby="preview-syntax-note" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="new-module-name" className="sr-only">New module file name</label>
              <input id="new-module-name" value={newName} disabled={busy} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addFile(); } }} placeholder="lib/helpers.solve" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20" spellCheck={false} />
              <button type="button" onClick={addFile} disabled={busy} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Add file</button>
            </div>
            {nameError ? <p role="alert" className="mt-2 text-sm text-amber-200">{nameError}</p> : null}
          </section>
          <section aria-labelledby="output-heading" className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl"><div className="mb-4"><h2 id="output-heading" className="text-xl font-semibold">Output</h2><p className="mt-1 text-sm text-slate-400">Deterministic output from the local runtime.</p></div><div aria-live="polite" aria-atomic="true" role={error ? "alert" : "status"}><pre className={`min-h-[420px] whitespace-pre-wrap rounded-2xl border p-4 font-mono text-sm leading-6 ${error ? "border-amber-300/30 bg-amber-950/20 text-amber-100" : "border-white/10 bg-black text-cyan-100"}`}>{error ? `Error: ${error}` : output || "Run the workspace to see output here."}</pre></div></section>
        </div>
        <section id="preview-syntax-note" className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 text-sm leading-6 text-cyan-100"><h2 className="font-semibold text-white">What runs here</h2><p className="mt-2">The full language: variables, text, numbers, booleans, arrays, objects, functions, modules with imports across the files in this workspace, bounded loops, comparisons and <code>print</code>. One sandbox rule: multi-file SolveLang runs locally in your browser; network and file host access stays off in the browser by design, and calls that need a host capability are denied — including unreachable ones.</p></section>
      </div>
    </main>
  );
}
