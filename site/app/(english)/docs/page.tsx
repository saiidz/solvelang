import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";
import { guides } from "./docs-data";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "SolveLang developer documentation, organised by the problem you have: set up the MCP server locally, connect to the remote endpoint, build context packs, audit a repository, and run GitHub Actions on SolveLang runner minutes.",
  alternates: alternatesForRoute("docs"),
};

export default function DocsIndexPage() {
  return (
    <main className="min-h-screen bg-panel text-ink">
      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Documentation</p>
        <h1 className="mt-4 text-4xl font-semibold">Start from the problem you have</h1>
        <p className="mt-5 text-lg leading-8 text-muted">
          Every guide below starts from the problem a developer actually types, carries the copy-paste commands, and
          states its honest limits on the page. No marketing detours: pick the line that matches what you are trying
          to do.
        </p>
        <div className="mt-10 space-y-5">
          {guides.map((entry) => (
            <section key={entry.slug} className="rounded-2xl border border-line p-6">
              <h2 className="text-xl font-semibold">
                <Link className="text-accent underline" href={`/docs/${entry.slug}/`}>
                  {entry.question}
                </Link>
              </h2>
              <p className="mt-3 leading-7 text-muted">{entry.summary}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 leading-7 text-muted">
          Fixing a problem instead? The{" "}
          <Link className="font-semibold text-accent underline" href="/solutions/">
            solutions library
          </Link>{" "}
          documents the problems customers run into, with the fix for each. Reference material and public examples
          live under{" "}
          <Link className="font-semibold text-accent underline" href="/resources/">
            Resources
          </Link>
          . Still stuck? Email{" "}
          <a className="font-semibold text-accent underline" href="mailto:hello@solve-lang.com">
            hello@solve-lang.com
          </a>{" "}
          or browse <Link className="font-semibold text-accent underline" href="/support/">Support</Link>.
        </p>
      </section>
    </main>
  );
}
