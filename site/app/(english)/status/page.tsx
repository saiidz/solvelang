import type { Metadata } from "next";
import { statusPage, type StatusIncident } from "./status-data";
import { isCurrentIncident } from "./status-health";
import { StatusHealth } from "./StatusHealth";

export const metadata: Metadata = { title: "System status", description: "Dated SolveLang configuration evidence, current monitoring limitations, and preserved incident history." };
function formatUtc(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)); }

function Incident({ incident }: { incident: StatusIncident }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{incident.state} · {incident.impact} impact</p>
      <h3 className="mt-3 text-xl font-semibold">{incident.title}</h3>
      <p className="mt-2 text-sm text-slate-600">Started {formatUtc(incident.startedAt)} UTC</p>
      {incident.resolvedAt ? <p className="mt-2 text-sm text-slate-600">Resolved {formatUtc(incident.resolvedAt)} UTC</p> : null}
      {incident.archiveNote ? <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-700">{incident.archiveNote}</p> : null}
      {incident.external ? <a href={incident.external.statusUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-lg font-semibold text-blue-700 underline focus-visible:outline focus-visible:outline-2">{incident.external.provider} status ↗</a> : null}
      <div className="mt-5 divide-y divide-slate-200">
        {incident.updates.map((update) => <div key={update.timestamp} className="py-4"><p className="text-xs font-semibold text-slate-600">{formatUtc(update.timestamp)} UTC — historical update</p><p className="mt-2 text-sm leading-7 text-slate-700">{update.message}</p></div>)}
      </div>
    </article>
  );
}

export default function StatusPage() {
  const active = statusPage.incidents.filter(isCurrentIncident);
  const history = statusPage.incidents.filter((incident) => !isCurrentIncident(incident));
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="border-b border-slate-200 pb-8">
          <p className="text-sm font-semibold text-blue-700">SolveLang operations</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">System status</h1>
          <p className="mt-5 max-w-3xl leading-7 text-slate-600">Configuration evidence and incident records are separate from live service health. This page is a manual report, not an uptime monitor.</p>
          <div className="mt-5"><StatusHealth components={statusPage.components} /></div>
        </div>
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Reporting mode: manual</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">No independent uptime percentages or SLA history are published. A successful deployment or an enabled feature is not evidence of continuing availability. Missing, future-dated, or expired health observations are shown as unverified, never green.</p>
          <p className="mt-3 text-sm text-slate-600">Report revised <time dateTime={statusPage.lastUpdated}>{formatUtc(statusPage.lastUpdated)} UTC</time>. This is not a last-seen heartbeat.</p>
        </section>
        <section className="mt-10" aria-labelledby="components-heading">
          <h2 id="components-heading" className="text-2xl font-semibold">Components and documented configuration</h2>
          <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white">
            {statusPage.components.map((component) => <article key={component.name} className="p-6"><h3 className="text-lg font-semibold">{component.name}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{component.description}</p><p className="mt-3 text-sm leading-7 text-slate-700">{component.note}</p><div className="mt-4"><StatusHealth component={component} /></div></article>)}
          </div>
        </section>
        <section className="mt-12" aria-labelledby="active-heading">
          <h2 id="active-heading" className="text-2xl font-semibold">Current incident reports</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">This is a manual register, not an automatic detection service.</p>
          <div className="mt-5 space-y-5">{active.length ? active.map((incident) => <Incident key={incident.id} incident={incident} />) : <p className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-7 text-slate-600">No current incident report is recorded in this snapshot. This does not establish that every component is operational.</p>}</div>
        </section>
        <section className="mt-12" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-2xl font-semibold">Historical incident records</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Records are preserved. Archiving an old observation does not invent its resolution time or imply that it is a current outage.</p>
          <div className="mt-5 space-y-5">{history.map((incident) => <Incident key={incident.id} incident={incident} />)}</div>
        </section>
        <section className="mt-12 rounded-3xl bg-slate-950 p-7 text-white"><h2 className="text-2xl font-semibold">No invented reliability metrics.</h2><p className="mt-4 text-sm leading-7 text-slate-300">Public availability claims require measured evidence. Billing, credentials, provider activation, and live canaries remain independently controlled; changing this report never enables them.</p></section>
      </div>
    </main>
  );
}
