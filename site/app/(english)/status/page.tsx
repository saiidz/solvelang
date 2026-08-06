import type { Metadata } from "next";
import Link from "next/link";
import { statusPage, type ComponentState } from "./status-data";

export const metadata: Metadata = {
  title: "SolveLang Status",
  description:
    "Current SolveLang component status, known incidents, upstream dependency impact, and reporting limitations.",
};

const stateLabels: Record<ComponentState, string> = {
  operational: "Operational",
  degraded: "Degraded performance",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
  maintenance: "Maintenance",
  not_monitored: "Manual reporting",
};

const stateStyles: Record<ComponentState, string> = {
  operational: "border-emerald-200 bg-emerald-50 text-emerald-800",
  degraded: "border-amber-200 bg-amber-50 text-amber-800",
  partial_outage: "border-orange-200 bg-orange-50 text-orange-800",
  major_outage: "border-red-200 bg-red-50 text-red-800",
  maintenance: "border-blue-200 bg-blue-50 text-blue-800",
  not_monitored: "border-slate-200 bg-slate-50 text-slate-700",
};

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function overallState(components: typeof statusPage.components): ComponentState {
  const priority: ComponentState[] = [
    "major_outage",
    "partial_outage",
    "degraded",
    "maintenance",
    "operational",
    "not_monitored",
  ];

  for (const state of priority) {
    if (components.some((component) => component.state === state)) return state;
  }

  return "not_monitored";
}

export default function StatusPage() {
  const overall = overallState(statusPage.components);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16 lg:px-8">
        <header className="flex flex-col gap-6 border-b border-slate-200 pb-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-semibold text-slate-500 hover:text-slate-900">
              SolveLang
            </Link>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              System status
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Current component health, incident updates, upstream dependency impact, and the limits of what SolveLang monitors today.
            </p>
          </div>

          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${stateStyles[overall]}`}>
            {stateLabels[overall]}
          </div>
        </header>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Reporting mode</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Manual. SolveLang does not yet publish independently measured uptime percentages or SLA history.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Updated {formatUtc(statusPage.lastUpdated)} UTC
            </p>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Components
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Service health</h2>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            {statusPage.components.map((component, index) => (
              <div
                key={component.name}
                className={`grid gap-4 p-6 sm:grid-cols-[1fr_auto] sm:items-start ${
                  index > 0 ? "border-t border-slate-200" : ""
                }`}
              >
                <div>
                  <h3 className="text-base font-semibold text-slate-950">{component.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{component.description}</p>
                  {component.note ? (
                    <p className="mt-2 text-sm leading-6 text-slate-500">{component.note}</p>
                  ) : null}
                </div>
                <span
                  className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${stateStyles[component.state]}`}
                >
                  {stateLabels[component.state]}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Incidents
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Current incident history</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Only incidents that are actually recorded by SolveLang are shown. Historical uptime is not backfilled or fabricated.
            </p>
          </div>

          <div className="space-y-6">
            {statusPage.incidents.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                No recorded incidents.
              </div>
            ) : (
              statusPage.incidents.map((incident) => (
                <article key={incident.id} className="rounded-3xl border border-amber-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                          {incident.state} · {incident.impact} impact
                        </p>
                        <h3 className="mt-2 text-xl font-semibold">{incident.title}</h3>
                        <p className="mt-2 text-sm text-slate-500">
                          Started {formatUtc(incident.startedAt)} UTC
                        </p>
                      </div>
                      {incident.external ? (
                        <a
                          href={incident.external.statusUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="w-fit rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                        >
                          {incident.external.provider} status ↗
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {incident.updates.map((update) => (
                      <div key={update.timestamp} className="grid gap-3 p-6 sm:grid-cols-[170px_1fr]">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {formatUtc(update.timestamp)} UTC
                        </p>
                        <p className="text-sm leading-6 text-slate-700">{update.message}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-slate-200 bg-slate-950 p-7 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Status policy</p>
          <h2 className="mt-3 text-2xl font-semibold">No invented reliability metrics.</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            SolveLang will publish uptime percentages only after independent monitoring is connected and enough real history exists. Experimental or test-mode components remain labeled as such even when their current tests pass.
          </p>
        </section>
      </div>
    </main>
  );
}
