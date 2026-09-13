import type { ComponentState, ComponentStatus, StatusIncident } from "./status-data";

export const MAX_HEALTH_AGE_MS = 15 * 60 * 1000;
const outageStates: ComponentState[] = ["major_outage", "partial_outage", "degraded", "maintenance"];

export function observedState(component: ComponentStatus, now: number): ComponentState {
  const observedAt = Date.parse(component.checkedAt || "");
  const validity = component.validForMs;
  if (component.state === "not_monitored" || !Number.isFinite(now) || !Number.isFinite(observedAt)
    || validity === undefined || !Number.isFinite(validity) || validity <= 0
    || observedAt > now || now - observedAt >= Math.min(validity, MAX_HEALTH_AGE_MS)) return "not_monitored";
  return component.state;
}

export function overallState(components: readonly ComponentStatus[], now: number): ComponentState {
  const states = components.map((component) => observedState(component, now));
  for (const state of outageStates) if (states.includes(state)) return state;
  if (!states.length || states.includes("not_monitored")) return "not_monitored";
  return "operational";
}

export function isCurrentIncident(incident: StatusIncident): boolean {
  return incident.state !== "archived" && incident.state !== "resolved";
}
