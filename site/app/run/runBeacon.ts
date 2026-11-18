import { normalizeApiBase } from "../account/core/customer-api";

export type RunBeaconEvent = "start" | "complete";

type RunBeaconFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    keepalive: boolean;
  },
) => Promise<unknown>;

// The playground beacon reports that a run started or finished — the
// request body is the event name and nothing else: no code, no output,
// no identifiers, no storage. It is fire-and-forget by design; a failed
// beacon must never surface in, slow down, or break the run it counts.
export function createRunBeaconSender({
  apiBase,
  fetchImpl,
}: {
  apiBase: string;
  fetchImpl: RunBeaconFetch;
}): (event: RunBeaconEvent) => void {
  return (event) => {
    try {
      if (!apiBase) return;
      const pending = fetchImpl(`${apiBase}/telemetry/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
        keepalive: true,
      });
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      // The beacon stays silent on every failure.
    }
  };
}

function defaultApiBase(): string {
  try {
    return normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);
  } catch {
    return "";
  }
}

export const sendRunBeacon: (event: RunBeaconEvent) => void = createRunBeaconSender({
  apiBase: defaultApiBase(),
  fetchImpl: (url, init) => fetch(url, init),
});
