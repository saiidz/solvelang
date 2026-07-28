import type { Metadata } from "next";
import Link from "next/link";
import { RepositoryAuditApp } from "../../repository-audit/RepositoryAuditApp";

export const metadata: Metadata = {
  title: "Free Repository Audit and Codebase Inventory",
  description:
    "Upload a ZIP or TAR repository archive and receive a deterministic local inventory, duplicate and backup findings, technology detection, and downloadable evidence without executing repository code.",
  alternates: { canonical: "https://www.solve-lang.com/repository-audit/" },
};

export default function RepositoryAuditPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight">SolveLang</Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/check/" className="rounded-xl px-3 py-2 font-medium text-slate-600 hover:bg-white hover:text-slate-950">Workflow Preflight</Link>
          <Link href="/studio/" className="hidden rounded-xl px-3 py-2 font-medium text-slate-600 hover:bg-white hover:text-slate-950 sm:inline-flex">Studio</Link>
          <Link href="/resources/" className="rounded-xl px-3 py-2 font-medium text-slate-600 hover:bg-white hover:text-slate-950">Resources</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-700">SolveLang Repository Audit</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          See what is inside a repository before changing it.
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">
          Upload a repository archive and get a deterministic read-only inventory, architecture signals, duplicate and backup candidates, generated-output warnings, and downloadable evidence. The scan stays in your browser.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">No account required</span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">Runs locally</span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">No code execution</span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">Evidence export</span>
        </div>
      </section>

      <RepositoryAuditApp />
    </main>
  );
}
