"use client";

import Link from "next/link";
import { useState } from "react";

import { runSolveLangPreview } from "../../run/browserRunner";

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

type RunStatus = "idle" | "running" | "success" | "error";

export default function RunPage() {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");

  function runCode() {
    setStatus("running");
    setOutput("");
    setError("");

    const result = runSolveLangPreview(code);

    if (result.ok) {
      setOutput(result.output);
      setStatus("success");
      return;
    }

    setOutput(result.output);
    setError(result.error || "Unsupported syntax in browser preview.");
    setStatus("error");
  }

  function resetCode() {
    setCode(starterCode);
    setOutput("");
    setError("");
    setStatus("idle");
  }

  const statusLabel = {
    idle: "Ready",
    running: "Running locally",
    success: "Completed",
    error: "Needs review",
  }[status];

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4 text-sm">
          <Link href="/" className="font-semibold text-white hover:text-cyan-200">
            ← SolveLang
          </Link>
          <div className="flex flex-wrap gap-4 text-slate-300">
            <Link href="/demo/support-triage/" className="hover:text-white">Canonical demo</Link>
            <Link href="/status/" className="hover:text-white">System status</Link>
            <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>
          </div>
        </nav>

        <header className="mb-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              Preview
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
              Browser-only · no server call
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl">
            Preview a small, safe subset of SolveLang.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
            This page is intentionally narrower than the canonical Rust CLI. It is useful for support and lead-routing demos, but it is not the hosted full runtime and does not execute integrations, agents, or file/network side effects.
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${status === "error" ? "bg-amber-300" : status === "success" ? "bg-emerald-300" : "bg-cyan-300"}`} />
            <span className="text-sm font-semibold">{statusLabel}</span>
          </div>
          <p className="text-sm text-slate-400">For full language behavior, use <code className="text-slate-200">solvec</code>.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="script-heading" className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="script-heading" className="text-xl font-semibold">Script</h2>
                <p className="mt-1 text-sm text-slate-400">Edit the supported subset, then run it locally in this browser.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetCode}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={runCode}
                  disabled={status === "running"}
                  className="rounded-xl bg-cyan-300 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === "running" ? "Running…" : "Run preview"}
                </button>
              </div>
            </div>

            <label htmlFor="solve-preview-source" className="sr-only">SolveLang preview source</label>
            <textarea
              id="solve-preview-source"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-[420px] w-full resize-y rounded-2xl border border-white/10 bg-slate-900 p-4 font-mono text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
              spellCheck={false}
              aria-describedby="preview-syntax-note"
            />
          </section>

          <section aria-labelledby="output-heading" className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl">
            <div className="mb-4">
              <h2 id="output-heading" className="text-xl font-semibold">Output</h2>
              <p className="mt-1 text-sm text-slate-400">Deterministic output for the supported browser subset.</p>
            </div>

            <div aria-live="polite" aria-atomic="true">
              <pre className={`min-h-[420px] whitespace-pre-wrap rounded-2xl border p-4 font-mono text-sm leading-6 ${error ? "border-amber-300/30 bg-amber-950/20 text-amber-100" : "border-white/10 bg-black text-cyan-100"}`}>
                {error ? `Error: ${error}` : output || "Run the preview to see output here."}
              </pre>
            </div>
          </section>
        </div>

        <section id="preview-syntax-note" className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 text-sm leading-6 text-cyan-100">
          <h2 className="font-semibold text-white">Supported in this preview</h2>
          <p className="mt-2">
            <code>let</code> variables, text and number values, <code>print</code> statements, comments, blank lines, and simple <code>if</code> blocks using <code>==</code>. Unsupported full-runtime syntax should fail clearly instead of being presented as available.
          </p>
        </section>

        <section className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5 text-sm leading-6 text-amber-100">
          <h2 className="font-semibold text-white">Maturity boundary</h2>
          <p className="mt-2">
            The browser preview is **Preview**, not the canonical runtime. HTTP/file/environment helpers and AI behavior are experimental in the Rust implementation. Managed production workflow execution is planned.
          </p>
        </section>
      </div>
    </main>
  );
}
