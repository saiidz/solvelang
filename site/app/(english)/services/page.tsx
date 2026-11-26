import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../components/JsonLd";

export const metadata: Metadata = {
  title: "Services",
  description: "SolveLang services: Runner Minutes for GitHub Actions, the SolveLang language and toolchain, API access plans, and merge governance (live).",
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

const premiumPacks = [
  { minutes: "5,000", price: "$2,500" },
  { minutes: "10,000", price: "$5,000" },
  { minutes: "25,000", price: "$12,500" },
  { minutes: "30,000", price: "$15,000" },
  { minutes: "40,000", price: "$20,000" },
  { minutes: "50,000", price: "$25,000" },
  { minutes: "60,000", price: "$30,000" },
  { minutes: "70,000", price: "$35,000" },
  { minutes: "80,000", price: "$40,000" },
  { minutes: "90,000", price: "$45,000" },
  { minutes: "100,000", price: "$50,000" },
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
    ...premiumPacks.map((pack) => ({
      "@type": "Offer",
      name: `${pack.minutes} Premium runner minutes`,
      price: pack.price.replace("$", "").replace(",", ""),
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
      name: "What do Premium runner minutes cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Premium packs (96-vCPU-class machines, $0.50 per minute at every pack size): 5,000 minutes for $2,500, 10,000 minutes for $5,000, 25,000 minutes for $12,500, 30,000 minutes for $15,000, 40,000 minutes for $20,000, 50,000 minutes for $25,000, 60,000 minutes for $30,000, 70,000 minutes for $35,000, 80,000 minutes for $40,000, 90,000 minutes for $45,000, and 100,000 minutes for $50,000.",
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

export default function ServicesPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <JsonLd id="services-runner-minutes-json-ld" data={runnerMinutesJsonLd} />
      <JsonLd id="services-faq-json-ld" data={servicesFaqJsonLd} />
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl py-12 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-accent">SolveLang services</p>
          <h1 className="mt-5 text-5xl font-bold tracking-tight md:text-6xl">What you can buy today — and what is live but not for sale.</h1>
          <p className="mt-6 text-lg leading-8 text-body">Four services. Three are live and purchasable on this site today. The fourth is live and is labeled as one, with no public price and no self-serve signup. The free tools and SolveLang Verification follow below.</p>
        </header>

        <section className="rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="runner-minutes-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="runner-minutes-heading" className="text-3xl font-bold">Runner Minutes</h2>
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Prepaid GitHub Actions runner minutes. Buy a pack once — minutes never auto-renew — connect GitHub a single time, and queued jobs in your repositories run on SolveLang-provisioned Linux machines automatically. Every job runs on a fresh machine created for that job alone and destroyed when the job ends.</p>

          <h3 className="mt-8 text-xl font-bold">How onboarding works</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Four steps, once:</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 leading-7 text-body">
            <li><strong className="text-ink">Sign in</strong> and open Runner Minutes in your account.</li>
            <li><strong className="text-ink">Install the SolveLang GitHub App</strong> on your account or organization, pick the repositories it may serve, and accept the permissions.</li>
            <li><strong className="text-ink">Buy a minutes pack</strong> on SolveLang&apos;s own checkout page — jobs draw against that balance, metered per second.</li>
            <li><strong className="text-ink">Point your workflows at SolveLang</strong> — set <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">runs-on: [self-hosted, solvelang-runners-standard]</code> (or the High-Power label) in the workflows you want served.</li>
          </ol>
          <p className="mt-3 max-w-4xl leading-7 text-body">From then on, queued jobs in the connected repositories are detected, run, metered, and settled against your balance with nothing left for you to start by hand. Repositories you add to the installation later are picked up automatically.</p>

          <h3 className="mt-8 text-xl font-bold">How metering works</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-body">
            <li>Minutes meter per second, measured from each job&apos;s own start and finish timestamps on GitHub, with a 10-second minimum per job.</li>
            <li>Most jobs run on spare cloud capacity (Spot) and draw your balance at 1×. If Spot cannot start a job within about 90 seconds, guaranteed on-demand capacity starts it instead; those on-demand minutes draw at 2× and are always shown as their own separate line in your usage.</li>
            <li>You can pause serving at any time from your account home or the checkout page — while paused, no new machines start — and resume whenever you are ready.</li>
            <li>Prepaid minutes expire 12 months after purchase. Your balance and its expiry are always visible in your account.</li>
            <li>Linux runners for private repositories.</li>
          </ul>

          <h3 className="mt-8 text-xl font-bold">Three pools, chosen by label</h3>
          <p className="mt-3 max-w-4xl leading-7 text-body">Jobs pick their pool by the runs-on label in your workflow file. Standard runs on 2-vCPU-class machines. High-Power — the Speed lane — runs on 16-vCPU-class machines with a guaranteed start and a colocated cache beside them. Premium runs on 96-vCPU-class machines for the heaviest suites. Faster processing is never free — it always has one of two prices: work that starts on guaranteed On-demand capacity consumes minutes at 2×, and work that runs on the premium High-Power machines draws from the separate High-Power balance, bought at the High-Power prices below. Premium work draws from its own separate Premium balance at the Premium prices below. Standard work on Spot capacity draws at the plain 1× rate.</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
            <div>
              <p className="font-semibold text-body">Premium</p>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl bg-canvas p-3 text-xs text-accent">runs-on: [self-hosted, solvelang-runners-premium]</pre>
            </div>
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Label routing:</strong> label a pull request <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvelang</code> and that pull request&apos;s jobs route to SolveLang runners instead of your own fleet. Routing is set up once in your workflow file — jobs from labeled pull requests request the SolveLang labels above — and after that, routing a pull request is just adding the label.</p>

          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Pool choice per pull request:</strong> the pool names also work as pull request labels. Label a pull request <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvelang-runners-premium</code> and its jobs run on the Premium pool, drawing from your Premium balance; label it <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvelang-runners-high-power</code> and its jobs run on the High-Power pool, drawing from your High-Power balance; label it <code className="rounded bg-canvas px-1.5 py-0.5 text-sm text-accent">solvelang-runners-standard</code> and its jobs stay on the Standard pool, drawing from your Standard balance. The label applies per pull request — jobs already running are not moved, and a job whose workflow file already asks for a stronger pool stays on that pool.</p>

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
            <div className="rounded-2xl border border-line bg-canvas p-6">
              <h4 className="text-lg font-bold">Premium minutes</h4>
              <p className="mt-1 text-sm text-muted">$0.50 per minute, 96-vCPU-class machines.</p>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-muted"><th className="py-2 font-semibold">Minutes</th><th className="py-2 font-semibold">Price</th></tr>
                </thead>
                <tbody>
                  {premiumPacks.map((pack) => (
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
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Process Solution is governed merge automation for busy GitHub repositories. It builds the exact tree that will land — base plus batch together — runs one capped battery of your existing checks on that combined tree, and lands the tree only on FULL GREEN. Every merge and every block writes its reason to a decision audit log, and a scoreboard proves the savings on your own queue. Your code never leaves your infrastructure: the control plane works from webhooks, pull-request metadata, and test results — never a checkout.</p>
          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Live status:</strong> Process Solution is live. The full governed cycle — plan, combined tree, battery, land — is proven end-to-end in production, with the landed tree verified identical to the tested tree and every decision written to the audit log. There is no public price and no self-serve signup yet.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/process-solution/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">How Process Solution works</Link>
            <a href="mailto:hello@solve-lang.com" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Ask about Process Solution</a>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="free-tools-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="free-tools-heading" className="text-3xl font-bold">Free tools</h2>
            <LiveBadge />
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">Three checks that run on any public repository today — no signup, no install. Every finding is graded verified / failed / unverified, with its evidence attached.</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-body">
            <li><strong className="text-ink">Repo Security Scan:</strong> scan a public repository and get its security findings graded one by one — <Link className="font-semibold text-ink underline" href="/security-scan/">run a scan</Link>.</li>
            <li><strong className="text-ink">CI Bill Check:</strong> price a public repo&apos;s recent GitHub Actions runs under per-minute vs per-second billing, from the runs&apos; real job seconds — <Link className="font-semibold text-ink underline" href="/ci-bill-check/">check a bill</Link>.</li>
            <li><strong className="text-ink">Change Impact Receipts:</strong> a graded receipt for a pull request — what it touches, and what the evidence shows — <Link className="font-semibold text-ink underline" href="/change-impact-receipt/">see how receipts work</Link>.</li>
          </ul>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="verification-heading">
          <div className="flex flex-wrap items-center gap-4">
            <h2 id="verification-heading" className="text-3xl font-bold">SolveLang Verification</h2>
            <span className="rounded-full bg-panel-alt px-3 py-1 text-xs font-bold uppercase tracking-wider text-body">Proven — opening next</span>
          </div>
          <p className="mt-4 max-w-4xl leading-7 text-body">An installable GitHub check that grades pull-request changes: a Change Impact Receipt — verified / failed / unverified — posted as a check run with inline annotations and a receipt comment, with every run written to an audit log. Report-only by default; a repository can switch it to enforce mode in its own config.</p>
          <p className="mt-4 max-w-4xl leading-7 text-body"><strong className="text-ink">Status:</strong> proven end-to-end on our own repositories — a deliberately defective pull request was caught in enforce mode, clean pull requests passed, and the graded receipts posted on the PR. Opening to outside repositories next. There is no public price and no self-serve signup yet.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/change-impact-receipt/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">How Change Impact Receipts work</Link>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby="status-matrix-heading">
          <h2 id="status-matrix-heading" className="text-3xl font-bold">What is live, what is published, what is pilot</h2>
          <p className="mt-4 max-w-4xl leading-7 text-body">SolveLang has several surfaces, and they do not all stand in the same place. This table is the single reference for what each one is today — what works, where its boundary sits, and what it takes to use it. If anything elsewhere on this site reads differently, this table is the one to believe, and the date on each row is when it was last checked against the live service.</p>
          <div className="overflow-x-auto">
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted"><th className="py-2 pr-4 font-semibold">Offering</th><th className="py-2 pr-4 font-semibold">Status</th><th className="py-2 pr-4 font-semibold">What works / boundary</th><th className="py-2 pr-4 font-semibold">Self-serve?</th><th className="py-2 pr-4 font-semibold">Account needed?</th><th className="py-2 font-semibold">Last verified</th></tr>
              </thead>
              <tbody>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Rust CLI (<code>solvec</code>) &amp; the <code>.solve</code> runtime</td><td className="py-3 pr-4">Pre-1.0 — active development</td><td className="py-3 pr-4 leading-6 text-body">The canonical local runtime and policy boundary for <code>.solve</code> workflows. Not a stable 1.0 contract, and not a general automation-platform replacement.</td><td className="py-3 pr-4">Yes — build from source</td><td className="py-3 pr-4">No</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Workflow Studio &amp; the <code>/run/</code> browser preview</td><td className="py-3 pr-4">Available — local-first</td><td className="py-3 pr-4 leading-6 text-body">Model a workflow, inspect its risks, and run scenarios in the browser; projects save locally first. <code>/run/</code> executes a pinned WebAssembly build of the runtime (build <code>565fbc1c</code>) in your browser, never on a server — your code never leaves the browser, and the only thing recorded is an anonymous count that a run happened.</td><td className="py-3 pr-4">Yes</td><td className="py-3 pr-4">No — an account is only needed to save projects</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Repository Audit, Solve Graph &amp; Server Audit</td><td className="py-3 pr-4">Available — read-only</td><td className="py-3 pr-4 leading-6 text-body">Bounded static analysis and impact explanation over a repository or a server. It does not execute repository code and does not change anything it examines.</td><td className="py-3 pr-4">Yes</td><td className="py-3 pr-4">No</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">MCP server — local package</td><td className="py-3 pr-4">Published — v0.4.0</td><td className="py-3 pr-4 leading-6 text-body">Read-only tools for MCP clients such as Codex and Claude Code, bounded to the workspace you name: 31 tools in the published package, including the two context-index tools. Install with the bare command — the package ships a single executable: <code>npx --yes @solvelang/mcp-server@0.4.0</code></td><td className="py-3 pr-4">Yes</td><td className="py-3 pr-4">No</td><td className="py-3">November 25, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">MCP server — hosted endpoint</td><td className="py-3 pr-4">Live — read-only</td><td className="py-3 pr-4 leading-6 text-body"><code>https://mcp.solve-lang.com</code> — the same read-only analysis over raw JSON you send in the request: 10 tools, no server-side workspace, a 4 MiB request ceiling, and a rate limit of 60 requests per minute per source address. A bearer token is required.</td><td className="py-3 pr-4">By request</td><td className="py-3 pr-4">Token required — tokens are issued by SolveLang; write to hello@solve-lang.com for access</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Runner Minutes &amp; Speed Lane Cache</td><td className="py-3 pr-4">Live</td><td className="py-3 pr-4 leading-6 text-body">Prepaid GitHub Actions runner minutes on fresh Linux machines created for each job and destroyed after it, metered per second with a 10-second minimum, never auto-renewing, expiring 12 months after purchase. Standard (2-vCPU class): 5,000 minutes $20 · 25,000 $100 · 100,000 $400. High-Power (16-vCPU class): 1,000 minutes $80 up to 10,000 $400. Start with 300 free Standard minutes when you connect GitHub — no card required, valid 30 days. Optional Speed Lane Cache: 10 GB for $2/month. Guaranteed on-demand starts draw minutes at 2× — faster is never free.</td><td className="py-3 pr-4">Yes — on SolveLang&apos;s own checkout page</td><td className="py-3 pr-4">Yes</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">API access plans</td><td className="py-3 pr-4">Live</td><td className="py-3 pr-4 leading-6 text-body">Monthly weighted-credit plans for the SolveLang API and repository-audit integrations. One base credit covers up to 5,000 input tokens and 1,000 output tokens. Developer $49/month (1,000 credits) · Pro $199/month (10,000 credits) · Business $699/month (50,000 credits).</td><td className="py-3 pr-4">Yes — on SolveLang&apos;s own checkout page</td><td className="py-3 pr-4">Yes</td><td className="py-3">November 22, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Free tools (Repo Security Scan, CI Bill Check, Change Impact Receipts)</td><td className="py-3 pr-4">Live — free</td><td className="py-3 pr-4 leading-6 text-body">Run on any public repository with no signup; every finding graded verified / failed / unverified.</td><td className="py-3 pr-4">Yes</td><td className="py-3 pr-4">No</td><td className="py-3">November 26, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Team Context Index</td><td className="py-3 pr-4">Live</td><td className="py-3 pr-4 leading-6 text-body">A shared context index for a team&apos;s repositories: $8 per seat per month — billing counts active members only, and the owner counts as a seat.</td><td className="py-3 pr-4">Yes — in your account</td><td className="py-3 pr-4">Yes</td><td className="py-3">November 26, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Weekly CI Health Digest</td><td className="py-3 pr-4">Live</td><td className="py-3 pr-4 leading-6 text-body">A weekly digest of your CI health in your account, published Mondays 06:00 EST.</td><td className="py-3 pr-4">Yes — in your account</td><td className="py-3 pr-4">Yes</td><td className="py-3">November 26, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">SolveLang Verification</td><td className="py-3 pr-4">Proven — opening next</td><td className="py-3 pr-4 leading-6 text-body">Graded verification for pull requests — a receipt posted as a check run with a receipt comment, every run written to an audit log. Proven end-to-end on our own repositories; opening to outside repositories next. There is no public price and no self-serve signup yet.</td><td className="py-3 pr-4">No</td><td className="py-3 pr-4">—</td><td className="py-3">November 26, 2026</td></tr>
                <tr className="border-b border-line align-top last:border-0"><td className="py-3 pr-4 font-semibold">Process Solution (merge governance)</td><td className="py-3 pr-4">Live</td><td className="py-3 pr-4 leading-6 text-body">Combined-tree batch checks, merge decisions, and audit logs for pull-request queues — running on the operator&apos;s own queues today. There is no public price and no self-serve signup yet.</td><td className="py-3 pr-4">No</td><td className="py-3 pr-4">— (live)</td><td className="py-3">November 25, 2026</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-6 leading-7 text-body">SolveLang is operated by <strong>UPCOMINGSOUNDS S.R.L.</strong>, Bucharest, Romania. Support: <a href="mailto:hello@solve-lang.com" className="font-semibold text-accent underline underline-offset-4 hover:text-ink">hello@solve-lang.com</a>.</p>
        </section>

        <p className="mt-10 text-center text-sm leading-6 text-muted">UPCOMINGSOUNDS S.R.L. is the operator and merchant for paid services; Stripe processes payments. Purchases happen only on SolveLang&apos;s own pages.</p>
      </div>
    </main>
  );
}
