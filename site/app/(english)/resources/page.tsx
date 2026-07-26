import type { Metadata } from 'next';
import Link from "next/link";
import { alternatesForRoute } from "../../i18n/seo";

export const metadata: Metadata = {
  title: "Resources — SolveLang",
  description:
    "A static index of SolveLang demos, audit resources, browser preview, local runtime, and crawlability files for AI discovery.",
  alternates: alternatesForRoute("resources"),
};

const resourceGroups = [
  {
    title: "Workflow Intelligence Studio",
    description:
      "Model, analyze, simulate, compare, and export workflows locally without sending workflow data to a server.",
    links: [
      {
        label: "Open Workflow Studio",
        href: "/studio/",
        note: "Use the local-first visual workspace for deterministic workflow analysis and scenario simulation.",
      },
      {
        label: "Browser Script Preview",
        href: "/run/",
        note: "Preview the smaller browser-safe SolveLang script subset separately from Studio.",
      },
    ],
  },
  {
    title: "Workflow X-Ray resources",
    description:
      "Understand how SolveLang turns a messy process into a readable workflow map before production automation is wired.",
    links: [
      {
        label: "Workflow X-Ray Audit Intake",
        href: "/audit/",
        note: "Send one messy workflow and the details needed for an audit.",
      },
      {
        label: "GitHub repository",
        href: "https://github.com/saiidz/solvelang",
        note: "Inspect the current language runtime, examples, and docs.",
      },
    ],
  },
  {
    title: "Demos",
    description:
      "See one concrete founder/operator workflow mapped from messy input to clear outputs.",
    links: [
      {
        label: "Support Triage Demo",
        href: "/demo/support-triage/",
        note: "A support inbox triage workflow with map, script, and outputs.",
      },
    ],
  },
  {
    title: "Local runtime and browser preview",
    description:
      "Try the browser-safe preview or inspect the local Rust runtime in the repository.",
    links: [
      {
        label: "Browser Preview",
        href: "/run/",
        note: "Runs a smaller safe subset in the browser without calling a server.",
      },
      {
        label: "GitHub repository",
        href: "https://github.com/saiidz/solvelang",
        note: "Use the Rust CLI locally for the fuller early runtime.",
      },
    ],
  },
  {
    title: "Sales/audit resources",
    description:
      "Resources for understanding the first service offer: one Workflow X-Ray Audit for one messy workflow.",
    links: [
      {
        label: "Workflow X-Ray Audit Intake",
        href: "/audit/",
        note: "Use this page when sending a workflow to hello@solve-lang.com.",
      },
      {
        label: "Support Triage Demo",
        href: "/demo/support-triage/",
        note: "Use this first when someone needs context before sending a workflow.",
      },
    ],
  },
  {
    title: "Crawlability / AI discovery files",
    description:
      "Machine-readable files that help search engines and AI assistants understand the public site.",
    links: [
      {
        label: "Sitemap",
        href: "/sitemap.xml",
        note: "Public XML sitemap for the main static pages.",
      },
      {
        label: "Robots",
        href: "/robots.txt",
        note: "Crawl policy and sitemap location.",
      },
      {
        label: "LLMs",
        href: "/llms.txt",
        note: "AI-facing summary of SolveLang, key pages, and current boundaries.",
      },
    ],
  },
];

export default function ResourcesPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Resources
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            SolveLang resources for workflow mapping and AI discovery.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 sm:text-xl">
            SolveLang is early beta. Use these resources to understand the
            workflow-mapping model before production automation is wired.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2">
          {resourceGroups.map((group) => (
            <section
              key={group.title}
              className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm"
            >
              <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{group.description}</p>

              <div className="mt-8 space-y-4">
                {group.links.map((link) => {
                  const external = link.href.startsWith("https://");

                  return (
                    <Link
                      key={`${group.title}-${link.href}-${link.label}`}
                      href={link.href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noreferrer" : undefined}
                      className="block rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-0.5 hover:bg-white"
                    >
                      <span className="text-lg font-semibold text-slate-950">
                        {link.label}
                      </span>
                      <span className="mt-2 block leading-7 text-slate-600">
                        {link.note}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
