import type { Metadata } from 'next';
import Image from "next/image";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "What Is SolveLang?",
  description:
    "SolveLang is a workflow analysis and automation language for business operations. Learn how it maps decisions, exceptions, ownership, and human review before automation.",
  alternates: alternatesForRoute("about"),
};

const principles = [
  {
    title: "Readable before runnable",
    description:
      "A workflow should make sense to the people responsible for the operation before software executes it.",
  },
  {
    title: "Decisions over connectors",
    description:
      "The important part is not merely which apps connect. It is why the workflow takes one path instead of another.",
  },
  {
    title: "Humans stay visible",
    description:
      "Review, approval, escalation, and ownership are part of the workflow rather than exceptions hidden outside it.",
  },
  {
    title: "Safety is a product feature",
    description:
      "Local validation, explicit boundaries, and understandable failure paths matter before hosted automation scales.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
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
              A readable operating layer for workflows that involve judgment.
            </h1>
            <p className="mt-8 max-w-3xl text-xl leading-9 text-slate-300">
              SolveLang is a workflow analysis and automation language for support, intake, lead routing, approvals, and internal operations. It makes the decisions around automation visible before any agent, integration, or script acts.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">The category</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Workflow analysis first.</h2>
            </div>
            <div className="space-y-6 text-lg leading-8 text-slate-600">
              <p>
                SolveLang is not a language-learning service, homework solver, chatbot directory, or general-purpose AI agent framework.
              </p>
              <p>
                It focuses on the operational model that comes before automation: what starts the process, which facts matter, where judgment changes the path, who owns the next action, what can fail, and when a person must review the result.
              </p>
              <p>
                The output can be a Workflow X-Ray, a readable SolveLang script, a local CLI-validated workflow, or a blueprint for a later integration.
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
          <div className="mx-auto grid max-w-5xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Available today</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Built in the open, grounded in real workflows.</h2>
            </div>
            <div className="space-y-5 text-lg leading-8 text-slate-600">
              <p>The Rust CLI, language examples, safe local execution, browser preview, and documentation are open source.</p>
              <p>The guided Workflow X-Ray service maps one real process into decisions, missing branches, human review points, ownership, and a readable workflow draft.</p>
              <div className="flex flex-col gap-3 pt-3 sm:flex-row">
                <a
                  href="https://github.com/saiidz/solvelang"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-slate-50"
                >
                  Explore GitHub
                </a>
                <Link href="/audit/" className="rounded-xl bg-[#146cff] px-5 py-3 text-center text-sm font-semibold text-white">
                  Start a Workflow X-Ray
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#07111f] px-5 py-10 text-sm text-slate-400 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 SolveLang</p>
          <Link href="/" className="font-semibold text-white">Return home</Link>
        </div>
      </footer>
    </div>
  );
}
