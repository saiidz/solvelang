import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { LanguageSelector } from "../../components/LanguageSelector";
import { defaultLocale } from "../../i18n/locales";

const workingNow = [
  "Rust CLI with lexer, parser, AST runtime, validation, diagnostics, imports, arrays, objects, functions, loops, and JSON helpers",
  "Hardened local execution modes for restricting network, file, environment, and AI capabilities",
  "Local-first Workflow Intelligence Studio with deterministic analysis and simulation",
  "Browser-safe preview for a deliberately smaller syntax subset",
];

const experimental = [
  "HTTP, file, and environment helpers",
  "AI agent syntax with local fallback and optional OpenAI-backed responses",
  "Test-mode API access, account, subscription, and metering infrastructure",
];

const roadmap = [
  "Stable language specification and release packaging",
  "Broader provider and execution adapters",
  "Production integrations and managed workflow execution",
  "Team environments, hosted observability, and production operating controls",
];

const examples = [
  ["Support triage", "Route billing and urgent support cases using readable deterministic rules."],
  ["Lead qualification", "Make fit, urgency, and follow-up rules visible before CRM automation."],
  ["Invoice processing", "Separate extraction, deterministic checks, exceptions, and approvals."],
  ["Approval workflows", "Model policy, human review, rejection paths, and implementation boundaries."],
];

export default function Page() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="SolveLang home">
            <Image
              src="/solvelang-logo.svg"
              alt="SolveLang"
              width={210}
              height={44}
              className="h-auto w-[170px] brightness-0 invert"
              priority
            />
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-slate-300 lg:flex">
            <a href="#architecture" className="hover:text-white">Architecture</a>
            <a href="#examples" className="hover:text-white">Examples</a>
            <a href="#status" className="hover:text-white">Status</a>
            <Link href="/resources/" className="hover:text-white">Docs</Link>
            <Link href="/status/" className="hover:text-white">System status</Link>
          </div>

          <div className="flex items-center gap-2">
            <Suspense fallback={<span className="w-12" aria-hidden="true" />}>
              <LanguageSelector current={defaultLocale} />
            </Suspense>
            <a
              href="https://github.com/saiidz/solvelang"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              GitHub
            </a>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute left-1/2 top-0 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-32">
            <div>
              <div className="inline-flex rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
                Early beta · open source · honest maturity labels
              </div>
              <h1 className="mt-7 max-w-4xl text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                A readable, explainable workflow language for AI-assisted business processes.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                SolveLang makes workflow intent visible in source control: deterministic rules, AI-assisted decisions, tools, approvals, failure paths, and human review points can be discussed before a process becomes opaque automation.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/demo/support-triage/" className="rounded-2xl bg-blue-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-400">
                  View canonical demo
                </Link>
                <Link href="/run/" className="rounded-2xl border border-white/15 px-6 py-3.5 text-sm font-semibold hover:bg-white/10">
                  Try browser preview
                </Link>
                <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="rounded-2xl border border-white/15 px-6 py-3.5 text-sm font-semibold hover:bg-white/10">
                  Inspect the code
                </a>
              </div>
              <p className="mt-5 text-sm text-slate-400">
                The Rust CLI is the canonical runtime. The browser preview supports a smaller safe subset. Managed production execution is planned, not available today.
              </p>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
              <div className="border-b border-white/10 pb-4 font-mono text-xs uppercase tracking-[0.2em] text-slate-400">support_triage.solve</div>
              <pre className="overflow-x-auto py-6 font-mono text-sm leading-7 text-slate-200"><code>{`let ticket = {
  topic: "billing",
  priority: "urgent"
}

if ticket.priority == "urgent" {
  print("Action: escalate to founder today")
}

if ticket.topic == "billing" {
  print("Owner: finance operations")
}`}</code></pre>
              <div className="grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2">
                {[
                  ["Readable", "Business rules are explicit"],
                  ["Version controlled", "Workflow changes can be diffed"],
                  ["Auditable", "AI and side-effect boundaries are visible"],
                  ["Composable", "Small workflows can evolve deliberately"],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <p className="font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="architecture" className="bg-white py-24 text-slate-950">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Architecture</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">A language layer first, not another integration canvas.</h2>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">The current architecture separates the canonical Rust language/runtime from derived browser experiences and experimental hosted infrastructure.</p>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["1. Language", "Lexer, parser, AST, validation, diagnostics, and runtime semantics in Rust."],
                ["2. Local execution", "Trusted local runs plus hardened modes that deny sensitive capabilities."],
                ["3. Studio + preview", "Local-first deterministic workflow analysis and a smaller browser-safe runtime subset."],
                ["4. Future adapters", "External runtimes and managed execution are evidence-led roadmap items, not current promises."],
              ].map(([title, body]) => (
                <article key={title} className="rounded-[1.75rem] border border-slate-200 p-6 shadow-sm">
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="examples" className="border-y border-white/10 py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">Examples</p>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Business workflows, with the implementation boundary stated.</h2>
              </div>
              <Link href="/resources/" className="text-sm font-semibold text-blue-300 hover:text-blue-200">Browse documentation →</Link>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {examples.map(([title, body]) => (
                <article key={title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-7">
                  <h3 className="text-2xl font-semibold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-300">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="status" className="bg-slate-100 py-24 text-slate-950">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Product status</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Know what you are looking at.</h2>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {[
                ["Working today", workingNow, "bg-emerald-50 text-emerald-700"],
                ["Experimental", experimental, "bg-amber-50 text-amber-700"],
                ["Planned", roadmap, "bg-slate-200 text-slate-700"],
              ].map(([title, items, tone]) => (
                <article key={title as string} className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] ${tone}`}>{title as string}</span>
                  <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-600">
                    {(items as string[]).map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </article>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/status/" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">System status</Link>
              <a href="https://github.com/saiidz/solvelang/blob/main/docs/demo-status.md" target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold">Demo status document</a>
            </div>
          </div>
        </section>

        <section className="bg-white py-24 text-slate-950">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-8 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-200 p-8">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">For teams</p>
              <h2 className="mt-4 text-3xl font-semibold">Need help making a workflow understandable?</h2>
              <p className="mt-4 leading-7 text-slate-600">SolveLang’s near-term business path is service-led: workflow clarity audits, prototype sprints, and implementation work using the right execution platform for the client.</p>
              <a href="mailto:hello@solve-lang.com?subject=Workflow%20clarity%20audit" className="mt-7 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white">Discuss a workflow audit</a>
            </div>
            <div className="rounded-[2rem] border border-slate-200 p-8">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">For recruiters + developers</p>
              <h2 className="mt-4 text-3xl font-semibold">Inspect the engineering decisions, not just the marketing page.</h2>
              <p className="mt-4 leading-7 text-slate-600">The repository demonstrates language implementation, Rust systems work, TypeScript product engineering, AWS/serverless infrastructure, IAM, testing, AI workflow design, safety boundaries, and technical product strategy.</p>
              <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="mt-7 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Open GitHub repository</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-10">
        <div className="mx-auto max-w-7xl px-5 text-sm text-slate-400 sm:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p>SolveLang · Early beta · Readable workflow language for AI-assisted business processes.</p>
            <div className="flex flex-wrap gap-5">
              <Link href="/resources/" className="hover:text-white">Docs</Link>
              <Link href="/status/" className="hover:text-white">Status</Link>
              <Link href="/terms/" className="hover:text-white">Terms</Link>
              <Link href="/refund-policy/" className="hover:text-white">Refund policy</Link>
              <Link href="/withdraw/" className="hover:text-white">Withdrawal</Link>
              <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a>
            </div>
          </div>
          <div className="mt-6 border-t border-white/10 pt-6">
            <a
              href="https://reclamatiisal.anpc.ro"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-3 hover:text-white"
            >
              <Image
                src="/anpc-sal-pictogram.png"
                alt="ANPC alternative dispute resolution"
                width={168}
                height={54}
                className="h-auto w-[140px] rounded bg-white p-1"
              />
              <span>Alternative dispute resolution information</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
