import type { Metadata } from "next";
import { SecurityScanApp } from "../../security-scan/SecurityScanApp";

export const metadata: Metadata = {
  title: "Free Repo Security Scan",
  description: "A free, read-only security scan for a public GitHub repository: security policy, dependency automation, and workflow posture read from the GitHub API, every finding labeled verified, failed, or unverified with provenance. No risk scores.",
  alternates: { canonical: "https://www.solve-lang.com/security-scan/" },
};

export default function SecurityScanPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang Repo Security Scan</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">A security scan that states its evidence.</h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">Name a public GitHub repository and get its security posture read from the public record: a stated route for reporting vulnerabilities, dependency update automation, and the workflow checks that guard its CI - every finding labeled verified, failed, or unverified, with provenance. What the public record cannot show is labeled unverified, in plain words. Free, read-only, no risk scores.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted"><span className="rounded-full border border-line bg-panel px-4 py-2">Free</span><span className="rounded-full border border-line bg-panel px-4 py-2">Read-only</span><span className="rounded-full border border-line bg-panel px-4 py-2">No risk scores</span><span className="rounded-full border border-line bg-panel px-4 py-2">Provenance on every finding</span></div>
      </section>
      <SecurityScanApp />
    </main>
  );
}
