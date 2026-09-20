import type { Metadata } from "next";
import Link from "next/link";
import { brandFacts } from "../../brandFacts";
import { JsonLd } from "../../components/JsonLd";
import { ProductCapabilities } from "../../components/ProductCapabilities";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "What Is SolveLang? Maturity, Runtime, Studio, and Limitations",
  description: "Learn which SolveLang tools work locally, which are previews, which infrastructure is deployed but gated, and what remains experimental or planned.",
  alternates: alternatesForRoute("about"),
};
const principles = [
  { title: "Readable before runnable", description: "A workflow should make sense to the people responsible for the operation before software executes it." },
  { title: "Version controllable", description: "Workflow changes should be diffable, reviewable, attributable, and reversible like other source-controlled engineering work." },
  { title: "AI boundaries stay explicit", description: "Deterministic rules, model-assisted judgment, tools, approvals, and failure paths should not be hidden behind one opaque automation step." },
  { title: "Safety is a product feature", description: "Local validation, explicit capability boundaries, understandable failures, and human review matter before managed automation scales." },
];
const aboutJsonLd = {
  "@context": "https://schema.org", "@type": "AboutPage", "@id": `${brandFacts.canonicalDomain}/about/#page`,
  url: `${brandFacts.canonicalDomain}/about/`, name: "About SolveLang", description: brandFacts.fullDescription,
  isPartOf: { "@id": `${brandFacts.canonicalDomain}/#website` }, about: { "@id": `${brandFacts.canonicalDomain}/#software` }, mainEntity: { "@id": `${brandFacts.canonicalDomain}/#software` },
};
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <JsonLd id="about-page-json-ld" data={aboutJsonLd} />
      <main>
        <section className="bg-[#071426] text-white"><div className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32"><p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-300">What is SolveLang?</p><h1 className="mt-5 text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">A readable, explainable workflow language for AI-assisted business processes.</h1><p className="mt-8 max-w-3xl text-xl leading-9 text-slate-300">SolveLang is an open-source language and workflow intelligence product for making business rules, AI-assisted decisions, approvals, tools, ownership, and failure paths readable before they become managed automation.</p></div></section>
        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24"><div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]"><div><p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Who it is for</p><h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Workflow intent first.</h2></div><div className="space-y-6 text-lg leading-8 text-slate-600"><p>SolveLang is designed first for technical founders, hands-on operators, automation consultants, small agencies, and engineering teams that want workflow intent to remain understandable in source control.</p><p>It focuses on what should be explicit before automation runs: what starts the process, which facts matter, where judgment changes the path, who owns the next action, what can fail, and when a person must review the result.</p><p>SolveLang is not a production durable workflow engine or a general-purpose autonomous AI workforce platform. A working planning preview is not a connected execution service.</p></div></div><div className="mt-20 grid gap-5 md:grid-cols-2">{principles.map((principle) => <article key={principle.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-7 shadow-sm"><h3 className="text-2xl font-semibold tracking-tight">{principle.title}</h3><p className="mt-4 leading-7 text-slate-600">{principle.description}</p></article>)}</div></section>
        <section className="border-y border-slate-200 bg-white"><div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24"><div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Current maturity</p><h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Working locally, deployed, and ready to automate are different things.</h2><p className="mt-6 text-lg leading-8 text-slate-600">The Rust CLI is the canonical runtime. Studio analysis is deterministic. Deployed account infrastructure does not make billing or managed workflow execution generally available.</p></div><div className="mt-10"><ProductCapabilities /></div></div></section>
        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24"><div className="grid gap-10 lg:grid-cols-2"><div><p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Use it today</p><h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">Start with reproducible evidence.</h2></div><div className="space-y-5 text-lg leading-8 text-slate-600"><p>Run the open-source Rust CLI, try the pinned browser safe core, inspect the public examples, or open Workflow Intelligence Studio for local deterministic analysis.</p><p>Describe your workflow directly in the audit preview without sending an email. Its proposed map and draft still require review before any live integration is configured.</p><div className="flex flex-col gap-3 pt-3 sm:flex-row sm:flex-wrap"><a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-950">Explore GitHub</a><Link href="/run/" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-semibold text-slate-950">Try browser preview</Link><Link href="/audit/" className="rounded-xl bg-[#146cff] px-5 py-3 text-center text-sm font-semibold text-white">Map a workflow</Link></div></div></div></section>
      </main>
      <footer className="bg-[#07111f] px-5 py-10 text-sm text-slate-400 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p>© 2026 SolveLang</p><div className="flex gap-4"><Link href="/status/" className="font-semibold text-white">Status</Link><Link href="/support/" className="font-semibold text-white">Support</Link><Link href="/" className="font-semibold text-white">Home</Link></div></div></footer>
    </div>
  );
}
