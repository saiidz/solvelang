export default function Page() {
  const features = [
    {
      title: "Readable workflow code",
      description:
        "Write automations in simple, readable syntax instead of stitching together brittle scripts.",
    },
    {
      title: "AI-native by design",
      description:
        "Define agents, instructions, and tool-enabled workflows in one place with a language built for AI operations.",
    },
    {
      title: "Built for real business tasks",
      description:
        "Support triage, lead routing, intake forms, content approvals, internal reporting, and API-powered workflows.",
    },
  ];

  const useCases = [
    "Triage support tickets and escalate urgent issues",
    "Qualify inbound leads and route them to sales",
    "Turn intake forms into tasks, CRM updates, and follow-ups",
    "Run content briefs, drafts, reviews, and approval workflows",
    "Connect APIs, files, prompts, and business rules in one script",
    "Generate internal reports, checklists, and ops workflows faster",
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
        "Early hosted workflow runner",
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
      subtitle: "Fastest path to revenue",
      items: [
        "Done-for-you automation setup",
        "Workflow design help",
        "Custom integrations",
        "Launch support",
      ],
      cta: "Book a Demo",
      featured: false,
    },
  ];

  const faqs = [
    {
      q: "What is SolveLang?",
      a: "SolveLang is a readable scripting language for AI automations, workflows, and business logic.",
    },
    {
      q: "Who is it for?",
      a: "Early-stage teams, founders, operators, and agencies who want faster ways to build AI-powered automations.",
    },
    {
      q: "Is this production-ready?",
      a: "Not yet. SolveLang is in early beta, which is why the best fit today is pilot projects, prototypes, and guided setups.",
    },
    {
      q: "How do I get started?",
      a: "Book a demo, join the beta waitlist, or start with a custom workflow setup tailored to your business.",
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
              Early beta • AI automation language • Built for business workflows
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
              Build AI automations in clear, readable code.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              SolveLang helps teams script workflows, agents, and business logic with simple readable syntax.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="#demo"
                className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:-translate-y-0.5"
              >
                Book a Demo
              </a>
              <a
                href="#pricing"
                className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium shadow-sm transition hover:-translate-y-0.5"
              >
                Try Hosted Runner
              </a>
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
  instruction "Summarize the ticket and route it to the right team."
  tool classifyTicket
  tool createTask
}

let priority = "high"
let channel = "email"

if priority == "high" {
  print("Escalate immediately")
}

ask SupportBot("Customer cannot access billing portal")`}
              </pre>
            </div>
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

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Why this matters</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Faster than building custom glue code for every workflow.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Instead of mixing prompts, API calls, and business rules across scattered scripts, SolveLang gives you one readable layer for AI-powered automations.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {useCases.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-medium">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Pricing</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Start with a pilot, then scale into a platform.
          </h2>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Early-stage pricing designed to help you land custom setups now and evolve into recurring SaaS revenue later.
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
                href="#demo"
                className={`mt-8 inline-flex rounded-2xl px-5 py-3 text-sm font-medium transition hover:-translate-y-0.5 ${
                  plan.featured
                    ? "bg-white text-slate-900"
                    : "border border-slate-300 bg-white text-slate-900"
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="border-y border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Early access</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Get a custom AI workflow built with SolveLang.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Start with a paid pilot. We’ll help define the workflow, script the automation, connect the tools, and get it working for your business.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="rounded-full border border-white/10 px-4 py-2">Support workflows</span>
              <span className="rounded-full border border-white/10 px-4 py-2">Lead routing</span>
              <span className="rounded-full border border-white/10 px-4 py-2">Ops automation</span>
              <span className="rounded-full border border-white/10 px-4 py-2">API integrations</span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
            <h3 className="text-xl font-semibold">Book a demo</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              This form is connected with Formspree for demo requests.
            </p>
            <form action="https://formspree.io/f/xjkabcde" method="POST" className="mt-8 space-y-4">
              <input
                type="text"
                placeholder="Your name"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-slate-500"
              />
              <input
                type="email"
                placeholder="Email address"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-slate-500"
              />
              <input
                type="text"
                placeholder="Company"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-slate-500"
              />
              <textarea
                placeholder="What workflow do you want to automate?"
                rows={5}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-slate-500"
              />
              <button
                type="button"
                className="w-full rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-900 transition hover:-translate-y-0.5"
              >
                Request demo
              </button>
            </form>
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

