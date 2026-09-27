import type { ComponentState, HealthObservation, StatusIncident } from "./status-data";

export const MAX_HEALTH_AGE_MS = 15 * 60 * 1000;
const outageStates: ComponentState[] = ["major_outage", "partial_outage", "degraded", "maintenance"];

export function observedState(observation: HealthObservation | undefined, now: number): ComponentState {
  if (!observation) return "not_monitored";
  const observedAt = Date.parse(observation.checkedAt || "");
  const validity = observation.validForMs;
  if (observation.state === "not_monitored" || !Number.isFinite(now) || !Number.isFinite(observedAt)
    || validity === undefined || !Number.isFinite(validity) || validity <= 0
    || observedAt > now || now - observedAt >= Math.min(validity, MAX_HEALTH_AGE_MS)) return "not_monitored";
  return observation.state;
}

export function overallState(observations: readonly (HealthObservation | undefined)[], now: number): ComponentState {
  const states = observations.map((observation) => observedState(observation, now));
  for (const state of outageStates) if (states.includes(state)) return state;
  if (!states.length || states.includes("not_monitored")) return "not_monitored";
  return "operational";
}

export function isCurrentIncident(incident: StatusIncident): boolean {
  return incident.state !== "archived" && incident.state !== "resolved";
}
