import type { Metadata } from "next";
import Link from "next/link";
import { WithdrawalRequestClient } from "../../withdraw/WithdrawalRequestClient";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "Withdrawal Request",
  description: "Submit a SolveLang Workflow Preflight withdrawal request for review.",
  alternates: alternatesForRoute("withdraw"),
};

export default function WithdrawPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-14 text-slate-950 sm:py-20">
      <section className="mx-auto max-w-2xl">
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link><Link href="/terms/">Terms of Use</Link><Link href="/refund-policy/">Refund Policy</Link>
        </nav>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Withdrawal request</h1>
        <p className="mt-4 leading-7 text-slate-700">Use this form to send a withdrawal statement for review. It is not an automatic eligibility decision or a refund promise. Mandatory consumer rights remain unaffected.</p>
        <WithdrawalRequestClient />
      </section>
    </main>
  );
}
