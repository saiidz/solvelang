import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { brandFacts } from "../../brandFacts";
import { JsonLd } from "../../components/JsonLd";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "What Is SolveLang? Maturity, Runtime, Studio, and Limitations",
  description:
    "SolveLang is an early-beta readable, explainable workflow language for AI-assisted business processes. Learn what works today, what is experimental, and what remains planned.",
  alternates: alternatesForRoute("about"),
};

const principles = [
  {
    title: "Readable before runnable",
    description:
      "A workflow should make sense to the people responsible for the operation before software executes it.",
  },
  {
    title: "Version controllable",
    description:
      "Workflow changes should be diffable, reviewable, attributable, and reversible like other source-controlled engineering work.",
  },
  {
    title: "AI boundaries stay explicit",
    description:
      "Deterministic rules, model-assisted judgment, tools, approvals, and failure paths should not be hidden behind one opaque automation step.",
  },
  {
    title: "Safety is a product feature",
    description:
      "Local validation, explicit capability boundaries, understandable failures, and human review matter before managed automation scales.",
  },
];

const aboutJsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${brandFacts.canonicalDomain}/about/#page`,
  url: `${brandFacts.canonicalDomain}/about/`,
  name: "About SolveLang",
  description: brandFacts.fullDescription,
  isPartOf: { "@id": `${brandFacts.canonicalDomain}/#website` },
  about: { "@id": `${brandFacts.canonicalDomain}/#software` },
  mainEntity: { "@id": `${brandFacts.canonicalDomain}/#software` },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <JsonLd id="about-page-json-ld" data={aboutJsonLd} />

      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="SolveLang home">
            <Image src="/solvelang-logo.svg" alt="SolveLang" width={194} height={41} />
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/resources/" className="hidden text-sm font-semibold text-slate-600 hover:text-slate-950 sm:block">
              Resources
            </Link>
            <Link href="/audit/" className="rounded-xl bg-[#146cff] px-4 py-2.5 text-sm font-semibold text-white">
              Map a workflow
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="bg-[#071426] text-white">
          <div className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">What is SolveLang?</p>
            <h1 className="mt-5 text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">
              A readable, explainable workflow language for AI-assisted business processes.
            </h1>
            <p className="mt-8 max-w-3xl text-xl leading-9 text-slate-300">
              SolveLang is an early-beta language and tooling project for making business rules, AI-assisted decisions, approvals, tools, ownership, and failure paths readable before they become managed automation.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Who it is for</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Workflow intent first.</h2>
            </div>
            <div className="space-y-6 text-lg leading-8 text-slate-600">
              <p>
                SolveLang is designed first for technical founders, hands-on operators, automation consultants, small agencies, and engineering teams that want workflow intent to remain understandable in source control.
              </p>
              <p>
                It focuses on the layer that should be explicit before automation runs: what starts the process, which facts matter, where judgment changes the path, who owns the next action, what can fail, and when a person must review the result.
              </p>
              <p>
                SolveLang is not another Zapier-style connector marketplace, a no-code mass-market automation builder, a production durable workflow engine, or a general-purpose autonomous AI workforce platform.
              </p>
            </div>
          </div>

          <div className="mt-20 grid gap-5 md:grid-cols-2">
            {principles.map((principle) => (
              <article key={principle.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm">
                <h3 className="text-2xl font-semibold tracking-tight">{principle.title}</h3>
                <p className="mt-4 leading-7 text-slate-600">{principle.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Current maturity</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Working today, experimental, and planned are different things.</h2>
              <p className="mt-6 text-lg leading-8 text-slate-600">
                The Rust CLI is the canonical runtime. Workflow Intelligence Studio performs local-first deterministic analysis. The browser preview is intentionally smaller than the Rust runtime. Hosted API, billing, provider, and side-effect capabilities must not be interpreted as production readiness simply because code exists.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              <article className="rounded-[1.75rem] border border-emerald-200 bg-emerald-50/40 p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Working today</p>
                <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
                  <li>Rust lexer, parser, AST runtime, interpreter, and CLI</li>
                  <li>Run, validate, token, and AST inspection commands</li>
                  <li>Source-located diagnostics and hardened execution modes</li>
                  <li>Local-first deterministic Workflow Intelligence Studio analysis</li>
                  <li>Browser-safe preview subset and public examples</li>
                </ul>
              </article>

              <article className="rounded-[1.75rem] border border-amber-200 bg-amber-50/50 p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Experimental / test-mode</p>
                <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
                  <li>HTTP, file, and environment helpers</li>
                  <li>AI-agent syntax and optional provider-backed responses</li>
                  <li>Studio-to-SolveLang draft generation</li>
                  <li>API keys, accounts, quotas, subscriptions, and billing infrastructure</li>
                </ul>
              </article>

              <article className="rounded-[1.75rem] border border-blue-200 bg-blue-50/50 p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Planned</p>
                <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
                  <li>Stable language specification</li>
                  <li>Production integrations and runtime adapters</li>
                  <li>Full managed workflow execution</li>
                  <li>Broader provider support</li>
                  <li>Enterprise durability, governance, and observability</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Use it today</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Start with reproducible evidence.</h2>
            </div>
            <div className="space-y-5 text-lg leading-8 text-slate-600">
              <p>Run the open-source Rust CLI, try the limited browser preview, inspect the public examples, or open Workflow Intelligence Studio for local deterministic analysis.</p>
              <p>The guided workflow-audit service can also map one real process into decisions, missing branches, human review points, ownership, and an implementation-ready workflow specification.</p>
              <div className="flex flex-col gap-3 pt-3 sm:flex-row">
                <a
                  href="https://github.com/saiidz/solvelang"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-slate-50"
                >
                  Explore GitHub
                </a>
                <Link href="/run/" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-slate-50">
                  Try browser preview
                </Link>
                <Link href="/audit/" className="rounded-xl bg-[#146cff] px-5 py-3 text-center text-sm font-semibold text-white">
                  Request workflow audit
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#07111f] px-5 py-10 text-sm text-slate-400 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 SolveLang</p>
          <div className="flex gap-4">
            <Link href="/status/" className="font-semibold text-white">Status</Link>
            <Link href="/support/" className="font-semibold text-white">Support</Link>
            <Link href="/" className="font-semibold text-white">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
