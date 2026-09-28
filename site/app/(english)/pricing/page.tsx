import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";
import { billingAvailability } from "../../product-capabilities";

export const metadata: Metadata = {
  title: "SolveLang Pricing",
  description: "Find current SolveLang API subscription plans and their documented scope.",
  alternates: alternatesForRoute("pricing"),
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-950">
      <section className="mx-auto max-w-4xl rounded-3xl border bg-white p-8 sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">SolveLang pricing</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Current API plans</h1>
        <p className="mt-5 leading-7 text-slate-700">Developer, Pro, and Business plan prices, weighted-credit limits, API-key limits, and repository-audit scope are listed on the API Pricing page.</p>
        <p className="mt-4 leading-7 text-slate-700">{billingAvailability}</p>
        <Link className="mt-8 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white hover:bg-slate-800" href="/api-pricing/">View API pricing</Link>
        <p className="mt-8 text-sm leading-6 text-slate-600">Paid priority and provider-backed execution remain separate gates. Workflow Preflight is a separate one-time product with its own checkout gate.</p>
      </section>
    </main>
  );
}
