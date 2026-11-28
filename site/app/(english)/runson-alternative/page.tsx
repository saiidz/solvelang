import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "A RunsOn Alternative With No Stack to Run",
  description: "RunsOn is a flat license plus AWS compute in your own account plus a CloudFormation stack to operate. SolveLang: no stack, no AWS account, no license tiers — prepaid per-second minutes.",
  alternates: { canonical: "https://www.solve-lang.com/runson-alternative/" },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang RunsOn Alternative</p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">RunsOn alternative: no stack, no AWS account, no license tiers.</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">RunsOn is an honest product with an honest price — and three separate things to pay for and operate. This page lines them up against the managed alternative, from RunsOn’s own published pricing.</p>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">What RunsOn charges (RunsOn’s own pricing, read November 28, 2026)</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-6 leading-7 text-muted">
          <li>A flat annual license per legal entity, keyed to monthly runner volume: $350/yr under 50,000 jobs a month, $1,050/yr under 200,000, $2,100/yr under 500,000, and $4,200/yr at 500,000 and up.</li>
          <li>AWS compute at cost in your own account: spot instances for the minutes your jobs run (RunsOn’s published comparisons put a 2 vCPU spot instance at roughly $0.001/min), plus the S3 cache bucket, EBS volumes and a small control plane on the same AWS bill.</li>
          <li>Your operations: RunsOn installs as a CloudFormation stack in your AWS account. The stack, the quotas, the AWS bill and the upgrades are yours to run.</li>
        </ul>
        <h2 className="mt-12 text-2xl font-semibold tracking-tight sm:text-3xl">The no-stack alternative</h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted">SolveLang is the same job — your existing GitHub Actions workflows on a fresh runner — with none of the three bill lines: no license tiers, no AWS account, no CloudFormation stack to deploy or maintain. Standard minutes are $0.004/min metered per second (10-second minimum), bought as prepaid packs: 5,000 for $20, 25,000 for $100, 100,000 for $400. If running runners inside your own AWS account is a requirement, RunsOn is built for exactly that; if it is a means to a cheaper bill, price the managed route first.</p>

        <p className="mt-10 leading-7 text-muted">Price your own repository’s real runs under both meters: <a href="/ci-bill-check/?utm_source=solve-lang.com&utm_medium=seo&utm_campaign=runson-alternative" className="font-semibold text-accent">the free CI Bill Check</a>. Standard minutes are $0.004/min metered per second (10-second minimum): packs of 5,000 minutes for $20, 25,000 for $100 and 100,000 for $400. Connect GitHub and get 300 free Standard minutes, no card, valid 30 days.</p>
      </section>
    </main>
  );
}
