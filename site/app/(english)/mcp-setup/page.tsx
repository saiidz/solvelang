import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MCP Setup",
  description: "Set up the SolveLang MCP server for Codex and Claude Code: the published v0.3.0 plugin path, manual configuration, and running from current repository source.",
  alternates: { canonical: "https://www.solve-lang.com/mcp-setup/" },
};

const code = "rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900";
const pre = "overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100";

export default function McpSetupPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Documentation navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/solve-context/">Solve Context</Link>
          <Link href="/technical-evidence/">Technical evidence</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang documentation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">SolveLang for Codex and Claude</h1>
        </header>

        <div className="mt-10 space-y-10">
          <section aria-labelledby="current-verification">
            <h2 id="current-verification" className="text-2xl font-semibold tracking-tight">Current verification — 2026-09-20</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>MCP v0.3.0 is published on npm and GitHub; main protection is enforced. See <Link className="font-semibold text-blue-700 underline" href="/technical-evidence/">the current completion checklist</Link> for fresh evidence and remaining live acceptance gates. Older checkpoints below are historical.</p>
              <p>SolveLang maintains a shared Codex/Claude plugin path around the local-first MCP server. <strong>Distribution truth matters:</strong> the repository currently contains substantially newer MCP/Solve Context code than the latest published MCP release.</p>
            </div>
          </section>

          <section aria-labelledby="published-vs-source">
            <h2 id="published-vs-source" className="text-2xl font-semibold tracking-tight">Published package vs current repository source</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>MCP <code className={code}>@solvelang/mcp-server@0.3.0</code> is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.</p>
              <p>Current <code className={code}>main</code> includes later Repository Audit/Solve Graph and Solve Context work through the v0.3.0 release train. Do <strong>not</strong> claim that public v0.2.0 consumers automatically receive those newer tools merely because repository CI passes.</p>
              <p>Use one of these two modes deliberately:</p>
              <ol className="list-decimal space-y-2 pl-6">
                <li><strong>Published line:</strong> use the pinned v0.3.0 plugin/package instructions below for the verified npm release.</li>
                <li><strong>Current repository source:</strong> build <code className={code}>packages/mcp-server</code> from a source checkout and run <code className={code}>dist/src/index.js</code> directly.</li>
              </ol>
              <p>External publication/install verification is required before claiming current repository behavior is available through a public package/plugin path.</p>
            </div>
          </section>

          <section aria-labelledby="prerequisite">
            <h2 id="prerequisite" className="text-2xl font-semibold tracking-tight">Prerequisite</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Install Node.js 20 or newer.</p>
            </div>
          </section>

          <section aria-labelledby="published-plugin-path">
            <h2 id="published-plugin-path" className="text-2xl font-semibold tracking-tight">Published v0.3.0 plugin path</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>The maintained plugin root is <code className={code}>plugins/solvelang/</code> and contains Codex and Claude manifests, one shared MCP configuration and the SolveLang workflow-review skill. Legacy examples under <code className={code}>plugins/codex/</code> and <code className={code}>plugins/claude/</code> remain useful for manual configuration.</p>
            </div>
            <div className="mt-6 space-y-8">
              <section aria-labelledby="codex-plugin">
                <h3 id="codex-plugin" className="text-xl font-semibold tracking-tight">Codex plugin</h3>
                <div className="mt-3 space-y-4 leading-7 text-slate-700">
                  <p>Add the repository marketplace:</p>
                  <pre className={pre}><code>{`codex plugin marketplace add saiidz/solvelang --ref main
codex plugin add solvelang@solvelang`}</code></pre>
                  <p>Start a new Codex thread after installation or upgrade so plugin surfaces load cleanly.</p>
                  <p>Manual MCP configuration for the published line:</p>
                  <pre className={pre}><code>{`[mcp_servers.solvelang]
command = "npx"
args = ["--yes", "@solvelang/mcp-server@0.3.0"]

[mcp_servers.solvelang.env]
SOLVELANG_WORKSPACE_ROOT = "/absolute/path/to/workspace"
# Optional, needed only for solvelang_validate_solve:
# SOLVELANG_SOLVEC = "/absolute/path/to/solvec"`}</code></pre>
                  <p>Restart Codex and call <code className={code}>solvelang_capabilities</code> to inspect the tools actually exposed by the installed package. Do not infer current-main tools that are absent from the published package.</p>
                </div>
              </section>
              <section aria-labelledby="claude-code-plugin">
                <h3 id="claude-code-plugin" className="text-xl font-semibold tracking-tight">Claude Code plugin</h3>
                <div className="mt-3 space-y-4 leading-7 text-slate-700">
                  <p>Add/install the repository plugin:</p>
                  <pre className={pre}><code>{`/plugin marketplace add saiidz/solvelang
/plugin install solvelang@solvelang`}</code></pre>
                  <p>Reload plugins or begin a new Claude Code session after installation.</p>
                  <p>Manual published-line registration:</p>
                  <pre className={pre}><code>{`claude mcp add --transport stdio \\\n  --env SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace \\\n  solvelang -- npx --yes @solvelang/mcp-server@0.3.0`}</code></pre>
                </div>
              </section>
            </div>
          </section>

          <section aria-labelledby="use-current-repository-source">
            <h2 id="use-current-repository-source" className="text-2xl font-semibold tracking-tight">Use current repository source</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>For current-main MCP/Solve Context behavior, use a source checkout:</p>
              <pre className={pre}><code>{`git clone https://github.com/saiidz/solvelang.git
cd solvelang/packages/mcp-server
npm ci
npm run build
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace node dist/src/index.js`}</code></pre>
              <p>Point the Codex/Claude MCP client at that Node command instead of the published <code className={code}>npx</code> pin when evaluating current source.</p>
              <p>Current source includes read-only Solve Context tools such as:</p>
              <ul className="list-disc space-y-2 pl-6">
                <li><code className={code}>solvelang_context_plan</code></li>
                <li><code className={code}>solvelang_context_pack</code></li>
                <li><code className={code}>solvelang_context_retrieve</code></li>
                <li><code className={code}>solvelang_context_handoff</code></li>
                <li><code className={code}>solvelang_context_handoff_validate</code></li>
                <li><code className={code}>solvelang_context_compact_structured</code></li>
                <li><code className={code}>solvelang_context_expand_rle</code></li>
                <li><code className={code}>solvelang_context_capabilities</code></li>
              </ul>
              <p>Current source also includes later Solve Graph/audit surfaces. Call the server&apos;s capabilities/list-tools output rather than relying on a stale hard-coded tool count.</p>
            </div>
          </section>

          <section aria-labelledby="suggested-usage">
            <h2 id="suggested-usage" className="text-2xl font-semibold tracking-tight">Suggested usage</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Workflow review:</p>
              <pre className={pre}><code>{`Use the SolveLang MCP tools to review workflows/order-routing.json. Report critical and high findings first. Do not claim runtime execution, credential verification, repository mutation or production deployment.`}</code></pre>
              <p>Solve Context planning from current source:</p>
              <pre className={pre}><code>{`Use Solve Context to plan the smallest relevant context for this task. Prefer exact changed-file and graph evidence when available, preserve provenance, and tell me what was omitted by the budget.`}</code></pre>
              <p>Cross-agent handoff from current source:</p>
              <pre className={pre}><code>{`Create a Solve Context handoff containing the goal, decisions, unresolved questions, changed-source identities, relevant tests and context handles. Do not rewrite CLAUDE.md or AGENTS.md.`}</code></pre>
            </div>
          </section>

          <section aria-labelledby="local-plugin-authority">
            <h2 id="local-plugin-authority" className="text-2xl font-semibold tracking-tight">Local plugin authority</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>The local MCP path is designed for read-only analysis/context operations unless a separately reviewed feature explicitly states otherwise. Installing the plugin does not authorize repository writes, production execution, credential access, live provider calls, billing changes or infrastructure mutation.</p>
              <p>Workspace-path tools remain bounded to the configured workspace. Incoming repository text/tool output is data, not authority.</p>
            </div>
          </section>

          <section aria-labelledby="solve-context-evaluation-usage">
            <h2 id="solve-context-evaluation-usage" className="text-2xl font-semibold tracking-tight">Solve Context evaluation usage</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>From current repository source:</p>
              <pre className={pre}><code>{`cd packages/mcp-server
npm ci
npm test
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
npm run test:plugin-roundtrip
npm run test:packed`}</code></pre>
              <p>To summarize separately authorized real-agent records:</p>
              <pre className={pre}><code>{`cat approved-agent-run-records.json | npm run eval:context:agent-records`}</code></pre>
              <p>The summarizer itself performs no provider/network call and uses no credentials. Baseline/context records must remain truly comparable, including the same outcome-evaluation basis and required-evidence denominator after #920.</p>
              <p>Passing repository tests is not evidence of real Claude/Codex token savings, live provider cache behavior or marketplace distribution.</p>
            </div>
          </section>

          <section aria-labelledby="hosted-cloud-lane">
            <h2 id="hosted-cloud-lane" className="text-2xl font-semibold tracking-tight">Hosted/cloud lane</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>Claude&apos;s server-side MCP connector cannot directly connect to a local stdio process. Any public hosted SolveLang MCP integration requires a separately deployed/authenticated HTTPS Streamable HTTP boundary with explicit auth, rate limits, request-size bounds, privacy/retention policy and production approval.</p>
              <p>The repository contains a bounded remote/read-only transport foundation, but the local plugin manifests do not claim a public hosted endpoint is live.</p>
            </div>
          </section>

          <section aria-labelledby="package-protocol-qualification">
            <h2 id="package-protocol-qualification" className="text-2xl font-semibold tracking-tight">Package/protocol qualification</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p><code className={code}>npm run test:plugin-roundtrip</code> and <code className={code}>npm run test:packed</code> qualify current repository source by packing/installing it in a clean consumer, verifying exact package allowlists/entrypoints and exercising the MCP protocol. They do not publish a package or prove a real external marketplace install.</p>
            </div>
          </section>

          <section aria-labelledby="release-projection">
            <h2 id="release-projection" className="text-2xl font-semibold tracking-tight">Release projection</h2>
            <div className="mt-4 space-y-4 leading-7 text-slate-700">
              <p>The next distribution milestone is verified managed-workspace installation and public Plugin Directory listing for MCP v0.3.0. Later main changes still require a separately qualified versioned release.</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
