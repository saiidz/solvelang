import type { Metadata } from "next";
import Link from "next/link";
import { PaymentElementClient } from "../../checkout/PaymentElementClient";

export const metadata: Metadata = {
  title: "Secure Checkout",
  description: "Complete your SolveLang Workflow Preflight purchase securely with Stripe.",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-950 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/check/" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
          ← Back to Workflow Preflight
        </Link>

        <div className="mt-8 grid gap-8 lg:grid-cols-[.75fr_1.25fr] lg:items-start">
          <aside className="rounded-[2rem] bg-slate-950 p-7 text-white shadow-2xl sm:p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">SolveLang</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Workflow Preflight</h1>
            <p className="mt-4 leading-7 text-slate-300">
              Unlock the complete deterministic evidence report for your current workflow scan.
            </p>
            <div className="mt-8 border-t border-white/10 pt-6">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-slate-400">One-time payment</span>
                <span className="text-3xl font-semibold">$49</span>
              </div>
              <ul className="mt-7 space-y-3 text-sm leading-6 text-slate-200">
                <li>✓ Complete findings and evidence</li>
                <li>✓ Downloadable HTML report</li>
                <li>✓ Downloadable JSON evidence</li>
                <li>✓ No account required</li>
              </ul>
            </div>
            <p className="mt-8 text-xs leading-5 text-slate-400">
              Payments are securely processed by Stripe. SolveLang never receives or stores your full card number.
            </p>
          </aside>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/50 sm:p-8">
            <div className="mb-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Secure payment</p>
              <h2 className="mt-2 text-2xl font-semibold">Complete your purchase</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Secure checkout powered by Stripe.</p>
            </div>
            <PaymentElementClient />
          </section>
        </div>
      </div>
    </main>
  );
}
