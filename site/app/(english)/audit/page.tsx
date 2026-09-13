import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../components/JsonLd";
import { WorkflowAuditAgent } from "./WorkflowAuditAgent";

export const metadata: Metadata = {
  title: "Workflow Audit Agent",
  description:
    "Describe one messy workflow and let SolveLang map the trigger, decisions, automation path, safety gates, and readable workflow draft instantly in your browser.",
};

const auditBreadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://www.solve-lang.com/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Workflow Audit Agent",
      item: "https://www.solve-lang.com/audit/",
    },
  ],
};

const outcomes = [
  ["Trigger map", "What starts the workflow and what context arrives with it."],
  ["Decision map", "Which judgments are still manual: priority, routing, ownership, escalation, or follow-up."],
  ["Automation plan", "Which steps can run automatically and which should stay approval-gated."],
  ["Tool map", "The systems already involved so the workflow can be connected without inventing a new process."],
  ["Readable draft", "A SolveLang-style workflow draft that operators can inspect before live integrations are connected."],
  ["Safety boundary", "A clear split between automatic actions and sensitive actions that require review."],
];

const examples = [
  {
    title: "Support triage",
    text: "Classify incoming requests, assign an owner, draft a reply, create the task, and escalate only risky cases.",
  },
  {
    title: "Lead routing",
    text: "Inspect a new lead, score fit, route it to the right owner, update the CRM, and prepare the next message.",
  },
  {
    title: "Founder inbox",
    text: "Separate noise from action, summarize the important thread, create follow-ups, and surface only decisions that need you.",
  },
  {
    title: "Ops handoffs",
    text: "Turn recurring spreadsheet, Slack, and task-tool handoffs into explicit rules with visible ownership and next steps.",
  },
];

const guardrails = [
  "No email is required to run the audit.",
  "No production account is connected by the page.",
  "No external message, task, or mutation is executed from the preview.",
  "Sensitive financial, account, security, legal, and medical actions remain approval-gated.",
];

export default function AuditPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <JsonLd id="audit-breadcrumb-json-ld" data={auditBreadcrumbJsonLd} />

      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(148,163,184,0.16),transparent_30%)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <div className="max-w-5xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Workflow Audit Agent
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
              Stop emailing us your workflow. Let the agent map it now.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300 sm:text-xl">
              Paste the messy process directly into SolveLang. The page identifies the trigger, decisions, tools, automation path, and safety gates immediately — without opening Gmail, copying an address, or waiting for a manual reply.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a
                href="#audit-agent"
                className="rounded-2xl bg-white px-6 py-3 text-center text-sm font-semibold text-slate-950 shadow-xl transition hover:-translate-y-0.5"
              >
                Audit my workflow now
              </a>
              <Link
                href="/demo/support-triage/"
                className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-center text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10"
              >
                See automated support triage
              </Link>
              <Link
                href="/run/"
                className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-center text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10"
              >
                Open Browser Preview
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
        <WorkflowAuditAgent />
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">What the agent gives you</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
              A useful automation map before anything touches production.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              The point of the audit is not to make you write a perfect specification. It is to convert the raw process you already understand into something explicit enough to automate safely.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {outcomes.map(([title, text], index) => (
              <div key={title} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">0{index + 1}</p>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Use cases</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Start with work that already feels repetitive.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              SolveLang is strongest when people already know the desired outcome but the process is trapped in inboxes, chats, spreadsheets, and repeated judgment calls.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {examples.map((item) => (
              <div key={item.title} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Automation, not recklessness</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                The agent should remove manual work without hiding the safety boundary.
              </h2>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                Routine classification, drafting, routing, and task planning can be automated. Sensitive decisions stay visible and approval-gated until a production integration is intentionally configured.
              </p>
            </div>
            <div className="grid gap-3">
              {guardrails.map((item) => (
                <div key={item} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-300">✓</span>
                  <p className="leading-7 text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">No inbox required</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
          Put the workflow into the agent, not into an email draft.
        </h2>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-600">
          The audit is now the product experience itself: describe the process, inspect the map, refine the rules, and move to live integrations only when you are ready.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="#audit-agent" className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5">
            Run the audit
          </a>
          <Link href="/" className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5">
            Back to homepage
          </Link>
        </div>
      </section>
    </main>
  );
}
