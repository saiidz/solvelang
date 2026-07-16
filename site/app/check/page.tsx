import type { Metadata } from "next";
import Link from "next/link";
import { WorkflowPreflight } from "./WorkflowPreflight";

export const metadata: Metadata = {
  title: "Free n8n Workflow Validator and Preflight — SolveLang",
  description:
    "Upload an exported n8n workflow and receive an automated deterministic preflight score, risk findings, and downloadable evidence without sending workflow data to a server.",
};

export default function WorkflowCheckPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight">SolveLang</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/studio/" className="rounded-xl px-4 py-2 font-medium text-slate-600 hover:bg-white hover:text-slate-950">Studio</Link>
          <Link href="/resources/" className="rounded-xl px-4 py-2 font-medium text-slate-600 hover:bg-white hover:text-slate-950">Resources</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-700">SolveLang Workflow Preflight</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Check an n8n workflow before it reaches production.
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">
          Upload workflow JSON and get an immediate deterministic scan for missing paths, unsafe execution signals, absent human review, and weak failure handling. No call and no manual delivery.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">No account required</span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">Runs locally</span>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2">Deterministic findings</span>
        </div>
      </section>

      <WorkflowPreflight />
    </main>
  );
}
