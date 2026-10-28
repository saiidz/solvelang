import type { Metadata } from "next";
import Link from "next/link";
import legalContent from "../../legal-content.json";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "Companies that process personal data on behalf of SolveLang, operated by UPCOMINGSOUNDS S.R.L.",
  alternates: alternatesForRoute("subprocessors"),
};

const subprocessors = legalContent.subprocessors as [string, string, string][];

export default function SubprocessorsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-700">
          <Link href="/">SolveLang</Link>
          <Link href="/terms/">Terms of Use</Link>
          <Link href="/data-processing/">Data Processing Addendum</Link>
          <Link href="/privacy-policy/">Privacy policy</Link>
          <Link href="/support/">Support</Link>
        </nav>
        <header className="mt-10 border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">SolveLang legal</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Subprocessors</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">Effective version: {legalContent.termsVersion}. Operator: {legalContent.operator}.</p>
        </header>
        <div className="mt-10 space-y-6 leading-7 text-slate-700">
          <p>The Operator uses the following companies to process personal data on its behalf. Each sub-processor receives only the data needed for its function and is bound by data-protection obligations at least as protective as those in the Data Processing Addendum.</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm leading-6">
              <thead>
                <tr className="border-b border-slate-300 text-slate-950">
                  <th className="py-3 pr-4 font-semibold">Sub-processor</th>
                  <th className="py-3 pr-4 font-semibold">Purpose</th>
                  <th className="py-3 font-semibold">Processing location</th>
                </tr>
              </thead>
              <tbody>
                {subprocessors.map(([name, purpose, location]) => (
                  <tr key={name} className="border-b border-slate-200 align-top">
                    <td className="py-3 pr-4 font-semibold text-slate-900">{name}</td>
                    <td className="py-3 pr-4">{purpose}</td>
                    <td className="py-3">{location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>The Operator gives business customers at least 30 days&apos; notice of an intended addition or replacement of a sub-processor, as described in the Data Processing Addendum.</p>
        </div>
        <footer className="mt-14 border-t border-slate-200 pt-6 text-sm text-slate-600">
          Questions about sub-processing: <a className="font-semibold text-blue-700 underline" href="mailto:hello@solve-lang.com">hello@solve-lang.com</a>.
        </footer>
      </section>
    </main>
  );
}
