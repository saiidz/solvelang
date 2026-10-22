import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Solve Context",
  description: "Solve Context v0: deterministic, local-first context planning, packing, retrieval, and handoff for Claude Code and Codex, with exact source provenance and byte budgets.",
  alternates: { canonical: "https://www.solve-lang.com/solve-context/" },
};

const code = "rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900";

export default function SolveContextPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Documentation navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/technical-evidence/">Technical evidence</Link>
          <Link href="/mcp-setup/">MCP setup</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang documentation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Solve Context v0</h1>
        </header>

        <div className="mt-10 space-y-10">
          <section aria-labelledby="current-verification">
            <h2 id="current-verification" className="text-2xl font-semibold tracking-tight">Current verification — 2026-09-20</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>MCP v0.3.0 is published on npm and GitHub; main protection is enforced. See <Link className="font-semibold text-blue-700 underline" href="/technical-evidence/">the current completion checklist</Link> for fresh evidence and remaining live acceptance gates. Older checkpoints below are historical.</p>
              <p>Status: <strong>implemented repository product foundation with real-source regression coverage; distributed in the tagged MCP v0.3.0 package; not yet proven by complete real-agent/provider measurements</strong></p>
              <p>Tracking epic: #898</p>
              <p>Repository status reconciled through #920 on 2026-09-15.</p>
            </div>
          </section>

          <section aria-labelledby="purpose">
            <h2 id="purpose" className="text-2xl font-semibold tracking-tight">Purpose</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Solve Context is a separate product layer for Claude Code and Codex. It is not part of SolveLang language semantics and it is not Solve Runners. SolveLang can dogfood it, but the context engine is designed for arbitrary repositories.</p>
              <p>The product thesis is: <strong>prevent irrelevant context from being read first; compact only when necessary and only when correctness can be preserved.</strong></p>
            </div>
          </section>

          <section aria-labelledby="implemented-today">
            <h2 id="implemented-today" className="text-2xl font-semibold tracking-tight">Implemented today</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Current repository source includes:</p>
              <ol className="list-decimal space-y-2 pl-6">
                <li><code className={code}>solvelang_context_plan</code> — bounded deterministic task-aware planning;</li>
                <li><code className={code}>solvelang_context_pack</code> — content-addressed exact excerpts with source provenance and byte budgets;</li>
                <li><code className={code}>solvelang_context_retrieve</code> — stale-source-safe exact retrieval;</li>
                <li><code className={code}>solvelang_context_handoff</code> and validation — portable Claude ↔ Codex task state without automatic instruction-file mutation;</li>
                <li>correctness-first structured compaction/expansion for JSON/log/diff payloads;</li>
                <li>changed-path priority and bounded direct relationships from an integrity-validated supplied Solve Graph;</li>
                <li>deterministic selection reasons, path/source ranges, source/excerpt hashes, omission/truncation truth and stable ordering;</li>
                <li>pinned first-party real-source regressions from SolveLang;</li>
                <li>independently pinned Chalk and node-fetch source subsets with equal-budget lexical/changed-path/graph-assisted comparisons;</li>
                <li>an offline agent-run record/report contract for future approved real Claude/Codex measurements;</li>
                <li>#920 pair-integrity rules requiring baseline and Solve Context arms to use the same fixture/provider/model/agent/record class, outcome-evaluation basis and required-evidence denominator.</li>
              </ol>
            </div>
          </section>

          <section aria-labelledby="what-is-not-established-yet">
            <h2 id="what-is-not-established-yet" className="text-2xl font-semibold tracking-tight">What is not established yet</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>The repository does <strong>not</strong> currently establish:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>verified managed-workspace installation or public Plugin Directory listing for the published MCP v0.3.0 package;</li>
                <li>real Claude/Codex provider-token savings;</li>
                <li>real-agent task-success improvement or quality equivalence across the full benchmark suite;</li>
                <li>provider cache-reuse improvement;</li>
                <li>end-to-end agent latency improvement;</li>
                <li>superiority over Headroom or another context product;</li>
                <li>a live provider proxy;</li>
                <li>a provenance/memory learner that is part of the released product.</li>
              </ul>
              <p>Synthetic/pinned-source excerpt-byte reduction is not provider-token savings.</p>
            </div>
          </section>

          <section aria-labelledby="context-pack-contract">
            <h2 id="context-pack-contract" className="text-2xl font-semibold tracking-tight">Context-pack contract</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>A context pack contains:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>a schema identifier;</li>
                <li>a content-addressed pack ID;</li>
                <li>a hash of task text rather than storing the task text as pack identity;</li>
                <li>a hard UTF-8 byte budget;</li>
                <li>measured selected bytes and explicit omission/truncation truth;</li>
                <li>normalized workspace-relative source paths;</li>
                <li>exact line ranges;</li>
                <li>SHA-256 identities for complete source and selected excerpt;</li>
                <li>stable retrieval handles;</li>
                <li>deterministic relevance reasons/score;</li>
                <li>exact selected source text.</li>
              </ul>
              <p>The canonical schema is <code className={code}>schemas/solve-context-pack.v0.schema.json</code>.</p>
            </div>
          </section>

          <section aria-labelledby="selection-behavior">
            <h2 id="selection-behavior" className="text-2xl font-semibold tracking-tight">Selection behavior</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Selection is local and deterministic. It combines lexical evidence with optional explicit changed paths and an optional supplied Solve Graph. Current behavior includes:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li>local task-token/path/source matching;</li>
                <li>bounded lexical windows;</li>
                <li>deterministic whole-line budget fragments when a matching window is larger than remaining budget;</li>
                <li>changed-path priority before the discovery read cap;</li>
                <li>one-hop graph dependency/dependent/test evidence;</li>
                <li>bounded exported-declaration text windows for graph-selected neighbors where necessary to preserve relevant implementation evidence;</li>
                <li>global ranking of fragments using actual scores with stable tie handling;</li>
                <li>exact provenance for every included excerpt;</li>
                <li>explicit omissions rather than hidden summarization.</li>
              </ul>
              <p>The graph input is local and integrity-validated but is not an authenticated statement of workspace freshness. The tool reports that distinction rather than pretending a checksum proves current workspace truth.</p>
            </div>
          </section>

          <section aria-labelledby="safety-invariants">
            <h2 id="safety-invariants" className="text-2xl font-semibold tracking-tight">Safety invariants</h2>
            <div className="mt-6 space-y-8">
              <section aria-labelledby="local-first-and-read-only">
                <h3 id="local-first-and-read-only" className="text-xl font-semibold tracking-tight">Local-first and read-only</h3>
                <p className="mt-3 leading-7 text-slate-700">Context optimization does not imply a model call, network call, repository write, credential read, dependency installation or repository-source execution.</p>
              </section>
              <section aria-labelledby="source-identity">
                <h3 id="source-identity" className="text-xl font-semibold tracking-tight">Source identity</h3>
                <p className="mt-3 leading-7 text-slate-700">Every selected excerpt retains complete-source and excerpt identity. Retrieval rejects stale source when the workspace content no longer matches the handle.</p>
              </section>
              <section aria-labelledby="path-and-privacy-bounds">
                <h3 id="path-and-privacy-bounds" className="text-xl font-semibold tracking-tight">Path and privacy bounds</h3>
                <p className="mt-3 leading-7 text-slate-700">Paths are normalized workspace-relative identities; unsafe/traversal-style paths and likely sensitive paths are rejected according to the reviewed runtime policy. Workspace discovery remains bounded.</p>
              </section>
              <section aria-labelledby="budget-truth">
                <h3 id="budget-truth" className="text-xl font-semibold tracking-tight">Budget truth</h3>
                <p className="mt-3 leading-7 text-slate-700"><code className={code}>selectedBytes</code> is measured from exact UTF-8 content. Content that cannot fit is omitted or represented by an explicitly bounded exact fragment according to the reviewed algorithm; no hidden summary is presented as exact source.</p>
              </section>
              <section aria-labelledby="provider-cache-truth">
                <h3 id="provider-cache-truth" className="text-xl font-semibold tracking-tight">Provider/cache truth</h3>
                <p className="mt-3 leading-7 text-slate-700">Current context-pack operation does not mutate provider request prefixes. Future safe-mode measurement requires <code className={code}>cacheHotBytesChanged: 0</code> to be measured, not inferred from missing data.</p>
              </section>
            </div>
          </section>

          <section aria-labelledby="evaluation-status">
            <h2 id="evaluation-status" className="text-2xl font-semibold tracking-tight">Evaluation status</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>The evaluation stack now has three layers:</p>
            </div>
            <div className="mt-6 space-y-8">
              <section aria-labelledby="synthetic-deterministic-suite">
                <h3 id="synthetic-deterministic-suite" className="text-xl font-semibold tracking-tight">Synthetic deterministic suite</h3>
                <div className="mt-3 space-y-4 leading-7 text-slate-700">
                  <p>Covers all six acceptance categories:</p>
                  <ul className="list-disc space-y-2 pl-6">
                    <li>monorepo bug fix;</li>
                    <li>GitHub issue triage;</li>
                    <li>CI/log diagnosis;</li>
                    <li>multi-file refactor;</li>
                    <li>JSON-heavy tool output;</li>
                    <li>cross-agent handoff.</li>
                  </ul>
                  <p>Synthetic results are regression evidence only.</p>
                </div>
              </section>
              <section aria-labelledby="pinned-source-regressions">
                <h3 id="pinned-source-regressions" className="text-xl font-semibold tracking-tight">Pinned source regressions</h3>
                <div className="mt-3 space-y-4 leading-7 text-slate-700">
                  <ul className="list-disc space-y-2 pl-6">
                    <li>first-party SolveLang source subset;</li>
                    <li>independent external subsets from Chalk and node-fetch.</li>
                  </ul>
                  <p>These prove deterministic selection/integrity behavior on immutable source snapshots but are not blinded whole-repository or live-agent benchmarks.</p>
                </div>
              </section>
              <section aria-labelledby="real-agent-record-report-contract">
                <h3 id="real-agent-record-report-contract" className="text-xl font-semibold tracking-tight">Real-agent record/report contract</h3>
                <div className="mt-3 space-y-4 leading-7 text-slate-700">
                  <p>Future separately authorized baseline-vs-Solve-Context runs can be summarized only when records pass strict identity and measurement validation. <code className={code}>benchmarkEvidenceComplete</code> remains false until measured pairs cover all six categories, both Claude and Codex, both handoff directions, no quality regression, provider-reported tokens for every measured pair, measured latency, measured selection precision/recall and measured zero safe-mode cache-hot mutation for every context arm.</p>
                  <p>Even a complete engineering matrix keeps publication/public-percentage authorization false until separately approved.</p>
                </div>
              </section>
            </div>
          </section>

          <section aria-labelledby="distribution-truth">
            <h2 id="distribution-truth" className="text-2xl font-semibold tracking-tight">Distribution truth</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>MCP <code className={code}>@solvelang/mcp-server@0.3.0</code> is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.</p>
              <p>External distribution verification remains a distinct milestone from repository source/tag state.</p>
            </div>
          </section>

          <section aria-labelledby="projected-next-work">
            <h2 id="projected-next-work" className="text-2xl font-semibold tracking-tight">Projected next work</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>These are priorities, not promised dates:</p>
              <ol className="list-decimal space-y-2 pl-6">
                <li>add broader independent/blinded repository fixtures without weakening budgets/evidence;</li>
                <li>fix only demonstrated selection defects exposed by those fixtures;</li>
                <li>run separately authorized real Claude/Codex baseline-vs-context tasks covering all acceptance categories and both handoff directions;</li>
                <li>collect truthful provider-token/latency/cache/selection/quality evidence;</li>
                <li>verify managed-workspace installation and Plugin Directory listing for the published release;</li>
                <li>consider optional provider-proxy or provenance/memory work only as separately reviewed expansion after core evidence is strong.</li>
              </ol>
            </div>
          </section>

          <section aria-labelledby="optional-provider-proxy-boundary">
            <h2 id="optional-provider-proxy-boundary" className="text-2xl font-semibold tracking-tight">Optional provider proxy boundary</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>A provider proxy is not part of current v0 activation. If later approved, it must be fixture-locked for raw-byte/streaming fidelity: untouched material byte-identical, cache-hot prefixes preserved, Anthropic cache-control boundaries respected, OpenAI Responses fields such as <code className={code}>phase</code> preserved, numeric/tool/content ordering stable, UTF-8 handled at byte boundaries and streaming errors/termination truth retained. If safe transformation cannot be proven, optimization must fail open to the original content.</p>
            </div>
          </section>

          <section aria-labelledby="success-criterion">
            <h2 id="success-criterion" className="text-2xl font-semibold tracking-tight">Success criterion</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Solve Context succeeds when Claude and Codex complete coding tasks with less irrelevant context <strong>without measurable quality regression</strong>, while exact source evidence remains recoverable and provider/cache behavior stays truthful. Compression percentage alone is not the product goal.</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
