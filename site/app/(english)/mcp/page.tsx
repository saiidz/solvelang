import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "SolveLang MCP for ChatGPT and Codex",
  description: "Public documentation for SolveLang's read-only workflow and repository graph analysis plugin.",
  alternates: alternatesForRoute("mcp"),
};

const tools = [
  ["Analyze n8n workflows", "Inspect raw n8n workflow JSON for deterministic structural findings without executing the workflow."],
  ["Generate preflight reports", "Produce Markdown or JSON reports from the same bounded in-memory workflow analysis."],
  ["Explore Solve Graphs", "Find nodes, search, traverse dependencies and dependents, compute change impact, and find bounded shortest paths."],
  ["Explain capabilities", "Report the active remote limits and the operations that are intentionally unavailable."],
] as const;

export default function McpPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <article className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Developer tools</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">SolveLang MCP for ChatGPT and Codex</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">SolveLang exposes deterministic, read-only workflow and Solve Graph analysis through a bounded remote MCP service. The public plugin is designed for analysis and explanation, not workflow execution or repository mutation.</p>

        <section className="mt-12 grid gap-5 sm:grid-cols-2">
          {tools.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-slate-200 p-6">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-2xl bg-slate-50 p-7">
          <h2 className="text-2xl font-semibold">Safety and privacy boundary</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-700">
            <li>Remote tools accept only raw JSON supplied for the requested analysis.</li>
            <li>They do not read local workspace paths, execute workflows, spawn subprocesses, write files or repositories, or call external providers.</li>
            <li>Raw workflow and graph JSON is not intentionally logged or persisted by the MCP application.</li>
            <li>Do not submit passwords, access tokens, credential values, or unrelated personal information.</li>
            <li>Requests are bounded by size and graph traversal limits and production ingress is expected to enforce rate and abuse controls.</li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold">Useful prompts</h2>
          <div className="mt-4 space-y-3 text-slate-700">
            <p className="rounded-xl border border-slate-200 p-4">Review this n8n workflow with SolveLang and prioritize the structural risks.</p>
            <p className="rounded-xl border border-slate-200 p-4">Trace the dependent impact of these changed Solve Graph nodes.</p>
            <p className="rounded-xl border border-slate-200 p-4">Find the shortest dependency path between these two Solve Graph nodes.</p>
          </div>
        </section>

        <div className="mt-12 flex flex-wrap gap-4 text-sm font-semibold">
          <Link className="text-blue-700 underline" href="/privacy-policy/">Privacy policy</Link>
          <Link className="text-blue-700 underline" href="/terms/">Terms of Use</Link>
          <Link className="text-blue-700 underline" href="/support/">Support</Link>
          <a className="text-blue-700 underline" href="https://github.com/saiidz/solvelang">Source code</a>
        </div>
      </article>
    </main>
  );
}
