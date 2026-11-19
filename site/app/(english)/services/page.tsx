import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../components/JsonLd";

export const metadata: Metadata = {
  title: "Services",
  description: "SolveLang services: Runner Minutes for GitHub Actions, the SolveLang language and toolchain, API access plans, and merge governance (pilot).",
  alternates: { canonical: "https://www.solve-lang.com/services/" },
};

const standardPacks = [
  { minutes: "5,000", price: "$20" },
  { minutes: "25,000", price: "$100" },
  { minutes: "100,000", price: "$400" },
] as const;

const highPowerPacks = [
  { minutes: "1,000", price: "$80" },
  { minutes: "2,000", price: "$140" },
  { minutes: "3,000", price: "$192" },
  { minutes: "4,000", price: "$236" },
  { minutes: "5,000", price: "$275" },
  { minutes: "6,000", price: "$306" },
  { minutes: "7,000", price: "$336" },
  { minutes: "8,000", price: "$360" },
  { minutes: "9,000", price: "$382.50" },
  { minutes: "10,000", price: "$400" },
] as const;

const runnerMinutesJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://www.solve-lang.com/services/#runner-minutes",
  name: "SolveLang Runner Minutes",
  description:
    "Prepaid GitHub Actions runner minutes. Queued jobs in connected repositories run on SolveLang-provisioned Linux machines \u2014 a fresh machine for each job, destroyed when the job ends. Minutes meter per second, measured from each job's own start and finish timestamps on GitHub, with a 10-second minimum per job. Spot capacity draws at 1\u00d7; minutes that start on guaranteed on-demand capacity draw at 2\u00d7 and are shown as a separate line. Faster processing is never free: it costs on-demand minutes at 2\u00d7, or work on the premium High-Power machines, which draws from the separate High-Power balance at the High-Power prices. Prices include tax. Buying happens only on SolveLang's own checkout page \u2014 never on an external checkout.",
  brand: { "@id": "https://www.solve-lang.com/#organization" },
  category: "GitHub Actions runner minutes",
  offers: [
    ...standardPacks.map((pack) => ({
      "@type": "Offer",
      name: `${pack.minutes} Standard runner minutes`,
      price: pack.price.replace("$", ""),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://www.solve-lang.com/services/",
    })),
    ...highPowerPacks.map((pack) => ({
      "@type": "Offer",
      name: `${pack.minutes} High-Power runner minutes`,
      price: pack.price.replace("$", ""),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://www.solve-lang.com/services/",
    })),
  ],
};

const servicesFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://www.solve-lang.com/services/#faq",
  mainEntity: [
    {
      "@type": "Question",
      name: "How are runner minutes metered?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Minutes meter per second, measured from each job's own start and finish timestamps on GitHub, with a 10-second minimum per job.",
      },
    },
    {
      "@type": "Question",
      name: "What do Standard runner minutes cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Standard packs (2-vCPU-class machines, $0.004 per minute): 5,000 minutes for $20, 25,000 minutes for $100, and 100,000 minutes for $400. Runner-minutes prices include tax: the price shown for a pack is the full amount charged for it.",
      },
    },
    {
      "@type": "Question",
      name: "What do High-Power runner minutes cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "High-Power packs (16-vCPU-class machines; the per-minute price falls as packs grow): 1,000 minutes for $80, 2,000 minutes for $140, 3,000 minutes for $192, 4,000 minutes for $236, 5,000 minutes for $275, 6,000 minutes for $306, 7,000 minutes for $336, 8,000 minutes for $360, 9,000 minutes for $382.50, and 10,000 minutes for $400.",
      },
    },
    {
      "@type": "Question",
      name: "Is faster processing free?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Faster processing is never free \u2014 it always has one of two prices: work that starts on guaranteed on-demand capacity consumes minutes at 2\u00d7, and work that runs on the premium High-Power machines draws from the separate High-Power balance, bought at the High-Power prices. Standard work on Spot capacity draws at the plain 1\u00d7 rate.",
      },
    },
    {
      "@type": "Question",
      name: "Where do I buy runner minutes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Buying happens only on SolveLang's own checkout page \u2014 we never send you to an external checkout. Purchases happen only on SolveLang's own pages.",
      },
    },
    {
      "@type": "Question",
      name: "Do prepaid runner minutes expire or auto-renew?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "You buy a pack once \u2014 minutes never auto-renew. Prepaid minutes expire 12 months after purchase, and your balance and its expiry are always visible in your account.",
      },
    },
  ],
};

function LiveBadge() {
  return <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent">Live</span>;
}

function PilotBadge() {
  return <span className="rounded-full border border-warning bg-warning-soft px-3 py-1 text-xs font-bold uppercase tracking-wider text-warning">Pilot</span>;
}

export default function ServicesPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <JsonLd id="services-runner-minutes-json-ld" data={runnerMinutesJsonLd} />
      <JsonLd id="services-faq-json-ld" data={servicesFaqJsonLd} />
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl py-12 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-accent">SolveLang services</p>
          <h1 className="mt-5 text-5xl font-bold tracking-tight md:text-6xl">What you can buy today — and what is still a pilot.</h1>
          <p className="mt-6 text-lg leading-8 text-body">Four services. Three are live and purchasable on this site today. The fourth is a pilot and is labeled as one, with no public price and no self-serve signup.</p>
        </header>

        <section className="rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="runner-minutes-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="runner-minutes-heading" className="text-3xl font-bold">Runner Minutes</h2>
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Prepaid GitHub Actions runner minutes. Buy a pack once — minutes never auto-renew — connect GitHub a single time, and queued jobs in your repositories run on SolveLang-provisioned Linux machines automatically. Every job runs on a fresh machine created for that job alone and destroyed when the job ends.</p>

          <h3 className="mt-8 text-xl font-bold">Zero-step onboarding</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Sign in, install the SolveLang GitHub App, pick your repositories, and accept the permissions. That is the whole setup: from then on, queued jobs in the connected repositories are detected, run, metered, and settled against your balance with nothing left for you to start by hand.</p>

          <h3 className="mt-8 text-xl font-bold">How metering works</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-body">
            <li>Minutes meter per second, measured from each job&apos;s own start and finish timestamps on GitHub, with a 10-second minimum per job.</li>
            <li>Most jobs run on spare cloud capacity (Spot) and draw your balance at 1×. If Spot cannot start a job within about 90 seconds, guaranteed on-demand capacity starts it instead; those on-demand minutes draw at 2× and are always shown as their own separate line in your usage.</li>
            <li>You can pause serving at any time from your account home or the checkout page — while paused, no new machines start — and resume whenever you are ready.</li>
            <li>Prepaid minutes expire 12 months after purchase. Your balance and its expiry are always visible in your account.</li>
            <li>Linux runners for private repositories.</li>
          </ul>

          <h3 className="mt-8 text-xl font-bold">Two pools, chosen by label</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Jobs pick their pool by the runs-on label in your workflow file. Standard runs on 2-vCPU-class machines. High-Power — the Speed lane — runs on 16-vCPU-class machines with a guaranteed start and a colocated cache beside them. Faster processing is never free — it always has one of two prices: work that starts on guaranteed On-demand capacity consumes minutes at 2×, and work that runs on the premium High-Power machines draws from the separate High-Power balance, bought at the High-Power prices below. Standard work on Spot capacity draws at the plain 1× rate.</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="font-semibold text-body">Standard</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-canvas p-3 text-xs text-accent">runs-on: [self-hosted, solvelang-runners-standard]</pre>
            </div>
            <div>
              <p className="font-semibold text-body">High-Power</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-canvas p-3 text-xs text-accent">runs-on: [self-hosted, solvelang-runners-high-power]</pre>
            </div>
            <div>
              <p className="font-semibold text-body">Speed lane</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-canvas p-3 text-xs text-accent">runs-on: [self-hosted, solvelang-runners-high-power, solvelang-runners-speed]</pre>
            </div>
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Label routing:</strong> label a pull request <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvelang</code> and that pull request&apos;s jobs route to SolveLang runners instead of your own fleet. Routing is set up once in your workflow file — jobs from labeled pull requests request the SolveLang labels above — and after that, routing a pull request is just adding the label.</p>

          <h3 className="mt-8 text-xl font-bold">The shelf</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Runner-minutes prices include tax: the price shown for a pack is the full amount charged for it today. Buying happens only on SolveLang&apos;s own checkout page — we never send you to an external checkout.</p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-canvas p-6">
              <h4 className="text-lg font-bold">Standard minutes</h4>
              <p className="mt-1 text-sm text-muted">$0.004 per minute, 2-vCPU-class machines.</p>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-muted"><th className="py-2 font-semibold">Minutes</th><th className="py-2 font-semibold">Price</th></tr>
                </thead>
                <tbody>
                  {standardPacks.map((pack) => (
                    <tr key={pack.minutes} className="border-b border-line last:border-0"><td className="py-2 font-semibold">{pack.minutes}</td><td className="py-2">{pack.price}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-line bg-canvas p-6">
              <h4 className="text-lg font-bold">High-Power minutes</h4>
              <p className="mt-1 text-sm text-muted">16-vCPU-class machines; the per-minute price falls as packs grow.</p>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-muted"><th className="py-2 font-semibold">Minutes</th><th className="py-2 font-semibold">Price</th></tr>
                </thead>
                <tbody>
                  {highPowerPacks.map((pack) => (
                    <tr key={pack.minutes} className="border-b border-line last:border-0"><td className="py-2 font-semibold">{pack.minutes}</td><td className="py-2">{pack.price}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
                    <h3 className="mt-8 text-xl font-bold">SolveLang Job Protection</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Every runner minute carries the same built-in protections: you are billed only for jobs a SolveLang machine actually ran, exactly once, metered per second from the job&apos;s own GitHub timestamps; a safety net re-checks every finished job so engine work is never lost or double-billed; machines are never shut down from under a running job, and jobs are spread across zones and machine families so one cloud event cannot take down a whole set at once. The full guarantee list — each one live and proven, none of it an add-on or a tier — is on the <Link href="/solutions/job-protection/" className="font-semibold text-ink underline">Job Protection page</Link>.</p>
          <p className="mt-4 text-sm leading-6 text-body"><strong className="text-ink">Speed Lane Cache:</strong> a 10 GB colocated cache that sits beside the high-power machines, so dependency and build caches load at local speed — $2 per month.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/account/runner-minutes-checkout/" className="inline-flex rounded-xl bg-accent-solid px-5 py-3 font-semibold text-ink hover:bg-panel-alt">Buy runner minutes</Link>
            <Link href="/account/api-keys/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-panel">Open your account</Link>
          </div>
          <p className="mt-6 max-w-4xl leading-7 text-body"><strong className="text-ink">Fix it yourself:</strong> the <Link href="/solutions/" className="font-semibold text-ink underline">solutions library</Link> walks through the problems customers hit most — jobs not reaching SolveLang, labels and pools, pausing minutes, sign-in links — with the fix for each, step by step.</p>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="language-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="language-heading" className="text-3xl font-bold">The SolveLang language &amp; toolchain</h2>
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">SolveLang is a readable, explainable workflow language: humans can read it, engineers can review it, and organizations can audit it. The canonical runtime is the Rust <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvec</code> CLI — run, validate, check, lint, and format workflows locally, with hardened execution modes that deny network, file, environment, and AI capabilities.</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-body">
            <li><strong className="text-ink">Run in the browser:</strong> the <Link className="font-semibold text-ink underline" href="/run/">/run/ workspace</Link> runs a pinned WebAssembly build of the safe core — try the language with no install.</li>
            <li><strong className="text-ink">Workflow Intelligence Studio:</strong> a local-first browser workspace to model workflows, inspect risks, run scenarios, and trace outcomes — <Link className="font-semibold text-ink underline" href="/studio/">open Studio</Link>.</li>
            <li><strong className="text-ink">Audits:</strong> bounded, read-only <Link className="font-semibold text-ink underline" href="/repository-audit/">Repository Audit</Link>, Solve Graph, and Server Audit surfaces that show what a change can affect, with evidence.</li>
            <li><strong className="text-ink">Accounts with Live Center:</strong> a customer account gives you the Live Center — a live view of your pull requests, the merge queue, checks, runners, and your minutes balance.</li>
          </ul>
          <p className="mt-4 max-w-4xl leading-7 text-body">The language and toolchain are open source: <a className="font-semibold text-ink underline" href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer">github.com/saiidz/solvelang</a>.</p>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="api-plans-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="api-plans-heading" className="text-3xl font-bold">API access plans</h2>
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Monthly weighted-credit API plans for the SolveLang API and repository-audit integrations. One base credit covers up to 5,000 input tokens and 1,000 output tokens; larger jobs consume multiple credits, and every plan has a hard monthly limit.</p>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <article className="rounded-2xl border border-line bg-canvas p-6">
              <h3 className="text-xl font-bold">Developer</h3>
              <p className="mt-3 text-3xl font-bold">$49<span className="text-base font-medium text-muted">/month</span></p>
              <p className="mt-2 text-sm leading-6 text-body">1,000 weighted credits per month · 2 active API keys</p>
            </article>
            <article className="rounded-2xl border border-line bg-canvas p-6">
              <h3 className="text-xl font-bold">Pro</h3>
              <p className="mt-3 text-3xl font-bold">$199<span className="text-base font-medium text-muted">/month</span></p>
              <p className="mt-2 text-sm leading-6 text-body">10,000 weighted credits per month · 3 active API keys</p>
            </article>
            <article className="rounded-2xl border border-line bg-canvas p-6">
              <h3 className="text-xl font-bold">Business</h3>
              <p className="mt-3 text-3xl font-bold">$699<span className="text-base font-medium text-muted">/month</span></p>
              <p className="mt-2 text-sm leading-6 text-body">50,000 weighted credits per month · 5 active API keys</p>
            </article>
          </div>
          <Link href="/api-pricing/" className="mt-8 inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Compare API plans in full</Link>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="merge-governance-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="merge-governance-heading" className="text-3xl font-bold">Merge governance — Process Solution</h2>
            <PilotBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Process Solution is governed merge automation for busy GitHub repositories. It builds the exact tree that will land — base plus batch together — runs one capped battery of your existing checks on that combined tree, and lands the tree only on FULL GREEN. Every merge and every block writes its reason to a decision audit log, and a scoreboard proves the savings on your own queue. Your code never leaves your infrastructure: the control plane works from webhooks, pull-request metadata, and test results — never a checkout.</p>
          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Pilot status:</strong> Process Solution is in pilot with a small number of design-partner teams. There is no public price and no self-serve signup yet.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/process-solution/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">How Process Solution works</Link>
            <a href="mailto:hello@solve-lang.com" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Ask about the pilot</a>
          </div>
        </section>

        <p className="mt-10 text-center text-sm leading-6 text-muted">UPCOMINGSOUNDS S.R.L. is the operator and merchant for paid services; Stripe processes payments. Purchases happen only on SolveLang&apos;s own pages.</p>
      </div>
    </main>
  );
}
