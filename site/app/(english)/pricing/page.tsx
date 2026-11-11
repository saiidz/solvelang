import type { Metadata } from "next";
import Link from "next/link";
import { billingAvailability } from "../../product-capabilities";
import RedirectToApiPricing from "./RedirectToApiPricing";

export const metadata: Metadata = {
  title: "SolveLang Pricing",
  description: "Find current SolveLang API subscription plans and their documented scope.",
  alternates: { canonical: "https://www.solve-lang.com/api-pricing/" },
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <RedirectToApiPricing />
      <meta httpEquiv="refresh" content="0; url=/api-pricing/" />
      <section className="mx-auto max-w-4xl rounded-3xl border bg-panel p-8 sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">SolveLang pricing</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Pricing has moved</h1>
        <p className="mt-5 leading-7 text-body">SolveLang pricing has moved to the API Pricing page. Developer, Pro, and Business plan prices, weighted-credit limits, API-key limits, and repository-audit scope are listed there. You should be redirected automatically.</p>
        <p className="mt-4 leading-7 text-body">{billingAvailability}</p>
        <Link className="mt-8 inline-flex rounded-xl bg-canvas px-5 py-3 font-semibold text-ink hover:bg-panel-alt" href="/api-pricing/">View API pricing</Link>
        <p className="mt-8 text-sm leading-6 text-muted">Paid priority and provider-backed execution remain separate gates. Workflow Preflight is a separate one-time product with its own checkout gate.</p>
      </section>
    </main>
  );
}
