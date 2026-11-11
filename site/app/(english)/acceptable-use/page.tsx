import type { Metadata } from "next";
import Link from "next/link";
import legalContent from "../../legal-content.json";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "Acceptable Use Policy for SolveLang services, operated by UPCOMINGSOUNDS S.R.L.",
  alternates: alternatesForRoute("acceptable-use"),
};

const sections = legalContent.acceptableUse as [string, string[]][];

export default function AcceptableUsePage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <section className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-accent">
          <Link href="/">SolveLang</Link>
          <Link href="/terms/">Terms of Use</Link>
          <Link href="/privacy-policy/">Privacy policy</Link>
          <Link href="/support/">Support</Link>
        </nav>
        <header className="mt-10 border-b border-line pb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">SolveLang legal</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Acceptable Use Policy</h1>
          <p className="mt-4 text-base leading-7 text-muted">Effective version: {legalContent.termsVersion}. Operator: {legalContent.operator}.</p>
        </header>
        <div className="mt-10 space-y-10">
          {sections.map(([heading, paragraphs]) => (
            <section key={heading} aria-labelledby={heading.toLowerCase().replaceAll(" ", "-")}>
              <h2 id={heading.toLowerCase().replaceAll(" ", "-")} className="text-2xl font-semibold tracking-tight">{heading}</h2>
              <div className="mt-4 space-y-4 leading-7 text-body">
                {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <footer className="mt-14 border-t border-line pt-6 text-sm text-muted">
          Questions about this policy: <a className="font-semibold text-accent underline" href="mailto:hello@solve-lang.com">hello@solve-lang.com</a>.
        </footer>
      </section>
    </main>
  );
}
