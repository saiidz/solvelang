import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Pricing",
  description: "Compare SolveLang Developer, Pro, and Business API credit plans and paid processing priority.",
};

const plans = [
  {
    name: "Developer",
    key: "developer",
    price: "$49",
    description: "For prototypes, internal tools, and early repository-audit integrations.",
    credits: "1,000",
    keys: "2",
    highlighted: false,
  },
  {
    name: "Pro",
    key: "pro",
    price: "$199",
    description: "For production applications that need dependable monthly capacity.",
    credits: "10,000",
    keys: "3",
    highlighted: true,
  },
  {
    name: "Business",
    key: "business",
    price: "$699",
    description: "For teams running higher-volume audits across multiple services.",
    credits: "50,000",
    keys: "5",
    highlighted: false,
  },
] as const;

const priorities = [
  { name: "Standard", multiplier: "1×", description: "Normal queue processing." },
  { name: "Express", multiplier: "2×", description: "Higher queue priority; consumes twice the credits." },
  { name: "Priority", multiplier: "5×", description: "Reserved for time-sensitive production work." },
  { name: "Critical", multiplier: "10×", description: "Highest available queue weight; best-effort, not a fixed-time SLA." },
] as const;

export default function ApiPricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
      <div className="mx-auto max-w-6xl">
        <nav className="flex items-center justify-between">
          <Link href="/" className="font-bold tracking-tight">SolveLang</Link>
          <Link href="/account/api-keys/" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/5">API account</Link>
        </nav>

        <header className="mx-auto max-w-3xl py-20 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">SolveLang API</p>
          <h1 className="mt-5 text-5xl font-bold tracking-tight md:text-7xl">Pay for work, not an uncapped AI request.</h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">One SolveLang credit covers up to 5,000 input tokens and 1,000 output tokens. Larger jobs and faster processing consume more credits, keeping pricing predictable for both customers and the platform.</p>
        </header>

        <section className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.key} className={plan.highlighted ? "rounded-3xl border-2 border-cyan-300 bg-cyan-300/5 p-7 shadow-2xl shadow-cyan-950/30" : "rounded-3xl border border-white/10 bg-white/5 p-7"}>
              {plan.highlighted ? <p className="inline-flex rounded-full bg-cyan-300 px-3 py-1 text-xs font-bold text-slate-950">Recommended</p> : null}
              <h2 className="mt-5 text-3xl font-bold">{plan.name}</h2>
              <p className="mt-3 min-h-20 text-sm leading-6 text-slate-300">{plan.description}</p>
              <p className="mt-6 text-4xl font-bold">{plan.price}<span className="text-base font-medium text-slate-400">/month</span></p>
              <div className="mt-6 border-y border-white/10 py-6">
                <p className="text-4xl font-bold">{plan.credits}</p>
                <p className="mt-1 text-sm text-slate-400">weighted credits each month</p>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-slate-200">
                <li>✓ {plan.keys} active API keys</li>
                <li>✓ 5,000 input + 1,000 output tokens per base credit</li>
                <li>✓ Repository audit scope</li>
                <li>✓ Hard monthly credit limit</li>
                <li>✓ One-time secret reveal and instant revocation</li>
              </ul>
              <Link href={`/account/api-keys/?plan=${plan.key}`} className={plan.highlighted ? "mt-8 block rounded-xl bg-cyan-300 px-5 py-3 text-center font-bold text-slate-950 hover:bg-cyan-200" : "mt-8 block rounded-xl border border-white/20 px-5 py-3 text-center font-bold hover:bg-white/5"}>Choose {plan.name}</Link>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-3xl border border-fuchsia-300/20 bg-fuchsia-300/5 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-200">Paid processing priority</p>
          <h2 className="mt-3 text-3xl font-bold">Use more credits when time matters.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {priorities.map((priority) => (
              <article key={priority.name} className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
                <p className="text-3xl font-bold text-fuchsia-200">{priority.multiplier}</p>
                <h3 className="mt-2 font-bold">{priority.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{priority.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-8">
          <h2 className="text-2xl font-bold">Credit controls</h2>
          <p className="mt-3 max-w-4xl text-slate-300">Every authenticated request consumes at least one credit. Workloads are charged from the larger of their input-token or output-token bands, then multiplied by the selected processing priority. Recurring billing remains disabled until test Prices, SES, the signed webhook, and the protected AWS deployment pass launch review.</p>
        </section>
      </div>
    </main>
  );
}
