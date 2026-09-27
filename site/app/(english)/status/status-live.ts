import { statusPage, type HealthObservation, type ComponentState } from "./status-data";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARS = 16_384;
const states: ComponentState[] = ["operational", "degraded", "partial_outage", "major_outage", "maintenance", "not_monitored"];
export type StatusObservations = Record<string, HealthObservation>;

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      body += decoder.decode(value, { stream: true });
      if (body.length > MAX_RESPONSE_CHARS) return "";
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function parseStatusObservations(payload: unknown): StatusObservations {
  if (!payload || typeof payload !== "object" || !("observations" in payload)) return {};
  const raw = payload.observations;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const observations: StatusObservations = {};
  for (const component of statusPage.components.filter(({ monitored }) => monitored)) {
    const candidate = (raw as Record<string, unknown>)[component.id];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
    const value = candidate as Record<string, unknown>;
    if (!states.includes(value.state as ComponentState) || typeof value.checkedAt !== "string"
      || !Number.isFinite(Date.parse(value.checkedAt)) || typeof value.validForMs !== "number"
      || !Number.isFinite(value.validForMs) || value.validForMs <= 0) return {};
    observations[component.id] = { state: value.state as ComponentState, checkedAt: value.checkedAt, validForMs: value.validForMs };
  }
  return observations;
}

export async function fetchStatusObservations(apiBase: string | undefined, fetchImpl: typeof fetch = fetch): Promise<StatusObservations> {
  if (!apiBase) return {};
  let url: URL;
  try {
    url = new URL("/public/status/health", apiBase);
    if (url.protocol !== "https:" || url.username || url.password) return {};
  } catch { return {}; }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
        if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) return "";
        return boundedBody(response);
      })(),
      new Promise<string>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, FETCH_TIMEOUT_MS); }),
    ]);
    return parseStatusObservations(JSON.parse(body));
  } catch { return {}; }
  finally { clearTimeout(timer); controller.abort(); }
}
