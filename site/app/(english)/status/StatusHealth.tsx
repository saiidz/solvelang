"use client";

import { useSyncExternalStore } from "react";
import type { ComponentState, ComponentStatus } from "./status-data";
import { observedState, overallState } from "./status-health";

const labels: Record<ComponentState, string> = {
  operational: "Operational — recent observation", degraded: "Degraded performance",
  partial_outage: "Partial outage", major_outage: "Major outage", maintenance: "Maintenance",
  not_monitored: "Current health not independently verified",
};
const tones: Record<ComponentState, string> = {
  operational: "border-emerald-200 bg-emerald-50 text-emerald-800",
  degraded: "border-amber-200 bg-amber-50 text-amber-800",
  partial_outage: "border-orange-200 bg-orange-50 text-orange-800",
  major_outage: "border-red-200 bg-red-50 text-red-800",
  maintenance: "border-blue-200 bg-blue-50 text-blue-800",
  not_monitored: "border-slate-200 bg-slate-100 text-slate-700",
};
function subscribe(tick: () => void) {
  const timer = window.setInterval(tick, 1000);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
}
const getSnapshot = () => Math.floor(Date.now() / 1000) * 1000;
const getServerSnapshot = () => 0;

export function StatusHealth({ components, component }: { components?: ComponentStatus[]; component?: ComponentStatus }) {
  // SSR is conservatively unknown. Client observations expire even when this static page stays open.
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = component ? observedState(component, now) : overallState(components || [], now);
  return <span data-health-state={state} className={`inline-flex w-fit rounded-xl border px-3 py-2 text-xs font-semibold ${tones[state]}`}>{labels[state]}</span>;
}
