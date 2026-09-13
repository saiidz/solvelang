import type { Metadata } from "next";
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";
import { previewAvailability } from "../../product-capabilities";

export const metadata: Metadata = {
  title: "Resources",
  description: "SolveLang workflow, repository, and server analysis tools, browser previews, local runtime documentation and capability boundaries.",
  alternates: alternatesForRoute("resources"),
};
const resourceGroups = [
  {
    title: "Workflow Intelligence Studio", description: "Model, analyze, simulate, compare, and export workflows locally without sending workflow data to a server.",
    links: [
      { label: "Open Workflow Studio", href: "/studio/", note: "Local-first deterministic workflow analysis and scenario simulation." },
      { label: "Browser Script Preview", href: "/run/", note: "Run the pinned WebAssembly safe core with host side effects denied, separately from Studio." },
    ],
  },
  {
    title: "Workflow and support previews", description: previewAvailability,
    links: [
      { label: "Workflow Audit Preview", href: "/audit/", note: "Describe a process directly in the page and inspect its proposed map. No email handoff is required." },
      { label: "Support Triage Demo", href: "/demo/support-triage/", note: "Explore proposed classification, ownership and reply drafts without an external send." },
    ],
  },
  {
    title: "Workflow Preflight", description: "Inspect an exported n8n workflow without uploading it to a server.",
    links: [{ label: "Open Workflow Preflight", href: "/check/", note: "Get deterministic findings and downloadable evidence for workflow structure, missing branches and review points." }],
  },
  {
    title: "Repository Audit", description: "Inspect a repository archive locally before changing files, dependencies, or structure.",
    links: [{ label: "Open Repository Audit", href: "/repository-audit/", note: "Upload ZIP or TAR and receive deterministic inventory, duplicate and backup findings, and downloadable evidence." }],
  },
  {
    title: "Server Audit", description: "Inspect a redacted, read-only Linux server posture snapshot before changing services, permissions or infrastructure.",
    links: [{ label: "Open Server Audit", href: "/server-audit/", note: "Analyze local storage, exposure, SSH, firewall, TLS, backup, log, service and permission evidence without executing remediation." }],
  },
  {
    title: "Language and implementation", description: "Inspect the canonical Rust runtime and the supported language behavior.",
    links: [
      { label: "GitHub repository", href: "https://github.com/saiidz/solvelang", note: "Runtime source, examples, tests and contribution guidance." },
      { label: "Language reference", href: "https://github.com/saiidz/solvelang/blob/main/docs/language-reference.md", note: "Supported syntax and semantics; validate generated drafts against the canonical implementation." },
    ],
  },
  {
    title: "Capability and service evidence", description: "Deployed infrastructure, preview behavior and independently measured availability are different things.",
    links: [
      { label: "About and capability boundaries", href: "/about/", note: "What works locally, what is a preview, what is deployed but gated, and what remains unfinished." },
      { label: "System status", href: "/status/", note: "Dated configuration evidence, monitoring limitations and preserved incident history." },
    ],
  },
  {
    title: "Crawlability / AI discovery files", description: "Public search aids; private account, payment and uploaded-workflow content is excluded.",
    links: [
      { label: "Sitemap", href: "/sitemap.xml", note: "Public XML sitemap for the main static pages." },
      { label: "Robots", href: "/robots.txt", note: "Crawl policy and sitemap location." },
      { label: "LLMs", href: "/llms.txt", note: "AI-facing summary of the public tools and their current boundaries." },
    ],
  },
];
export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Resources</p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">SolveLang tools and documentation.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">Start with the local tools to inspect a workflow, repository, or redacted server snapshot. Review the evidence before connecting production automation.</p>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2">
          {resourceGroups.map((group) => (
            <section key={group.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{group.description}</p>
              <div className="mt-6 space-y-4">
                {group.links.map((link) => {
                  const external = link.href.startsWith("https://");
                  return <Link key={link.href} href={link.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className="block rounded-2xl border border-slate-200 bg-slate-50 p-5 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><span className="text-lg font-semibold">{link.label}{external ? " ↗" : ""}</span><span className="mt-2 block leading-7 text-slate-600">{link.note}</span></Link>;
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
