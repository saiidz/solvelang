import { ApiAccessError } from "./service.js";

// The playground run beacon counts anonymous run starts and completions
// — never code, output, or anything about the visitor. The payload
// contract is deliberately a single field: anything beyond the event
// name is rejected, so the endpoint cannot be repurposed to carry
// content.
export const RUN_TELEMETRY_EVENTS = ["start", "complete"];

export function runEventFromBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiAccessError(400, "invalid_run_event", "Invalid run event.");
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "event" || !RUN_TELEMETRY_EVENTS.includes(body.event)) {
    throw new ApiAccessError(400, "invalid_run_event", "Invalid run event.");
  }
  return body.event;
}

export function emptyRunCounts() {
  return { totalStart: 0, totalComplete: 0, todayStart: 0, todayComplete: 0 };
}

function countOf(item, field) {
  const value = item?.[field];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function runCountsFromItems(allItem, todayItem) {
  return {
    totalStart: countOf(allItem, "start"),
    totalComplete: countOf(allItem, "complete"),
    todayStart: countOf(todayItem, "start"),
    todayComplete: countOf(todayItem, "complete"),
  };
}
