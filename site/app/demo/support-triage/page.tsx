import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support Triage Demo | SolveLang",
  description:
    "See how SolveLang maps a messy support inbox into ownership, priority, reply drafts, and next steps.",
};

const workflowAuditGmailUrl =
  "https://mail.google.com/mail/?view=cm&fs=1&to=hello@solve-lang.com&su=Workflow%20audit";

const beforeItems = [
  "Shared inbox",
  "Manual triage",
  "Slack scrambling",
  "Unclear ownership",
  "Customers waiting",
];

const afterItems = [
  "Classified topic",
  "Priority selected",
  "Owner assigned",
  "Reply drafted",
  "Task or alert created",
  "Human review preserved",
];

const workflowSteps = [
  "Customer email arrives",
  "Extract subject/body",
  "Classify topic",
  "Estimate urgency",
  "Assign owner",
  "Draft reply",
  "Create task",
  "Alert if urgent",
  "Human review",
];

const outputs = [
  ["Customer", "acme-labs.com"],
  ["Topic", "billing"],
  ["Urgency", "urgent"],
  ["Owner", "finance_operations"],
  ["Queue", "billing"],
  ["Status", "needs-human-review"],
  [
    "Reply draft",
    "Thanks — we received your billing request and a finance specialist is reviewing it.",
  ],
  ["Slack alert", "#support-escalations"],
  ["Task", "created in billing_queue"],
];

const riskItems = [
  {
    title: "Unclear ownership",
    body: "Support requests stop bouncing between people because the owner rule is written down.",
  },
  {
    title: "Manual triage",
    body: "The first read becomes a structured decision instead of a repeated judgment call.",
  },
  {
    title: "Duplicated reading",
    body: "Everyone can see why the request was routed instead of re-reading the whole thread.",
  },
  {
    title: "Missed follow-ups",
    body: "The workflow names the next task, queue, and review point before the customer waits too long.",
  },
  {
    title: "Human review for risky cases",
    body: "Urgent or sensitive cases are flagged for a person instead of being treated as fully automatic.",
  },
];

const supportTriageScript = `workflow "support_triage_demo"

on email.received
  where inbox == "support@acme.com"

extract
  customer_email
  subject
  body
  received_at

classify topic using ["billing", "bug", "onboarding", "account", "general"]
classify urgency using ["normal", "high", "urgent"]

when topic == "billing"
  set owner = "finance_operations"
  set queue = "billing"
  draft reply = "Thanks — we received your billing request and a finance specialist is reviewing it."
  create task in "billing_queue"

when topic == "bug"
  set owner = "product_support"
  set queue = "bug_triage"
  draft reply = "Thanks — we received your report and are validating the issue now."
  create task in "bug_queue"

when topic == "onboarding"
  set owner = "customer_success"
  set queue = "onboarding_help"
  draft reply = "Thanks — we received your onboarding question and will guide you through the next step."
  create task in "success_queue"

otherwise
  set owner = "support_generalist"
  set queue = "general_support"
  draft reply = "Thanks — we received your request and will reply shortly."
  create task in "support_queue"

when urgency == "urgent"
  notify slack "#support-escalations"
  mark status = "needs-human-review"

otherwise
  mark status = "queued"

output
  customer_email
  topic
  urgency
  owner
  queue
  status
  reply`;

function EmailFallback({ tone = "light" }: { tone?: "light" | "dark" }) {
  const textColor = tone === "dark" ? "text-slate-300" : "text-slate-500";
  const strongColor = tone === "dark" ? "text-white" : "text-slate-800";

  return (
    <p className={`text-sm leading-6 ${textColor}`}>
      Or copy:{" "}
      <span className={`select-all font-medium ${strongColor}`}>
        hello@solve-lang.com
      </span>
    </p>
  );
}

export default function SupportTriageDemoPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-slate-200 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Support Triage Demo
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              Turn a messy support inbox into a readable workflow.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600 sm:text-xl">
              See how SolveLang maps incoming support emails into clear
              ownership, priority, reply drafts, and next steps &mdash; before
              you wire up production automation.
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
            </div>
            <div className="mt-4">
              <EmailFallback />
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Incoming Support Email
              </p>
              <h2 className="mt-3 text-xl font-semibold">
                Urgent billing issue
              </h2>
            </div>
            <div className="space-y-4 p-6 text-sm leading-7 text-slate-700">
              <p>
                <span className="font-semibold text-slate-900">From:</span>{" "}
                ops@acme-labs.com
              </p>
              <p>
                We were charged twice and need this fixed before renewal. Can
                someone from your team review today?
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {outputs.slice(1, 6).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {label}
                    </p>
                    <p className="mt-2 font-medium text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Before
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              Support work depends on memory and interruption.
            </h2>
            <ul className="mt-8 space-y-4">
              {beforeItems.map((item) => (
                <li key={item} className="flex gap-3 text-slate-700">
                  <span className="mt-2 h-2 w-2 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[2rem] border border-slate-900 bg-slate-950 p-8 text-white shadow-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
              After
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              The rules are visible before anything runs unattended.
            </h2>
            <ul className="mt-8 space-y-4">
              {afterItems.map((item) => (
                <li key={item} className="flex gap-3 text-slate-100">
                  <span className="mt-2 h-2 w-2 rounded-full bg-white" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Workflow Map
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              The support triage path becomes inspectable.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Each step can be discussed with the operator who owns the process
              before the workflow is connected to live tools.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <div
                key={step}
                className="relative rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Step {index + 1}
                </p>
                <h3 className="mt-3 text-lg font-semibold">{step}</h3>
                {index < workflowSteps.length - 1 && (
                  <p className="mt-4 text-sm font-medium text-slate-400">
                    Next &rarr;
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            SolveLang-Style Script
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            A workflow draft operators can read.
          </h2>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            This is a readable workflow draft, not a claim that every
            integration is wired today. The point is to make the trigger,
            routing rules, outputs, and human review point explicit first.
          </p>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
            <div className="h-3 w-3 rounded-full bg-white/30" />
            <div className="h-3 w-3 rounded-full bg-white/20" />
            <div className="h-3 w-3 rounded-full bg-white/10" />
            <span className="ml-3 text-xs uppercase tracking-[0.2em] text-slate-400">
              support_triage.solve
            </span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap p-6 text-sm leading-7 text-slate-100">
            {supportTriageScript}
          </pre>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Example Outputs
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              The result is clear enough to review.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {outputs.map(([label, value]) => (
              <div
                key={label}
                className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {label}
                </p>
                <p className="mt-3 break-words text-lg font-semibold text-slate-900">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Why This Matters
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Rules should not live only in someone&apos;s head.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Most teams already have these rules in someone&apos;s head.
              SolveLang makes the workflow explicit before implementation.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {riskItems.map((item) => (
              <div
                key={item.title}
                className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            Workflow Audit
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Want this for one of your workflows?
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Send one messy process. We&apos;ll map the trigger, decisions,
            outputs, human review points, and automation path.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={workflowAuditGmailUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl bg-white px-6 py-3 text-center text-sm font-medium text-slate-900 shadow-lg transition hover:-translate-y-0.5"
            >
              Open Gmail draft
            </a>
            <Link
              href="/audit/"
              className="rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:-translate-y-0.5"
            >
              See what to send
            </Link>
          </div>
          <div className="mt-5">
            <EmailFallback tone="dark" />
          </div>
        </div>
      </section>
    </main>
  );
}
