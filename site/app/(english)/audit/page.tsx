import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../components/JsonLd";

export const metadata: Metadata = {
  title: "Workflow X-Ray Audit",
  description:
    "Send one messy workflow and get next steps for turning it into a readable SolveLang workflow map, draft, and automation path.",
};

const workflowAuditGmailUrl =
  "https://mail.google.com/mail/?view=cm&fs=1&to=hello@solve-lang.com&su=Workflow%20audit";

const whatToSend = [
  {
    question: "What workflow do you want automated?",
    example:
      "When a customer emails support, classify the issue and create the right follow-up task.",
  },
  {
    question: "What tools do you use today?",
    example:
      "Gmail, Slack, Notion, Airtable, Linear, HubSpot, Google Sheets, Trello, or similar tools.",
  },
  {
    question: "What starts the workflow?",
    example:
      "A new email, form submission, Slack message, new lead, customer request, or daily report.",
  },
  {
    question: "What decisions happen manually?",
    example:
      "Priority, category, owner, next step, escalation, or follow-up timing.",
  },
  {
    question: "What should happen automatically?",
    example:
      "Create a task, draft a reply, notify a channel, update a sheet, tag a lead, or summarize status.",
  },
  {
    question: "What output do you want?",
    example:
      "A readable workflow script, a task list, a routing map, or a simple implementation plan.",
  },
];

const goodFits = [
  "Support triage",
  "Lead qualification",
  "Intake-to-task routing",
  "Founder inbox cleanup",
  "Customer follow-up routing",
  "Internal ops status reports",
  "Manual spreadsheet-to-task workflows",
  "Repetitive handoff workflows between tools",
];

const notGoodFits = [
  "Large enterprise systems with complex approval chains",
  "Regulated workflows that require legal or compliance review",
  "Fully autonomous financial, medical, or legal decisions",
  "Anything requiring production access before the workflow is mapped",
];

const deliverables = [
  "A plain-English workflow map",
  "A readable SolveLang-style workflow draft",
  "A suggested automation path",
  "A list of tools and integrations needed",
  "A simple next-step recommendation",
  "An optional custom setup quote if it makes sense",
];

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
      name: "Workflow X-Ray Audit",
      item: "https://www.solve-lang.com/audit/",
    },
  ],
};

export default function AuditPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <JsonLd id="audit-breadcrumb-json-ld" data={auditBreadcrumbJsonLd} />
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-slate-200 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Workflow Audit Intake
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              Send us one messy workflow. We&apos;ll map the automation path.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">
              Tell us what your team handles manually today - support tickets,
              leads, intake, follow-ups, status updates, or internal routing -
              and we&apos;ll help turn it into a readable SolveLang workflow.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                href={workflowAuditGmailUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl bg-slate-900 px-6 py-3 text-center text-sm font-medium text-white shadow-lg transition hover:-translate-y-0.5"
              >
                Open Gmail draft
              </a>
              <Link
                href="/run/"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                Try Browser Preview
              </Link>
              <Link
                href="/demo/support-triage/"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                See support triage demo
              </Link>
            </div>
            <div className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
              <p>
                Or copy:{" "}
                <span className="select-all font-medium text-slate-800">
                  hello@solve-lang.com
                </span>
                .
              </p>
              <p>Mail links require a default email app. You can also copy the address.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              What to send
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Give us the raw process, not a polished spec.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              A useful audit starts with the real handoff: what arrives, who
              looks at it, what decisions they make, and what should happen next.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {whatToSend.map((item) => (
              <div
                key={item.question}
                className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold">{item.question}</h3>
                <p className="mt-3 leading-7 text-slate-600">Example: {item.example}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 py-20 lg:grid-cols-2 lg:px-8">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Good fit workflows
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              Practical founder/operator workflows
            </h2>
            <ul className="mt-8 grid gap-3 text-slate-700 sm:grid-cols-2">
              {goodFits.map((fit) => (
                <li key={fit} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-slate-900" />
                  <span>{fit}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Not a good fit yet
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              Early beta boundaries
            </h2>
            <ul className="mt-8 space-y-3 text-slate-700">
              {notGoodFits.map((fit) => (
                <li key={fit} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-slate-400" />
                  <span>{fit}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              What you&apos;ll get back
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              A clear next step before any paid build work.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Most first workflow audits start as a small fixed-scope setup or
              implementation plan. If the workflow is a fit, we&apos;ll suggest a
              clear next step before any paid work.
            </p>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Early custom setup is typically scoped per workflow.
            </p>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-sm">
            <ul className="space-y-4">
              {deliverables.map((deliverable) => (
                <li key={deliverable} className="flex gap-3 text-slate-700">
                  <span className="mt-2 h-2 w-2 rounded-full bg-slate-900" />
                  <span>{deliverable}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              Example email
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Start with a short, plain note.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Copy this structure and replace the bracketed parts with your real
              process. Rough notes are fine.
            </p>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl">
            <pre className="overflow-x-auto whitespace-pre-wrap p-6 text-sm leading-7 text-slate-100">
{`Subject: Workflow audit

Hi SolveLang,

I want to automate this workflow:

Every time [trigger happens], we currently [manual process].
The hardest part is [decision/routing/follow-up].
We use [tools].
The output I want is [task/email/summary/update].
Success would look like [result].

Thanks.`}
            </pre>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          Start with one workflow
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Send the workflow you want mapped.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          We&apos;ll reply with next steps for turning it into a readable
          SolveLang workflow.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={workflowAuditGmailUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:-translate-y-0.5"
          >
            Open Gmail draft
          </a>
          <Link
            href="/"
            className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
          >
            Back to homepage
          </Link>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-500">
          Or copy:{" "}
          <span className="select-all font-medium text-slate-800">hello@solve-lang.com</span>
        </p>
      </section>
    </main>
  );
}
