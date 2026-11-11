import type { Metadata } from "next";
import { statusPage, type StatusIncident } from "./status-data";
import { isCurrentIncident } from "./status-health";
import { StatusDashboard } from "./StatusHealth";

export const metadata: Metadata = { title: "System status", description: "Recent bounded public health observations, monitoring limits, and preserved incident history." };
function formatUtc(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)); }

function Incident({ incident }: { incident: StatusIncident }) {
  return (
    <article className="rounded-3xl border border-line bg-panel p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{incident.state} · {incident.impact} impact</p>
      <h3 className="mt-3 text-xl font-semibold">{incident.title}</h3>
      <p className="mt-2 text-sm text-muted">Started {formatUtc(incident.startedAt)} UTC</p>
      {incident.resolvedAt ? <p className="mt-2 text-sm text-muted">Resolved {formatUtc(incident.resolvedAt)} UTC</p> : null}
      {incident.archiveNote ? <p className="mt-4 rounded-xl bg-panel-alt p-4 text-sm leading-6 text-body">{incident.archiveNote}</p> : null}
      {incident.external ? <a href={incident.external.statusUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-lg font-semibold text-accent underline focus-visible:outline focus-visible:outline-2">{incident.external.provider} status ↗</a> : null}
      <div className="mt-5 divide-y divide-line">
        {incident.updates.map((update) => <div key={update.timestamp} className="py-4"><p className="text-xs font-semibold text-muted">{formatUtc(update.timestamp)} UTC — historical update</p><p className="mt-2 text-sm leading-7 text-body">{update.message}</p></div>)}
      </div>
    </article>
  );
}

export default function StatusPage() {
  const active = statusPage.incidents.filter(isCurrentIncident);
  const history = statusPage.incidents.filter((incident) => !isCurrentIncident(incident));
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="border-b border-line pb-8">
          <p className="text-sm font-semibold text-accent">SolveLang operations</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">System status</h1>
          <p className="mt-5 max-w-3xl leading-7 text-muted">Recent public health observations, capability evidence, and manually curated incidents are separate. A page response does not verify customer-specific behavior.</p>
        </div>
        <section className="mt-8 rounded-3xl border border-line bg-panel p-6">
          <h2 className="text-lg font-semibold">Reporting mode: live observations + manual incident history</h2>
          <p className="mt-3 text-sm leading-7 text-muted">Public read-only checks are bounded snapshots, not an SLA. They expire; missing, failed, future-dated, or expired observations become unverified. Incident history remains manually curated. No uptime percentage is inferred.</p>
          <p className="mt-3 text-sm text-muted">Incident record last revised <time dateTime={statusPage.lastUpdated}>{formatUtc(statusPage.lastUpdated)} UTC</time>. This is not a last-seen heartbeat.</p>
        </section>
        <StatusDashboard />
        <section className="mt-12" aria-labelledby="active-heading">
          <h2 id="active-heading" className="text-2xl font-semibold">Current incident reports</h2>
          <p className="mt-3 text-sm leading-6 text-muted">This is a manual register, not an automatic detection service.</p>
          <div className="mt-5 space-y-5">{active.length ? active.map((incident) => <Incident key={incident.id} incident={incident} />) : <p className="rounded-3xl border border-line bg-panel p-6 text-sm leading-7 text-muted">No current incident report is recorded in this snapshot. This does not establish that every component is operational.</p>}</div>
        </section>
        <section className="mt-12" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-2xl font-semibold">Historical incident records</h2>
          <p className="mt-3 text-sm leading-6 text-muted">Records are preserved. Archiving an old observation does not invent its resolution time or imply that it is a current outage.</p>
          <div className="mt-5 space-y-5">{history.map((incident) => <Incident key={incident.id} incident={incident} />)}</div>
        </section>
        <section className="mt-12 rounded-3xl bg-canvas p-7 text-ink"><h2 className="text-2xl font-semibold">No invented reliability metrics.</h2><p className="mt-4 text-sm leading-7 text-body">Public availability claims require measured evidence. Billing, credentials, provider activation, and live canaries remain independently controlled; changing this report never enables them.</p></section>
      </div>
    </main>
  );
}
