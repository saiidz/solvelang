"use client";

import { useMemo, useState } from "react";

const defaultMessage =
  "We were charged twice and need this fixed before renewal. Can someone from your team review today?";

function classify(message: string) {
  const text = message.toLowerCase();

  const topic = /bill|charge|invoice|refund|payment/.test(text)
    ? "billing"
    : /bug|error|broken|crash|issue/.test(text)
      ? "bug"
      : /onboard|setup|getting started|install/.test(text)
        ? "onboarding"
        : /account|login|password|sign in/.test(text)
          ? "account"
          : "general";

  const urgency = /urgent|today|asap|immediately|before renewal|blocked|down/.test(text)
    ? "urgent"
    : /soon|high priority|important/.test(text)
      ? "high"
      : "normal";

  const config = {
    billing: {
      owner: "finance_operations",
      queue: "billing",
      reply:
        "Thanks — we received your billing request and a finance specialist is reviewing it.",
    },
    bug: {
      owner: "product_support",
      queue: "bug_triage",
      reply:
        "Thanks — we received your report and are validating the issue now.",
    },
    onboarding: {
      owner: "customer_success",
      queue: "onboarding_help",
      reply:
        "Thanks — we received your onboarding question and will guide you through the next step.",
    },
    account: {
      owner: "account_support",
      queue: "account_help",
      reply:
        "Thanks — we received your account request and are checking the safest next step.",
    },
    general: {
      owner: "support_generalist",
      queue: "general_support",
      reply: "Thanks — we received your request and will reply shortly.",
    },
  } as const;

  const route = config[topic];
  const needsReview = urgency === "urgent" || topic === "account";

  return {
    topic,
    urgency,
    owner: route.owner,
    queue: route.queue,
    reply: route.reply,
    status: needsReview ? "needs-human-review" : "queued",
    actions: needsReview
      ? ["Create support task", "Escalate for human review", "Prepare reply draft"]
      : ["Create support task", "Queue for agent follow-up", "Prepare reply draft"],
  };
}

export default function AutomatedSupportTriageDemo() {
  const [message, setMessage] = useState(defaultMessage);
  const result = useMemo(() => classify(message), [message]);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <div className="max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Support Triage Demo
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              Support triage should run itself.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600 sm:text-xl">
              No Gmail draft. No copying an address. Type or paste a support message and the
              SolveLang agent continuously classifies it, routes it, drafts the reply, and
              chooses the next action automatically.
            </p>
            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Automation running
            </div>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Incoming support message
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    Analysis updates automatically as the message changes.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  live demo
                </span>
              </div>

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="mt-6 min-h-64 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-slate-500 focus:bg-white"
                aria-label="Support message"
              />
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Demo actions are simulated in-browser. No email is sent and no external system is changed.
              </p>
            </div>

            <div className="rounded-[2rem] border border-slate-900 bg-slate-950 p-6 text-white shadow-2xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Agent result
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">Triage complete</h2>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                  automatic
                </span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  ["Topic", result.topic],
                  ["Urgency", result.urgency],
                  ["Owner", result.owner],
                  ["Queue", result.queue],
                  ["Status", result.status],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {label}
                    </p>
                    <p className="mt-2 break-words font-medium text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Reply draft
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-100">{result.reply}</p>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Next actions
                </p>
                <ul className="mt-3 space-y-2 text-sm text-slate-100">
                  {result.actions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <span aria-hidden="true">→</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ["1", "Message arrives", "A connected inbox or support channel can feed the agent automatically."],
              ["2", "Agent triages", "Topic, urgency, owner, queue, reply, and next actions are generated immediately."],
              ["3", "Only risky actions pause", "Sensitive or urgent cases can require human approval before an external action."],
            ].map(([number, title, body]) => (
              <div key={number} className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Step {number}</p>
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
