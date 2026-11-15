import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";
import { solutions } from "./solutions-data";

export const metadata: Metadata = {
  title: "Solutions",
  description: "Fix-it-yourself answers to the problems SolveLang customers actually run into: what you see, why it happens, and the exact steps that fix it.",
  alternates: alternatesForRoute("solutions"),
};

export default function SolutionsIndexPage() {
  return (
    <main className="min-h-screen bg-panel text-ink">
      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Solutions</p>
        <h1 className="mt-4 text-4xl font-semibold">Fix it yourself</h1>
        <p className="mt-5 text-lg leading-8 text-muted">
          Straight answers to the problems SolveLang customers actually run into — what you see, why it happens, and the
          exact steps that fix it. Every fix below is one you can apply yourself, in your own account or your own
          workflows.
        </p>
        <div className="mt-10 space-y-5">
          {solutions.map((entry) => (
            <section key={entry.slug} className="rounded-2xl border border-line p-6">
              <h2 className="text-xl font-semibold">
                <Link className="text-accent underline" href={`/solutions/${entry.slug}/`}>
                  {entry.title}
                </Link>
              </h2>
              <p className="mt-3 leading-7 text-muted">{entry.summary}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 leading-7 text-muted">
          Still stuck? Email{" "}
          <a className="font-semibold text-accent underline" href="mailto:hello@solve-lang.com">
            hello@solve-lang.com
          </a>{" "}
          or browse <Link className="font-semibold text-accent underline" href="/support/">Support</Link> for the
          scanner, plugin, and report guides.
        </p>
      </section>
    </main>
  );
}
