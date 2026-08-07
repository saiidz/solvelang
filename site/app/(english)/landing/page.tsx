import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { JsonLd } from "../../components/JsonLd";
import { LanguageSelector } from "../../components/LanguageSelector";
import { defaultLocale } from "../../i18n/locales";

const workflowSteps = [
  {
    number: "01",
    title: "Map the real workflow",
    description:
      "Capture the trigger, systems, people, decisions, exceptions, and handoffs that actually run the operation.",
  },
  {
    number: "02",
    title: "Make every branch reviewable",
    description:
      "Turn hidden judgment calls into readable rules with explicit ownership, failure paths, approvals, and human review.",
  },
  {
    number: "03",
    title: "Automate with control",
    description:
      "Validate the workflow with the canonical Rust runtime, then implement it using the execution or integration layer that fits the job.",
  },
];

const useCases = [
  ["Support triage", "Working today", "Route urgent and billing cases with readable deterministic policy."],
  ["Lead qualification", "Working today", "Make fit, urgency, and follow-up rules visible before CRM automation."],
  ["Client intake", "Working today", "Model missing-information checks, ownership, and handoffs before implementation."],
  ["Invoice processing", "Working today + planned", "Model routing and checks today; extraction and accounting integrations remain implementation work."],
  ["Approval workflows", "Working today + planned", "Model approval policy today; durable approval execution remains planned."],
  ["Email summarization", "Experimental", "Use optional AI-assisted behavior with explicit review rather than silent business action."],
];

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

const faqs = [
  {
    q: "What is SolveLang?",
    a: "SolveLang is an early-beta readable, explainable workflow language designed for AI-assisted business processes. Its canonical runtime is a Rust CLI.",
  },
  {
    q: "Is SolveLang production ready?",
    a: "No. SolveLang is an early-beta project. The Rust CLI works locally, while hosted production execution and broader production integrations remain planned.",
  },
  {
    q: "What is Workflow Intelligence Studio?",
    a: "Workflow Intelligence Studio is a local-first workspace for modeling workflows, deterministic analysis, simulation, traces, versions, and evidence. Its analysis is deterministic, not AI analysis.",
  },
  {
    q: "Does the browser preview run the full SolveLang runtime?",
    a: "No. The browser preview intentionally supports a smaller safe subset. The Rust CLI remains the canonical validator and runtime.",
  },
  {
    q: "How is SolveLang different from automation builders?",
    a: "SolveLang focuses on making workflow intent, decisions, exceptions, ownership, human review, and failure paths readable before an execution platform or integration layer runs the process.",
  },
  {
    q: "Can SolveLang work with existing automation tools?",
    a: "Yes as a design and implementation layer. A SolveLang workflow can be used to clarify what should happen before implementing the final execution in an existing platform or custom service. Managed adapters are still roadmap work.",
  },
];

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <JsonLd id="homepage-faq-json-ld" data={faqJsonLd} />

      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="SolveLang home" className="shrink-0">
            <Image src="/solvelang-logo.svg" alt="SolveLang" width={210} height={44} className="h-auto w-[168px] sm:w-[194px]" priority />
          </Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex">
            <a href="#how-it-works" className="hover:text-slate-950">How it works</a>
            <a href="#use-cases" className="hover:text-slate-950">Use cases</a>
            <a href="#studio" className="hover:text-slate-950">Studio</a>
            <a href="#status" className="hover:text-slate-950">Status</a>
            <Link href="/resources/" className="hover:text-slate-950">Docs</Link>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Suspense fallback={<span className="w-12" aria-hidden="true" />}>
              <LanguageSelector current={defaultLocale} />
            </Suspense>
            <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:inline-flex">GitHub</a>
            <Link href="/studio/" className="rounded-xl bg-[#146cff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#075be4]">Open Studio</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero-grid relative isolate overflow-hidden bg-[#071426] text-white">
          <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute -right-40 bottom-0 h-[30rem] w-[30rem] rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl gap-16 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-32">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                <span className="h-2 w-2 rounded-full bg-blue-400" />
                Early beta · open source · honest maturity labels
              </div>
              <p className="mt-8 text-sm font-bold uppercase tracking-[0.22em] text-blue-300">See the system before you automate it.</p>
              <h1 className="mt-4 max-w-4xl text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                A readable, explainable workflow language for AI-assisted business processes.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                Make deterministic rules, AI-assisted decisions, approvals, tools, failure paths, and human review points understandable before a process becomes opaque automation.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/studio/" className="inline-flex items-center justify-center rounded-2xl bg-[#2477ff] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#1768f5]">Open Workflow Studio</Link>
                <Link href="/demo/support-triage/" className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10">View canonical demo</Link>
                <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-2xl border border-white/20 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10">Explore GitHub</a>
              </div>
              <p className="mt-6 max-w-2xl text-sm leading-6 text-slate-400">
                The Rust CLI is the canonical runtime. Studio analysis is deterministic. The browser preview supports a smaller safe subset. Managed production execution is planned, not available today.
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
              <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-blue-500/25 via-transparent to-cyan-300/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-[#0b1d33]/95 shadow-2xl shadow-black/35">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">support_triage.solve</span>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">canonical syntax</span>
                </div>
                <div className="grid lg:grid-cols-[1.04fr_0.96fr]">
                  <pre className="overflow-x-auto border-b border-white/10 p-6 font-mono text-[13px] leading-7 text-slate-200 lg:border-b-0 lg:border-r"><code>{`let ticket = {
  topic: "billing",
  priority: "urgent"
}

if ticket.priority == "urgent" {
  print("Action: escalate to founder today")
}

if ticket.topic == "billing" {
  print("Owner: finance operations")
}`}</code></pre>
                  <div className="space-y-4 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workflow X-Ray</p>
                    {[
                      ["Trigger", "Customer support ticket"],
                      ["Decision", "Urgent or normal priority?"],
                      ["Human review", "Escalate urgent cases"],
                      ["Owner", "Finance operations for billing"],
                    ].map(([label, value], index) => (
                      <div key={label} className="relative rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                        {index < 3 ? <span className="absolute -bottom-4 left-7 h-4 w-px bg-blue-400/45" /> : null}
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">{label}</p>
                        <p className="mt-1.5 text-sm font-medium text-slate-100">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm font-semibold text-slate-500">Designed around the operations teams repeat every day</p>
            <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-700">
              {["Support", "Client intake", "Lead routing", "Approvals", "Internal reporting"].map((item) => (
                <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2">{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">How it works</p>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Understand the workflow before choosing the execution layer.</h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">SolveLang starts with decisions, ownership, exceptions, and review points—not with a connector canvas.</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {workflowSteps.map((step) => (
              <article key={step.number} className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm">
                <span className="font-mono text-sm font-semibold text-blue-600">{step.number}</span>
                <h3 className="mt-8 text-2xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-4 leading-7 text-slate-600">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="use-cases" className="bg-[#0b1728] py-24 text-white sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">Operational use cases</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Show the business rule and the maturity boundary together.</h2>
              <p className="mt-6 text-lg leading-8 text-slate-300">Every example states what SolveLang can model today and where external implementation or experimental AI behavior begins.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {useCases.map(([title, label, body]) => (
                <article key={title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-7">
                  <span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-3 py-1 text-xs font-semibold text-blue-200">{label}</span>
                  <h3 className="mt-5 text-2xl font-semibold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-300">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="studio" className="bg-white py-24 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Workflow Intelligence Studio</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Explore the workflow before writing automation.</h2>
              <p className="mt-6 text-lg leading-8 text-slate-600">Studio is a local-first workspace for workflow modeling, deterministic analysis, simulation, traces, versions, quality analytics, and evidence. Its analysis is not AI-generated.</p>
              <ul className="mt-8 space-y-3 text-slate-700">
                <li>• Local-first workflow data and analytics</li>
                <li>• Deterministic checks and scenario simulation</li>
                <li>• Workflow graph, traces, versions, and evidence</li>
                <li>• Generated .solve drafts that still require canonical Rust validation</li>
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/studio/" className="rounded-xl bg-[#146cff] px-5 py-3 text-sm font-semibold text-white">Open Workflow Intelligence Studio</Link>
                <Link href="/run/" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-950">Try browser preview</Link>
              </div>
            </div>
            <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Local-first model</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[
                  ["Graph", "See triggers, rules, handoffs, and review points."],
                  ["Analysis", "Run deterministic checks across modeled workflow structure."],
                  ["Simulation", "Explore defined scenarios without pretending to execute production systems."],
                  ["Evidence", "Keep traces, versions, and Workflow X-Ray findings reviewable."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="architecture" className="border-y border-slate-200 bg-slate-100 py-24 text-slate-950">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Architecture</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">A language layer first, with derived experiences around it.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["1. Language", "Lexer, parser, AST, validation, diagnostics, and runtime semantics in Rust."],
                ["2. Local execution", "Trusted local runs plus hardened modes that deny sensitive capabilities."],
                ["3. Studio + preview", "Local-first deterministic workflow analysis and a smaller browser-safe runtime subset."],
                ["4. Future adapters", "External runtimes and managed execution remain evidence-led roadmap items."],
              ].map(([title, body]) => (
                <article key={title} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="status" className="bg-white py-24 text-slate-950">
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

        <section className="bg-[#071426] py-24 text-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-8 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">For teams</p>
              <h2 className="mt-4 text-3xl font-semibold">Need help making a workflow understandable?</h2>
              <p className="mt-4 leading-7 text-slate-300">The near-term business path is service-led: workflow clarity audits, prototype sprints, and implementation in the right execution stack for the client.</p>
              <a href="mailto:hello@solve-lang.com?subject=Workflow%20clarity%20audit" className="mt-7 inline-flex rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white">Discuss a workflow audit</a>
            </div>
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">For recruiters + developers</p>
              <h2 className="mt-4 text-3xl font-semibold">Inspect the engineering decisions, not just the marketing page.</h2>
              <p className="mt-4 leading-7 text-slate-300">The repository demonstrates language implementation, Rust systems work, TypeScript product engineering, AWS/serverless infrastructure, IAM, testing, AI workflow design, safety boundaries, and technical product strategy.</p>
              <a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="mt-7 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">Open GitHub repository</a>
            </div>
          </div>
        </section>

        <section id="faq" className="bg-white py-24 text-slate-950">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">FAQ</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">The important boundaries, answered directly.</h2>
            <div className="mt-10 divide-y divide-slate-200 rounded-[2rem] border border-slate-200 bg-white px-6 sm:px-8">
              {faqs.map((faq) => (
                <article key={faq.q} className="py-7">
                  <h3 className="text-xl font-semibold">{faq.q}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{faq.a}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-slate-950 py-10 text-white">
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
            <a href="https://reclamatiisal.anpc.ro" target="_blank" rel="noreferrer" className="inline-flex items-center gap-3 hover:text-white">
              <Image src="/anpc-sal-pictogram.png" alt="ANPC alternative dispute resolution" width={168} height={54} className="h-auto w-[140px] rounded bg-white p-1" />
              <span>Alternative dispute resolution information</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
