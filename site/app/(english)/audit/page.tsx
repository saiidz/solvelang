import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../../components/JsonLd";
import { WorkflowAuditAgent } from "./WorkflowAuditAgent";

export const metadata: Metadata = {
  title: "Workflow Audit",
  description: "Describe a workflow directly in SolveLang and inspect a local rule-based map of triggers, tools, proposed actions and review boundaries. No email handoff or external execution.",
};
const breadcrumb = {
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://www.solve-lang.com/" },
    { "@type": "ListItem", position: 2, name: "Workflow Audit", item: "https://www.solve-lang.com/audit/" },
  ],
};
const outputs = [
  ["Trigger", "Identify the stated starting event without treating a later email action as the input."],
  ["Tools", "List explicitly mentioned providers, without pretending that they are connected."],
  ["Proposed actions", "Separate task creation, replies, notifications, ownership, and sensitive changes."],
  ["Review cues", "Surface sensitive terms independently from the suggested routing category. Unknown risk stays unknown."],
  ["Printable plan", "Generate a SolveLang script that prints the proposed map; it does not perform the external actions."],
  ["Local export", "Copy the planning script or export its structured result without sending a request to our inbox."],
];
export default function AuditPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <JsonLd id="audit-breadcrumb-json-ld" data={breadcrumb} />
      <section className="border-b border-line bg-panel">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Workflow audit · interactive preview</p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">Map the workflow here. Skip the email handoff.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted">Describe the process and the proposed map updates automatically. This is a local, rule-based planning tool—not a connected autonomous agent or a security assessment.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#audit-agent" className="rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-ink hover:bg-accent-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Map my workflow</a>
            <Link href="/demo/support-triage/" className="rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold hover:bg-panel-alt">Try support triage</Link>
            <Link href="/run/" className="rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold hover:bg-panel-alt">Open Browser Preview</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8"><WorkflowAuditAgent /></section>
      <section className="border-y border-line bg-panel">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
          <h2 className="text-3xl font-semibold tracking-tight">A proposed map you can inspect and export.</h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted">Simple English-language rules cannot verify every instruction, negation or risk. Review their suggestions and clarify missing details; the preview never marks a workflow authorized to run.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{outputs.map(([title, text]) => <article key={title} className="rounded-3xl border border-line p-6"><h3 className="text-lg font-semibold">{title}</h3><p className="mt-3 leading-7 text-muted">{text}</p></article>)}</div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="rounded-3xl bg-canvas p-7 text-ink sm:p-10">
          <h2 className="text-3xl font-semibold tracking-tight">Planning is automatic. Live execution is separate.</h2>
          <p className="mt-5 max-w-4xl leading-8 text-body">A production workflow needs an authenticated source, an approved routing policy, permitted destinations, duplicate-event protection, an audit trail and a working stop control. Routine actions can follow that approved policy; sensitive changes must preserve their own authorization boundaries. This preview does not provision or activate any of those connections.</p>
          <Link href="/about/" className="mt-6 inline-flex rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold hover:bg-panel-alt">See current capabilities</Link>
        </div>
      </section>
    </main>
  );
}
