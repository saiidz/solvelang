import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Self-Hosted Runners: The True Cost",
  description: "What self-hosted GitHub Actions runners really cost once the control plane, idle capacity and patching time are on the same invoice — with the postponed $0.002/min GitHub fee tracked with dates.",
  alternates: { canonical: "https://www.solve-lang.com/self-hosted-runners-cost/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Self-Hosted Runner Cost</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Self-hosted runners are not free. They are unbilled — by GitHub.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">GitHub charges $0 for self-hosted runner usage today. The bill arrives anyway: in cloud invoices, in idle machines, and in the engineering time a runner fleet consumes every month. This page does that arithmetic in the open.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">What GitHub charges: $0 today — with a dated asterisk</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">GitHub’s billing documentation, read November 28, 2026, states that Actions usage is free for self-hosted runners. On December 16, 2025 GitHub announced a $0.002 per minute Actions cloud platform charge on self-hosted usage in private repositories, to start March 1, 2026. On December 17, 2025 GitHub postponed that charge before it took effect, to re-evaluate its approach. It is not in force as of November 28, 2026, and no new date has been published. Budget on $0 — and know the drafted size: at $0.002/min, 100,000 self-hosted minutes a month would carry $200 before a single machine is paid for (100,000 × $0.002 = $200).</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The ops bill, line by line (worked example)</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">The example below is a worked example, not a quote: every input is shown so you can replace it with your own. It prices a small Actions Runner Controller (ARC) fleet on Amazon EKS delivering 10,000 job-minutes a month.</p>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>Control plane: Amazon EKS charges $0.10 per hour per cluster (AWS EKS pricing, read November 28, 2026). $0.10 × 730 hours = $73 a month, whether any job runs or not.</li>
          <li>Compute, including idle: runners are paid for by the hour, jobs arrive by the minute. If the fleet is busy half the hours it is provisioned, half the compute spend buys idle capacity. The arithmetic is yours to run: provisioned hours × hourly instance price × (1 − utilisation) is the idle line.</li>
          <li>Patching and maintenance time: runner images, the ARC controller, Kubernetes upgrades and credential rotation are engineering hours. The worked example in the dev.to analysis of this same fleet (read November 28, 2026) puts roughly $400 a month of engineering time on a small fleet — replace that figure with your own loaded hourly rate × the hours your team actually spends.</li>
          <li>The pager: a fleet that is down blocks every merge. That cost is real even when it never appears on an invoice.</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The number you are trying to beat</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">A standard GitHub-hosted Linux runner is $0.006/min on GitHub’s January 2026 rate card — $0.36 for an hour of job time, billed only while a job runs, rounded up per job. Self-hosting wins only when your all-in cost per delivered job-minute, ops time included, lands under the managed alternatives — not merely under GitHub’s headline.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The managed middle</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">SolveLang runs the fleet so you do not have to: keep your workflows, change the runs-on label, and pay $0.004/min for Standard minutes metered per second. No control plane, no idle capacity, no patching rota, no pager.</p>

        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=self-hosted-cost" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
