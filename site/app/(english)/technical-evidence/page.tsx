import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Technical Evidence",
  description: "SolveLang full-project completion evidence: requirement-by-requirement status, verification evidence, and remaining acceptance gates, re-audited 2026-09-22.",
  alternates: { canonical: "https://www.solve-lang.com/technical-evidence/" },
};

const code = "rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900";
const ext = "font-semibold text-blue-700 underline";
const th = "border border-slate-200 px-4 py-3 text-left align-top font-semibold";
const td = "border border-slate-200 px-4 py-3 align-top";

export default function TechnicalEvidencePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Documentation navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/solve-context/">Solve Context</Link>
          <Link href="/mcp-setup/">MCP setup</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang documentation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">SolveLang full-project completion evidence</h1>
        </header>

        <div className="mt-10 space-y-4 leading-7 text-slate-700">
          <p>Repository source status was re-audited on 2026-09-22 at main <code className={code}>59ab9ff271850454a2029495c2faf34cb93a10c7</code> after #945. Production/runtime and native-platform observations below were checked on 2026-09-20 through main <code className={code}>632b6ff82f2f54babe46e4e11e672675e4ca838e</code> (#938–#942); each external observation is separately identified and keeps its own collection date. The goal includes the existing roadmap and requested Studio account persistence. It excludes the separately deferred Solve Runners/Solblend product and does not invent a 1.0 language/platform promise. Completion requires evidence, not a percentage estimate or a count of merged PRs.</p>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm leading-6 text-slate-700">
            <thead>
              <tr className="bg-slate-100 text-slate-950">
                <th className={th}>Requirement</th>
                <th className={th}>Evidence/status</th>
                <th className={th}>Remaining acceptance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>Remove beta positioning</td>
                <td className={td}>Confirmed: #938 merged; six public resources returned 200 with zero beta labels</td>
                <td className={td}>None for this copy change</td>
              </tr>
              <tr>
                <td className={td}>GitHub About description</td>
                <td className={td}>Confirmed saved in the authenticated repository UI</td>
                <td className={td}>None</td>
              </tr>
              <tr>
                <td className={td}>Main governance</td>
                <td className={td}>Confirmed: ruleset 18206723, four strict checks, PR required, threads resolved, no bypass</td>
                <td className={td}>Human approval count is zero by configured policy</td>
              </tr>
              <tr>
                <td className={td}>MCP v0.3.0 publication</td>
                <td className={td}>Confirmed npm registry and published GitHub Release</td>
                <td className={td}>Does not prove marketplace installation</td>
              </tr>
              <tr>
                <td className={td}>Studio account saving</td>
                <td className={td}>Merged #939 at <code className={code}>8ef4829228e89c1c04ab3f2e0565dc6357b5fce7</code>; 515 API tests, full Studio suite, five CI workflows passed</td>
                <td className={td}>Backend deployed in run 35531150309 with configuration preserved; all six authenticated account-isolation, conflict, switching, offline, export and removal checks remain required before frontend enablement</td>
              </tr>
              <tr>
                <td className={td}>Safe API maintenance deployment</td>
                <td className={td}>Merged #940 adds bounded changes, parameter preservation and rollback; 521 API tests pass with #942</td>
                <td className={td}>Plan 35530924473 and deployment 35531150309 passed; all parameters/health flags preserved; unauthenticated Studio GET returns 401</td>
              </tr>
              <tr>
                <td className={td}>Admin Gateway rollout guard</td>
                <td className={td}>PR <a className={ext} href="https://github.com/saiidz/solvelang/pull/945">#945</a> exact head <code className={code}>c709b3a8325404d2f88d83138a1b331c4e8f04fd</code> passed API Access CI and all four required contexts; merged as <code className={code}>59ab9ff271850454a2029495c2faf34cb93a10c7</code>. The four required main checks and API Access CI also passed on that merge commit. The manual workflow now preserves the captured billing flag; it was not dispatched.</td>
                <td className={td}>Future manual dispatch still requires a separate production approval; this repository change is not deployment evidence</td>
              </tr>
              <tr>
                <td className={td}>Solve Context independent corpus</td>
                <td className={td}>Chalk/node-fetch/Preact and heldout protocol exist after #922–#924</td>
                <td className={td}>Blinded outcomes and actual Claude/Codex provider-token/latency/task-quality matrix</td>
              </tr>
              <tr>
                <td className={td}>Managed Codex marketplace install</td>
                <td className={td}>Repository packaging/import contract exists</td>
                <td className={td}>Actual managed-workspace installation and tool invocation evidence</td>
              </tr>
              <tr>
                <td className={td}>Public Plugin Directory</td>
                <td className={td}>Unverified</td>
                <td className={td}>Submission/review/listing evidence</td>
              </tr>
              <tr>
                <td className={td}>Production API health</td>
                <td className={td}>Confirmed public <code className={code}>/health</code>: API, customer accounts, TOTP and subscription billing enabled</td>
                <td className={td}>Health flags do not establish payment outcomes</td>
              </tr>
              <tr>
                <td className={td}>API subscription payment canary</td>
                <td className={td}>Unverified; live Stripe search found no subscriptions with Developer/Pro/Business plan metadata</td>
                <td className={td}>Explicitly scoped successful payment, webhook/account entitlement, cancellation/refund/recovery evidence</td>
              </tr>
              <tr>
                <td className={td}>Connected support #896</td>
                <td className={td}>Repository implementation and monitoring exist</td>
                <td className={td}>Deployment, scoped credentials, bounded new-message task/reply and stop/recovery proof</td>
              </tr>
              <tr>
                <td className={td}>PostHog #833</td>
                <td className={td}>Repository transport/lifecycle contracts exist</td>
                <td className={td}>Concrete credential/lifecycle backend, project scope and one bounded live canary</td>
              </tr>
              <tr>
                <td className={td}>Paid priority/provider execution</td>
                <td className={td}>Repository qualification only</td>
                <td className={td}>Verified deployment, provider credentials, alarms and recovery acceptance</td>
              </tr>
              <tr>
                <td className={td}>Native macOS ARM64 / Windows x64 qualification</td>
                <td className={td}>Merged #941; both native jobs passed at <code className={code}>ed0dbcc82467fb690d2d8dd4420a964001b44846</code>, run 35530427540</td>
                <td className={td}>A new public native release/tag, signing and notarization are not implied</td>
              </tr>
              <tr>
                <td className={td}>Final security and production smoke</td>
                <td className={td}>Focused changed-boundary review completed; #942 main CI and deployment passed; #943 exact PR head <code className={code}>63b45066fe1e837a158333cb0dfee17d0c6ae31b</code> passed all five workflows (MCP CI, Rust, Release Candidate CI, CI, WASM artifact security)</td>
                <td className={td}>Remaining authenticated Studio, payment and provider acceptance</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section aria-labelledby="directly-inspected-sources" className="mt-12">
          <h2 id="directly-inspected-sources" className="text-2xl font-semibold tracking-tight">Directly inspected sources</h2>
          <div className="mt-4 leading-7 text-slate-700">
            <ul className="list-disc space-y-2 pl-6">
              <li><a className={ext} href="https://github.com/saiidz/solvelang/pull/938">PR #938</a></li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/pull/943">PR #943</a>, exact PR-head workflows <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531758510">MCP CI</a>, <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531758506">Rust</a>, <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531758515">Release Candidate CI</a>, <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531758509">CI</a>, and <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531758514">WASM artifact security</a></li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/pull/939">PR #939</a></li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/pull/945">PR #945</a>, exact head <code className={code}>c709b3a8325404d2f88d83138a1b331c4e8f04fd</code>; main checks on merge <code className={code}>59ab9ff271850454a2029495c2faf34cb93a10c7</code>: <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35809781929">API Access CI</a>, <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35809781905">CI</a>, <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35809781907">Rust</a>, and <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35809781899">WASM artifact security</a>.</li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35530924473">Validated production plan</a> and <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35531150309">successful deployment</a>, both at main <code className={code}>632b6ff82f2f54babe46e4e11e672675e4ca838e</code>.</li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/pull/941">Native qualification #941</a> and <a className={ext} href="https://github.com/saiidz/solvelang/actions/runs/35530427540">both-platform run</a>.</li>
              <li>Native workflow artifact IDs: Windows <code className={code}>10611202508</code>; macOS ARM64 <code className={code}>10610698792</code>. These expire after 14 days and are qualification evidence, not public releases.</li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/rules/18206723">Main ruleset</a></li>
              <li><a className={ext} href="https://github.com/saiidz/solvelang/releases/tag/v0.3.0">MCP v0.3.0 release</a></li>
              <li>npm read: <code className={code}>npm view @solvelang/mcp-server@0.3.0 version dist.integrity dist.tarball --json</code></li>
              <li>npm integrity: <code className={code}>sha512-aOH/Sg6OF17sePGlnoJ6hfFdEY4tL1Wj/ZW8A3ZmpZg9doFJpCC4IUTmhWnTZZY8iToc5y52+n9+Cu/Z68xUlA==</code></li>
              <li>Public API health: <code className={code}>https://3l3y008e94.execute-api.us-east-2.amazonaws.com/health</code>.</li>
              <li>Live website checks: <code className={code}>/</code>, <code className={code}>/about/</code>, <code className={code}>/landing/</code>, <code className={code}>/run/</code>, <code className={code}>/check/</code>, <code className={code}>/llms.txt</code>.</li>
              <li>Live Stripe read-only search in the configured SolveLang merchant account: <code className={code}>metadata[&apos;plan&apos;]:&apos;developer&apos; OR metadata[&apos;plan&apos;]:&apos;pro&apos; OR metadata[&apos;plan&apos;]:&apos;business&apos;</code>. Empty results with no further page are limited search evidence, not a claim that the merchant has no payments or that the checkout is defective.</li>
            </ul>
          </div>
          <div className="mt-6 space-y-4 leading-7 text-slate-700">
            <p>No charges, refunds, inbox messages, customer data changes, provider activation, or secret provisioning were performed for this evidence record.</p>
            <p>See the changed-boundary verification (<code className={code}>completion-security-review-2026-09-20.md</code>) for failure classifications and the limits of repository evidence.</p>
          </div>
        </section>
      </section>
    </main>
  );
}
