import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "../components/JsonLd";

const workflowAuditGmailUrl =
  "https://mail.google.com/mail/?view=cm&fs=1&to=hello@solve-lang.com&su=Workflow%20X-Ray";

const workflowSteps = [
  {
    number: "01",
    title: "Map the real workflow",
    description:
      "Capture the trigger, people, tools, decisions, exceptions, and handoffs that actually run the operation.",
  },
  {
    number: "02",
    title: "Make every branch reviewable",
    description:
      "Turn hidden judgment calls into readable logic with explicit human review and safe failure paths.",
  },
  {
    number: "03",
    title: "Automate with control",
    description:
      "Validate locally, test the workflow, and connect tools only after the operating model is clear.",
  },
];

const useCases = [
  {
    title: "Support triage",
    description:
      "Route urgent customers, billing issues, and routine requests without burying the rules in an inbox.",
    label: "Inbox → decision → owner",
  },
  {
    title: "Lead qualification",
    description:
      "Make fit, urgency, and follow-up rules visible before leads disappear into a spreadsheet or CRM queue.",
    label: "Form → score → next action",
  },
  {
    title: "Client intake",
    description:
      "Translate forms, emails, and kickoff notes into a consistent handoff with clear missing-information checks.",
    label: "Request → review → task",
  },
  {
    title: "Internal operations",
    description:
      "Document recurring approvals, escalations, and reporting workflows so the process does not live in one person’s head.",
    label: "Signal → branch → outcome",
  },
];

const faqs = [
  {
    q: "What is SolveLang?",
    a: "SolveLang is a workflow analysis and automation language for business operations. It turns messy processes into readable workflow blueprints that teams can review before software runs them.",
  },
  {
    q: "Is SolveLang a language-learning or homework solver?",
    a: "No. SolveLang is built for operational workflows such as support triage, client intake, lead routing, approvals, and internal reporting.",
  },
  {
    q: "Is it an AI agent framework?",
    a: "SolveLang is complementary to agent frameworks. It starts with the business decisions, missing branches, ownership, and human review points that should be clear before an agent or integration is deployed.",
  },
  {
    q: "What can I use today?",
    a: "The open-source Rust CLI, browser-safe preview, examples, and guided Workflow X-Ray service are available today. Managed hosted integrations are still evolving.",
  },
];

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <JsonLd id="homepage-faq-json-ld" data={faqJsonLd} />

      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="SolveLang home" className="shrink-0">
            <Image
              src="/solvelang-logo.svg"
              alt="SolveLang"
              width={210}
              height={44}
              className="h-auto w-[168px] sm:w-[194px]"
              priority
            />
          </Link>

          <div className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex">
            <a className="transition hover:text-slate-950" href="#product">
              Product
            </a>
            <a className="transition hover:text-slate-950" href="#workflow">
              How it works
            </a>
            <a className="transition hover:text-slate-950" href="#use-cases">
              Use cases
            </a>
            <a className="transition hover:text-slate-950" href="#pricing">
              Pricing
            </a>
            <Link className="transition hover:text-slate-950" href="/resources/">
              Resources
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="https://github.com/saiidz/solvelang"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex"
            >
              GitHub
            </a>
            <Link
              href="/studio/"
              className="rounded-xl bg-[#146cff] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#075be4]"
            >
              Open Studio
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero-grid relative isolate overflow-hidden bg-[#071426] text-white">
          <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute -right-40 bottom-0 h-[30rem] w-[30rem] rounded-full bg-cyan-400/10 blur-3xl" />

          <div className="relative mx-auto grid max-w-7xl gap-16 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-32">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">
                <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_16px_rgba(96,165,250,0.95)]" />
                Workflow intelligence for real operations
              </div>

              <h1 className="max-w-4xl text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
                See the system before you automate it.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                SolveLang turns messy support, intake, lead routing, and internal operations into readable workflows your team can inspect, challenge, and safely run.
              </p>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/studio/"
                  className="inline-flex items-center justify-center rounded-2xl bg-[#2477ff] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_50px_rgba(36,119,255,0.28)] transition hover:-translate-y-0.5 hover:bg-[#1768f5]"
                >
                  Open Workflow Studio
                  <span aria-hidden="true" className="ml-2">
                    →
                  </span>
                </Link>
                <Link
                  href="/demo/support-triage/"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10"
                >
                  See a workflow in action
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
                <span>Studio runs locally in your browser</span>
                <span>Human-review checkpoints</span>
                <span>Safe local validation</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
              <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-blue-500/25 via-transparent to-cyan-300/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-[#0b1d33]/95 shadow-2xl shadow-black/35">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    support-triage.solve
                  </span>
                </div>

                <div className="grid gap-0 lg:grid-cols-[1.06fr_0.94fr]">
                  <pre className="overflow-x-auto border-b border-white/10 p-6 font-mono text-[13px] leading-7 text-slate-200 lg:border-b-0 lg:border-r">
                    <code>{`input ticket from inbox

if ticket.topic == "billing" {
  mark priority = "high"
  require human_review
  assign owner = "finance"
}

else {
  route owner = "support"
}`}</code>
                  </pre>

                  <div className="space-y-4 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Workflow X-Ray
                    </p>
                    {[
                      ["Trigger", "New customer ticket"],
                      ["Decision", "Billing or routine support?"],
                      ["Review", "Human approval required"],
                      ["Owner", "Finance operations"],
                    ].map(([label, value], index) => (
                      <div
                        key={label}
                        className="relative rounded-2xl border border-white/10 bg-white/[0.045] p-4"
                      >
                        {index < 3 ? (
                          <span className="absolute -bottom-4 left-7 h-4 w-px bg-blue-400/45" />
                        ) : null}
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">
                          {label}
                        </p>
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
            <p className="text-sm font-semibold text-slate-500">
              Designed for the operations small teams repeat every day
            </p>
            <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-700">
              {[
                "Support",
                "Client intake",
                "Lead routing",
                "Approvals",
                "Internal reporting",
              ].map((item) => (
                <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">One readable system</p>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
              From undocumented process to automation-ready workflow.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Most automation tools begin with apps and actions. SolveLang begins with the decisions, ownership, exceptions, and review points that determine whether the workflow is safe and useful.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {workflowSteps.map((step) => (
              <article
                key={step.number}
                className="group rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-950/5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-blue-600">{step.number}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                    →
                  </span>
                </div>
                <h3 className="mt-10 text-2xl font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-4 leading-7 text-slate-600">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="bg-[#0b1728] py-24 text-white sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">Readable by design</p>
              <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                The workflow stays understandable after the demo.
              </h2>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                Every rule is visible. Every handoff has an owner. Every risky branch can require human review. The result is a workflow operators can challenge and developers can implement.
              </p>

              <div className="mt-9 space-y-4">
                {[
                  "Source-located validation errors",
                  "Safe mode for local execution",
                  "Explicit file, environment, and network boundaries",
                  "Readable scripts that live in version control",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 text-slate-200">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs text-blue-300">
                      ✓
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                <a
                  href="https://github.com/saiidz/solvelang"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5"
                >
                  View the open-source runtime
                </a>
                <Link
                  href="/resources/"
                  className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Read the resources
                </Link>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-[#08111f] p-4 shadow-2xl shadow-black/30 sm:p-6">
              <div className="rounded-[1.4rem] border border-white/10 bg-[#0f2138] p-5 sm:p-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Current process</p>
                    <p className="mt-2 text-lg font-semibold">Support escalation</p>
                  </div>
                  <span className="w-fit rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
                    3 hidden decisions found
                  </span>
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {[
                    ["01", "Ticket arrives", "Email inbox"],
                    ["02", "Classify request", "Decision owner missing"],
                    ["03", "Check customer impact", "Human review"],
                    ["04", "Assign next action", "Named owner + deadline"],
                  ].map(([number, title, note]) => (
                    <div key={number} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <span className="font-mono text-xs text-blue-300">{number}</span>
                      <p className="mt-5 font-semibold">{title}</p>
                      <p className="mt-2 text-sm text-slate-400">{note}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4 text-sm leading-6 text-blue-100">
                  Recommended guardrail: require a person to approve high-impact billing escalations before any automated action runs.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="use-cases" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Use cases</p>
              <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                Make the next decision obvious.
              </h2>
            </div>
            <p className="max-w-xl text-lg leading-8 text-slate-600">
              SolveLang is for workflows where people are constantly interpreting context, choosing a path, and handing work to someone else.
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {useCases.map((useCase) => (
              <article key={useCase.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm">
                <span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 font-mono text-xs font-semibold text-blue-700">
                  {useCase.label}
                </span>
                <h3 className="mt-7 text-2xl font-semibold tracking-tight">{useCase.title}</h3>
                <p className="mt-3 max-w-xl leading-7 text-slate-600">{useCase.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white py-24 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">What SolveLang is</p>
              <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                Workflow analysis first. Automation second.
              </h2>
            </div>
            <div className="space-y-6 text-lg leading-8 text-slate-600">
              <p>
                SolveLang is a workflow analysis and automation language for business operations. It is not a language-learning app, a homework solver, or a replacement for every AI framework.
              </p>
              <p>
                Agent frameworks help developers build model-driven systems. SolveLang focuses on the operational layer around those systems: the trigger, business rules, exceptions, ownership, human review, and safe next action.
              </p>
              <Link href="/about/" className="inline-flex items-center font-semibold text-blue-700 hover:text-blue-800">
                Learn what makes SolveLang different
                <span aria-hidden="true" className="ml-2">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Start where you are</p>
            <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
              Use the runtime or bring us the mess.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              There is no pretend enterprise platform here. Start free with the local CLI, or get one real workflow mapped end to end.
            </p>
          </div>

          <div className="mx-auto mt-14 grid max-w-5xl gap-5 lg:grid-cols-2">
            <article className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Open source</p>
              <h3 className="mt-4 text-3xl font-semibold">Local CLI</h3>
              <p className="mt-4 text-4xl font-semibold tracking-tight">$0</p>
              <p className="mt-5 leading-7 text-slate-600">
                Explore the language, validate workflows, run examples, and inspect the Rust runtime locally.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-slate-700">
                <li>✓ Rust CLI and examples</li>
                <li>✓ Safe local execution mode</li>
                <li>✓ Browser-safe preview</li>
                <li>✓ Public documentation</li>
              </ul>
              <a
                href="https://github.com/saiidz/solvelang"
                target="_blank"
                rel="noreferrer"
                className="mt-9 inline-flex w-full justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold transition hover:bg-slate-50"
              >
                Open GitHub
              </a>
            </article>

            <article className="rounded-[2rem] border border-blue-500 bg-[#071426] p-8 text-white shadow-2xl shadow-blue-950/15">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-300">Done with you</p>
              <h3 className="mt-4 text-3xl font-semibold">Workflow X-Ray</h3>
              <p className="mt-4 text-4xl font-semibold tracking-tight">From $350</p>
              <p className="mt-5 leading-7 text-slate-300">
                Bring one messy process. Get the current-state map, hidden decisions, missing branches, review points, and a readable SolveLang draft.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-slate-200">
                <li>✓ Current workflow map</li>
                <li>✓ Decision and exception analysis</li>
                <li>✓ Human-review checkpoints</li>
                <li>✓ Automation-ready workflow draft</li>
              </ul>
              <Link
                href="/audit/"
                className="mt-9 inline-flex w-full justify-center rounded-xl bg-[#2477ff] px-5 py-3 text-sm font-semibold transition hover:bg-[#1768f5]"
              >
                Start a Workflow X-Ray
              </Link>
            </article>
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8 sm:pb-28">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.25rem] bg-[#146cff] px-6 py-16 text-white shadow-2xl shadow-blue-900/20 sm:px-12 lg:px-16">
            <div className="absolute -right-20 -top-32 h-80 w-80 rounded-full border-[45px] border-white/10" />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="max-w-3xl">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-100">Before you automate it</p>
                <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                  Put the workflow where everyone can see it.
                </h2>
                <p className="mt-5 text-lg leading-8 text-blue-50">
                  Send one process that is stuck in email, spreadsheets, support notes, or founder memory. We will turn it into a readable system.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link
                  href="/audit/"
                  className="inline-flex justify-center rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-blue-700 transition hover:-translate-y-0.5"
                >
                  Send a workflow
                </Link>
                <a
                  href={workflowAuditGmailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex justify-center rounded-xl border border-white/25 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Open Gmail draft
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white py-24 sm:py-28">
          <div className="mx-auto max-w-4xl px-5 sm:px-8">
            <div className="text-center">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">FAQ</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Clear answers, no category confusion.</h2>
            </div>
            <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map((faq) => (
                <article key={faq.q} className="py-7">
                  <h3 className="text-lg font-semibold">{faq.q}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{faq.a}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#07111f] text-slate-300">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
          <div className="flex flex-col gap-10 border-b border-white/10 pb-10 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-sm">
              <Image
                src="/solvelang-logo.svg"
                alt="SolveLang"
                width={190}
                height={40}
                className="brightness-0 invert"
              />
              <p className="mt-5 text-sm leading-6 text-slate-400">
                Readable workflow analysis and automation for founder-led operations.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-4">
              <div className="space-y-3">
                <p className="font-semibold text-white">Product</p>
                <Link className="block hover:text-white" href="/run/">Browser preview</Link>
                <Link className="block hover:text-white" href="/demo/support-triage/">Workflow demo</Link>
              </div>
              <div className="space-y-3">
                <p className="font-semibold text-white">Company</p>
                <Link className="block hover:text-white" href="/about/">About</Link>
                <Link className="block hover:text-white" href="/pricing/">Pricing</Link>
              </div>
              <div className="space-y-3">
                <p className="font-semibold text-white">Resources</p>
                <Link className="block hover:text-white" href="/resources/">Guides</Link>
                <a className="block hover:text-white" href="https://github.com/saiidz/solvelang">GitHub</a>
              </div>
              <div className="space-y-3">
                <p className="font-semibold text-white">Contact</p>
                <a className="block hover:text-white" href="mailto:hello@solve-lang.com">hello@solve-lang.com</a>
                <Link className="block hover:text-white" href="/audit/">Workflow X-Ray</Link>
                <Link className="block hover:text-white" href="/terms/">Terms of Use</Link>
                <Link className="block hover:text-white" href="/refund-policy/">Refund Policy</Link>
                <Link className="block hover:text-white" href="/withdraw/">Withdrawal request</Link>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-5 pt-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 SolveLang. Before you automate it, understand it.</p>
            <a href="https://reclamatiisal.anpc.ro" className="block w-[250px]" aria-label="ANPC solutionarea alternativa a litigiilor">
              <Image src="/anpc-sal-pictogram.png" alt="ANPC solutionarea alternativa a litigiilor" width={250} height={50} className="h-[50px] w-[250px]" />
            </a>
            <p>Open-source runtime. Guided workflow analysis.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
