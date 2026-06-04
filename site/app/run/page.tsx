"use client";

import { useState } from "react";

import { runSolveLangPreview } from "./browserRunner";

const starterCode = `let priority = "high"
let channel = "email"

print("Running SolveLang hosted preview")
print(channel)

if priority == "high" {
  print("Escalate immediately")
}`;

export default function RunPage() {
  const [code, setCode] = useState(starterCode);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  function runCode() {
    setRunning(true);
    setOutput("");
    setError("");
    const result = runSolveLangPreview(code);

    if (result.ok) {
      setOutput(result.output);
    } else {
      setOutput(result.output);
      setError(result.error || "Unsupported syntax in hosted preview.");
    }

    setRunning(false);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
            Hosted preview
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Run SolveLang in the browser.
          </h1>
          <p className="mt-5 max-w-3xl text-lg text-slate-300">
            This browser preview supports a safe subset of SolveLang. Full Rust runtime hosting is
            coming later.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Script</h2>
              <button
                onClick={runCode}
                disabled={running}
                className="rounded-xl bg-cyan-300 px-5 py-2 font-semibold text-slate-950 disabled:opacity-60"
              >
                {running ? "Running..." : "Run"}
              </button>
            </div>

            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-[420px] w-full rounded-2xl border border-white/10 bg-slate-900 p-4 font-mono text-sm leading-6 text-slate-100 outline-none"
              spellCheck={false}
            />
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl">
            <h2 className="mb-4 text-xl font-semibold">Output</h2>

            <pre className="min-h-[420px] whitespace-pre-wrap rounded-2xl border border-white/10 bg-black p-4 font-mono text-sm leading-6 text-cyan-100">
              {error ? `Error: ${error}` : output || "Run a script to see output here."}
            </pre>
          </section>
        </div>

        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 text-sm text-cyan-100">
          Supported in this browser preview: let variables, text and number values, print
          statements, comments, blank lines, and simple if blocks using ==.
        </div>
      </div>
    </main>
  );
}
