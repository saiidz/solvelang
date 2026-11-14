"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { statusPage, type ComponentState } from "./status-data";
import { observedState, overallState } from "./status-health";
import { fetchStatusObservations, type StatusObservations } from "./status-live";

const API_BASE = process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL;
const labels: Record<ComponentState, string> = {
  operational: "Operational — recent observation", degraded: "Degraded performance",
  partial_outage: "Partial outage", major_outage: "Major outage", maintenance: "Maintenance",
  not_monitored: "Current health not fully verified",
};
const tones: Record<ComponentState, string> = {
  operational: "border-success bg-success-soft text-success",
  degraded: "border-warning bg-warning-soft text-warning",
  partial_outage: "border-orange-200 bg-orange-50 text-orange-800",
  major_outage: "border-danger bg-danger-soft text-danger",
  maintenance: "border-accent bg-accent-soft text-accent",
  not_monitored: "border-line bg-panel-alt text-body",
};
function subscribe(tick: () => void) {
  const timer = window.setInterval(tick, 1000);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
}
const getSnapshot = () => Math.floor(Date.now() / 1000) * 1000;
const getServerSnapshot = () => 0;

function useLiveStatus() {
  const [observations, setObservations] = useState<StatusObservations>({});
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    let mounted = true;
    function refresh() {
      const current = ++request.current;
      setObservations({});
      void fetchStatusObservations(API_BASE).then((fresh) => {
        if (mounted && current === request.current) { setObservations(fresh); setLoading(false); }
      });
    }
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const current = statusPage.components.map(({ id }) => observations[id]);
  return { observations, now, loading, overall: overallState(current, now) };
}

function StatusBadge({ state }: { state: ComponentState }) {
  return <span data-health-state={state} className={`inline-flex w-fit rounded-xl border px-3 py-2 text-xs font-semibold ${tones[state]}`}>{labels[state]}</span>;
}

export function StatusDashboard() {
  const { observations, now, loading, overall } = useLiveStatus();
  return <section className="mt-10" aria-labelledby="components-heading">
    <h2 id="components-heading" className="text-2xl font-semibold">Current observations and component boundaries</h2>
    <div className="mt-4" aria-live="polite"><StatusBadge state={overall} />{loading ? <span className="ml-3 text-sm text-muted">Live check has not completed yet — treat status as unverified.</span> : null}</div>
    <div className="mt-5 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-panel">
      {statusPage.components.map((component) => {
        const observation = component.monitored ? observations[component.id] : undefined;
        const state = observedState(observation, now);
        return <article key={component.id} className="p-6"><h3 className="text-lg font-semibold">{component.name}</h3><p className="mt-2 text-sm leading-6 text-muted">{component.description}</p><p className="mt-3 text-sm leading-7 text-body">{component.note}</p><p className="mt-3 text-xs font-semibold text-muted">{component.monitored ? "Live public read-only check" : "Not independently monitored"}</p><div className="mt-3"><StatusBadge state={state} /></div>{observation ? <p className="mt-2 text-xs text-muted">Check attempted <time dateTime={observation.checkedAt}>{new Date(observation.checkedAt).toLocaleString("en", { timeZone: "UTC" })} UTC</time>; observation valid for up to {Math.floor(observation.validForMs / 1000)} seconds.{state === "not_monitored" ? " This check is unavailable or expired." : ""}</p> : null}</article>;
      })}
    </div>
  </section>;
}

export function StatusSummary() {
  const { overall } = useLiveStatus();
  return <div className="mt-8 flex flex-wrap items-center gap-4 rounded-xl border border-line-strong bg-panel p-5 text-ink" aria-live="polite">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-[#93b6df]">Current public status</p><p className="mt-2 text-sm">{labels[overall]}</p></div>
    <Link href="/status/" className="ml-auto text-sm font-semibold text-[#a9cdff] underline underline-offset-4 hover:text-ink">View system status →</Link>
  </div>;
}
