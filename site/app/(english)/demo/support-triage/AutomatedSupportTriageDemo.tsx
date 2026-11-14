import Link from "next/link";
import { PlanningPreview } from "../../../components/PlanningPreview";

export default function AutomatedSupportTriageDemo() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <section className="border-b border-line bg-panel">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Support triage · interactive preview</p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">See the next support step. No email setup required.</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted">Type a sample message and explore a suggested category, urgency signal, owner, reply and action plan. Results update locally using simple rules. No customer has been contacted and no task is actually queued.</p>
          <div className="mt-8 flex flex-wrap gap-3"><a href="#support-preview" className="rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-ink hover:bg-accent-solid">Try the preview</a><Link href="/audit/" className="rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold hover:bg-panel-alt">Map the whole workflow</Link></div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8"><PlanningPreview mode="support" /></section>
      <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight">What changes when an inbox is connected?</h2>
        <p className="mt-5 max-w-4xl leading-8 text-muted">The intended production flow is automatic ingestion, policy-based triage and authorized task or reply handling, with durable duplicate protection and an audit trail. That live integration is a separate implementation and activation step—not something this demo silently turns on.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">{[["Source identity", "Receive only events from the approved inbox and verify their identity."], ["Scoped policy", "Apply explicit ownership and allowed-action rules; do not treat keyword guesses as permission."], ["Accountable actions", "Record actual provider results and stop safely on uncertain, duplicated or unauthorized actions."]].map(([title, text]) => <article key={title} className="rounded-3xl border border-line bg-panel p-6"><h3 className="text-lg font-semibold">{title}</h3><p className="mt-3 leading-7 text-muted">{text}</p></article>)}</div>
      </section>
    </main>
  );
}
