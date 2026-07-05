import Link from "next/link";

const workflowAuditGmailUrl =
  "https://mail.google.com/mail/?view=cm&fs=1&to=hello@solve-lang.com&su=Workflow%20audit";

export default function Page() {
  const features = [
    {
      title: "Readable workflow scripts",
      description:
        "Write the business rules, AI steps, and routing decisions in a script an operator can review.",
    },
    {
      title: "Built for founder-led ops",
      description:
        "Model support, intake, lead qualification, and reporting without turning every workflow into custom glue code.",
    },
    {
      title: "Early beta, clear boundaries",
      description:
        "Use the browser-safe preview and local runtime to shape pilots while full hosted runtime infrastructure comes later.",
    },
  ];

  const examples = [
    {
      title: "Support ticket triage",
      file: "support-triage.solve",
      useCase:
        "A founder or support lead can separate urgent billing issues from routine tickets before they become a backlog.",
      script: `let ticket_type = "billing"
let priority = "urgent"

print("Create support task")
print(ticket_type)

if priority == "urgent" {
  print("Escalate to founder")
}`,
    },
    {
      title: "Lead qualification",
      file: "lead-qualification.solve",
      useCase:
        "An operator can score inbound leads and route qualified accounts to a fast follow-up motion.",
      script: `let company_size = "midmarket"
let intent = "demo"

print("Review inbound lead")
print(company_size)

if intent == "demo" {
  print("Route to sales follow-up")
}`,
    },
    {
      title: "Intake-to-task routing",
      file: "intake-routing.solve",
      useCase:
        "Turn a customer, partner, or internal intake form into the next task without burying the rule in a spreadsheet.",
      script: `let request_area = "implementation"
let owner = "ops"

print("Create intake task")
print(request_area)

if owner == "ops" {
  print("Assign to operations queue")
}`,
    },
    {
      title: "Simple ops reporting",
      file: "ops-report.solve",
      useCase:
        "Summarize simple weekly status signals so a small team can see what needs attention first.",
      script: `let overdue_tasks = "yes"
let report_type = "weekly"

print("Prepare ops report")
print(report_type)

if overdue_tasks == "yes" {
  print("Flag blocked work")
}`,
    },
  ];

  const automations = [
    {
      title: "Support triage",
      description:
        "Classify incoming issues, flag urgent customers, and make the next owner obvious.",
    },
    {
      title: "Lead qualification",
      description:
        "Turn messy inbound interest into a readable fit, priority, and follow-up path.",
    },
    {
      title: "Client intake routing",
      description:
        "Convert intake forms, email notes, or kickoff details into the right operations task.",
    },
    {
      title: "Simple ops reporting",
      description:
        "Summarize weekly signals so founders can see blocked work, open loops, and next actions.",
    },
  ];

  const workflowSteps = [
    "Send us one messy process from support, sales, intake, or internal ops.",
    "We turn it into a readable SolveLang workflow your team can inspect.",
    "We validate the script against the current Rust CLI syntax before running it.",
    "We prepare the workflow for future integrations as the hosted runtime matures.",
  ];

  const whatToSend = [
    "The workflow you want automated",
    "The tools involved",
    "What happens manually today",
    "What a successful outcome looks like",
  ];

  const pricing = [
    {
      name: "Free",
      price: "$0",
      subtitle: "For local experimentation",
      items: [
        "Local CLI usage",
        "Basic examples",
        "Early language access",
        "Community updates",
      ],
      cta: "Start Free",
      featured: false,
    },
    {
      name: "Pro",
      price: "$29/mo",
      subtitle: "For solo builders and operators",
      items: [
        "Browser-safe workflow preview",
        "Hosted preview access",
        "Basic run output",
        "Integration examples coming soon",
      ],
      cta: "Join Beta",
      featured: true,
    },
    {
      name: "Custom Setup",
      price: "$500+",
      subtitle: "For one focused workflow audit",
      items: [
        "Custom AI workflow setup",
        "One messy process mapped",
        "Readable SolveLang draft",
        "Future integration plan",
      ],
      cta: "Book a workflow audit",
      featured: false,
    },
  ];

  const faqs = [
    {
      q: "What is SolveLang?",
      a: "SolveLang is an early beta language for readable AI workflow scripts that combine business rules, routing decisions, and AI-assisted steps.",
    },
    {
      q: "Who is it for?",
      a: "Right now, it is for founders, operators, and technical founders who want to make support, intake, lead routing, and internal ops easier to inspect. Agencies and consultants are a later go-to-market path.",
    },
    {
      q: "Is this production-ready?",
      a: "Not yet. SolveLang is in early beta, so the best fit today is local experimentation, browser-safe previews, pilot scripts, and guided setup conversations.",
    },
    {
      q: "How do I get started?",
      a: "Start with one messy workflow. Email the process or book a workflow audit, and we will shape it into a readable SolveLang script.",
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-slate-200 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm">
              Early beta • Founder/operator workflows • Browser-safe preview
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Readable AI workflow scripts for founder-led operations.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              Turn support, intake, lead qualification, and internal ops into readable AI workflows.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href={workflowAuditGmailUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:-translate-y-0.5"
              >
                Open Gmail draft
              </a>
              <Link
                href="/audit/"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium shadow-sm transition hover:-translate-y-0.5"
              >
                See what to send
              </Link>
              <a
                href="/run/"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium shadow-sm transition hover:-translate-y-0.5"
              >
                Try Browser Preview
              </a>
            </div>
            <div className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-500">
              <p>
                Or copy:{" "}
                <span className="select-all font-medium text-slate-800">hello@solve-lang.com</span>.
              </p>
              <p>Mail links require a default email app. You can also copy the address.</p>
            </div>
          </div>

          <div className="mx-auto mt-16 max-w-5xl">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 shadow-2xl">
              <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
                <div className="h-3 w-3 rounded-full bg-white/30" />
                <div className="h-3 w-3 rounded-full bg-white/20" />
                <div className="h-3 w-3 rounded-full bg-white/10" />
                <span className="ml-3 text-xs uppercase tracking-[0.2em] text-slate-400">support-routing.solve</span>
              </div>
              <pre className="overflow-x-auto p-6 text-sm leading-7 text-slate-100">
{`agent SupportBot {
  instruction "Classify support tickets and route urgent issues."
  tool createTask
}

let priority = "high"
let queue = "support"

if priority == "high" {
  print("Escalate billing portal issue")
}

ask SupportBot("Customer cannot access billing portal")`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Custom setup</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Custom AI workflow setup for founders/operators.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              SolveLang is early, so the first paid path is guided: bring one workflow that is stuck in email, spreadsheets, support notes, or founder memory, and turn it into a readable automation draft.
            </p>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Send one messy workflow. We’ll reply with next steps for turning it into a readable SolveLang workflow.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={workflowAuditGmailUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:-translate-y-0.5"
              >
                Open Gmail draft
              </a>
              <Link
                href="/audit/"
                className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                See what to send
              </Link>
              <a
                href="mailto:hello@solve-lang.com?subject=My%20workflow"
                className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                Email us your workflow
              </a>
            </div>
            <div className="mt-4 text-sm leading-6 text-slate-500">
              <p>
                Or copy:{" "}
                <span className="select-all font-medium text-slate-800">hello@solve-lang.com</span>.
              </p>
              <p>
                <Link className="font-medium text-slate-800 underline" href="/demo/support-triage/">
                  See support triage demo
                </Link>{" "}
                before sending your workflow.
              </p>
              <p>Mail links require a default email app. You can also copy the address.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {automations.map((automation) => (
              <div key={automation.title} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold">{automation.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{automation.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-xl font-semibold">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Start with one workflow</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Send one messy process. Get one readable workflow.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              The goal is not a big platform rollout. It is one practical workflow your team can understand, validate, and improve before deeper integrations exist.
            </p>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-sm">
            <ol className="space-y-5">
              {workflowSteps.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <span className="pt-1 leading-7 text-slate-700">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-base leading-7 text-slate-700">
              Send one messy workflow. We’ll reply with next steps for turning it into a readable SolveLang workflow.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={workflowAuditGmailUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl bg-slate-900 px-5 py-3 text-center text-sm font-medium text-white shadow-sm transition hover:-translate-y-0.5"
              >
                Open Gmail draft
              </a>
              <Link
                href="/audit/"
                className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                See what to send
              </Link>
              <a
                href="mailto:hello@solve-lang.com?subject=My%20workflow"
                className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-0.5"
              >
                Email us your workflow
              </a>
            </div>
            <div className="mt-4 text-sm leading-6 text-slate-500">
              <p>
                Or copy:{" "}
                <span className="select-all font-medium text-slate-800">hello@solve-lang.com</span>.
              </p>
              <p>Mail links require a default email app. You can also copy the address.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Practical examples</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Scripts for the workflows small teams repeat every week.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              SolveLang is meant to make the workflow readable first: what came in, how it should be classified, and what should happen next.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {examples.map((example) => (
              <div key={example.title} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{example.file}</p>
                  <h3 className="mt-3 text-xl font-semibold">{example.title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{example.useCase}</p>
                </div>
                <pre className="overflow-x-auto bg-slate-950 p-6 text-sm leading-7 text-slate-100">
{example.script}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Pricing</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Start with a readable pilot, then shape the runtime around real workflows.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Early beta options are designed for experimentation, browser-safe previews, and scoped workflow setup conversations.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {pricing.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-[2rem] border p-8 shadow-sm ${
                plan.featured
                  ? "border-slate-900 bg-slate-900 text-white shadow-xl"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">{plan.name}</h3>
                  <p className={`mt-2 text-sm ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>
                    {plan.subtitle}
                  </p>
                </div>
                {plan.featured && (
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200">
                    Best start
                  </span>
                )}
              </div>
              <p className="mt-8 text-4xl font-semibold">{plan.price}</p>
              <ul className="mt-8 space-y-4">
                {plan.items.map((item) => (
                  <li key={item} className={`flex items-start gap-3 ${plan.featured ? "text-slate-100" : "text-slate-700"}`}>
                    <span className="mt-2 h-2 w-2 rounded-full bg-current" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <a
                href={
                  plan.cta === "Book a workflow audit"
                    ? workflowAuditGmailUrl
                    : "#demo"
                }
                target={plan.cta === "Book a workflow audit" ? "_blank" : undefined}
                rel={plan.cta === "Book a workflow audit" ? "noreferrer" : undefined}
                className={`mt-8 inline-flex rounded-2xl px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5 ${
                  plan.featured
                    ? "bg-white text-slate-900"
                    : "border border-slate-300 bg-white text-slate-900"
                }`}
              >
                {plan.cta === "Book a workflow audit" ? "Open Gmail draft" : plan.cta}
              </a>
              {plan.cta === "Book a workflow audit" && (
                <div className="mt-4 text-sm leading-6 text-slate-500">
                  <p>
                    <Link className="font-medium text-slate-800 underline" href="/audit/">
                      See what to send
                    </Link>{" "}
                    before emailing your workflow.
                  </p>
                  <p>
                    Or copy:{" "}
                    <span className="select-all font-medium text-slate-800">hello@solve-lang.com</span>.
                  </p>
                  <p>Mail links require a default email app. You can also copy the address.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="border-y border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Early access</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Custom AI workflow setup for founders/operators.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Send one messy process. We will map the rules, write a readable SolveLang workflow, validate it, and prepare it for future integrations.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 px-4 py-2">Support triage</span>
              <span className="rounded-full border border-white/10 px-4 py-2">Lead qualification</span>
              <span className="rounded-full border border-white/10 px-4 py-2">Client intake routing</span>
              <span className="rounded-full border border-white/10 px-4 py-2">Simple ops reporting</span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
            <h3 className="text-xl font-semibold">Start with one workflow</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Send one messy workflow. We’ll reply with next steps for turning it into a readable SolveLang workflow.
            </p>
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-sm font-semibold text-white">What to send</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                {whatToSend.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 rounded-full bg-white" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 space-y-4">
              <a
                href={workflowAuditGmailUrl}
                target="_blank"
                rel="noreferrer"
                className="block rounded-2xl bg-white px-5 py-3 text-center text-sm font-medium text-slate-900 transition hover:-translate-y-0.5"
              >
                Open Gmail draft
              </a>
              <Link
                href="/audit/"
                className="block rounded-2xl border border-white/10 bg-black/20 px-5 py-3 text-center text-sm font-medium text-white transition hover:-translate-y-0.5"
              >
                See what to send
              </Link>
              <a
                href="mailto:hello@solve-lang.com?subject=My%20workflow"
                className="block rounded-2xl border border-white/10 bg-black/20 px-5 py-3 text-center text-sm font-medium text-white transition hover:-translate-y-0.5"
              >
                Email us your workflow
              </a>
            </div>
            <div className="mt-5 text-sm leading-6 text-slate-300">
              <p>
                Or copy:{" "}
                <span className="select-all font-medium text-white">hello@solve-lang.com</span>.
              </p>
              <p>Mail links require a default email app. You can also copy the address.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">FAQ</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Common questions from early users
          </h2>
        </div>
        <div className="mt-12 space-y-4">
          {faqs.map((faq) => (
            <div key={faq.q} className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-semibold">{faq.q}</h3>
              <p className="mt-3 leading-7 text-slate-600">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
