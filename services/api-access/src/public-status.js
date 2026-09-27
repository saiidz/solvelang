const PROBE_TIMEOUT_MS = 2_500;
export const STATUS_VALID_FOR_MS = 90_000;
export const REFRESH_INTERVAL_MS = 55_000;
const MAX_BODY_BYTES = 128 * 1024;

const pages = [
  { id: "website", path: "/", marker: "See exactly what Solve can do" },
  { id: "studio-page", path: "/studio/", marker: "Workflow Intelligence Studio" },
  { id: "browser-preview", path: "/run/", marker: "Browser preview" },
  { id: "repository-audit-page", path: "/repository-audit/", marker: "Repository Audit" },
  { id: "solve-graph-page", path: "/solve-graph/", marker: "Solve Graph" },
];
const ids = [...pages.map(({ id }) => id), "api-health"];
const states = new Set(["operational", "degraded", "partial_outage", "major_outage", "maintenance", "not_monitored"]);

export const unverifiedPublicStatus = () => ({ observations: {} });

// Only fixed public component IDs and observation fields cross the storage/response boundary.
export function sanitizedPublicStatus(snapshot, at) {
  const collectedAt = Date.parse(snapshot?.collectedAt ?? "");
  if (!Number.isFinite(at) || !Number.isFinite(collectedAt) || collectedAt > at || at - collectedAt >= STATUS_VALID_FOR_MS) return unverifiedPublicStatus();
  const raw = snapshot?.observations;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unverifiedPublicStatus();
  const observations = {};
  for (const id of ids) {
    const value = raw[id];
    const checkedAt = Date.parse(value?.checkedAt ?? "");
    if (!states.has(value?.state) || !Number.isFinite(checkedAt) || checkedAt > at
      || !Number.isSafeInteger(value.validForMs) || value.validForMs <= 0 || value.validForMs > STATUS_VALID_FOR_MS
      || at - checkedAt >= value.validForMs) return unverifiedPublicStatus();
    observations[id] = { state: value.state, checkedAt: new Date(checkedAt).toISOString(), validForMs: value.validForMs };
  }
  return { observations };
}

async function boundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) return "";
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function probe(url, kind, marker, fetchImpl, now, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    const body = await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: kind === "json" ? "application/json" : "text/html" } });
        if (response.status !== 200 || !response.headers.get("content-type")?.includes(kind === "json" ? "application/json" : "text/html")) return "";
        return boundedText(response);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs); }),
    ]);
    const valid = kind === "json"
      ? (() => { try { const data = JSON.parse(body); return data.status === "ok" && data.service === "solvelang-api-access"; } catch { return false; } })()
      : body.includes(marker);
    return { state: valid ? "operational" : "not_monitored", checkedAt: new Date(now()).toISOString(), validForMs: STATUS_VALID_FOR_MS };
  } catch {
    return { state: "not_monitored", checkedAt: new Date(now()).toISOString(), validForMs: STATUS_VALID_FOR_MS };
  } finally { clearTimeout(timer); controller.abort(); }
}

export function createPublicStatusCollector({ siteOrigin, apiHealthUrl, fetchImpl = fetch, now = Date.now, timeoutMs = PROBE_TIMEOUT_MS }) {
  const origin = new URL(siteOrigin);
  const api = new URL(apiHealthUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Public status origin must be an HTTPS origin.");
  }
  if (api.protocol !== "https:" || api.username || api.password || api.pathname !== "/health" || api.search || api.hash
    || !/^[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(api.hostname)) {
    throw new Error("Public API health URL is invalid.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PROBE_TIMEOUT_MS) throw new Error("Public status probe timeout is invalid.");
  return async function collect(startedAt = now()) {
    const entries = await Promise.all([
      ...pages.map(({ id, path, marker }) => probe(new URL(path, origin), "html", marker, fetchImpl, now, timeoutMs).then((observation) => [id, observation])),
      probe(api, "json", "", fetchImpl, now, timeoutMs).then((observation) => ["api-health", observation]),
    ]);
    return { collectedAt: new Date(startedAt).toISOString(), observations: Object.fromEntries(entries) };
  };
}

export async function refreshPublicStatus({ store, collect, now = Date.now }) {
  const startedAt = now();
  if (!await store.acquireRefreshLease(startedAt)) return { refreshed: false };
  const snapshot = await collect(startedAt);
  return { refreshed: await store.writeSnapshot(snapshot) };
}
