const PROBE_TIMEOUT_MS = 2_500;
const VALID_FOR_MS = 90_000;
const CACHE_MS = 20_000;
const MAX_BODY_BYTES = 128 * 1024;

const pages = [
  { id: "website", path: "/", marker: "See exactly what Solve can do" },
  { id: "studio-page", path: "/studio/", marker: "Workflow Intelligence Studio" },
  { id: "browser-preview", path: "/run/", marker: "Browser preview" },
  { id: "repository-audit-page", path: "/repository-audit/", marker: "Repository Audit" },
  { id: "solve-graph-page", path: "/solve-graph/", marker: "Solve Graph" },
];

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
  } finally {
    await reader.cancel().catch(() => {});
  }
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
    return { state: valid ? "operational" : "not_monitored", checkedAt: new Date(now()).toISOString(), validForMs: VALID_FOR_MS };
  } catch {
    return { state: "not_monitored", checkedAt: new Date(now()).toISOString(), validForMs: VALID_FOR_MS };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function publicApiHealthUrl(event) {
  const { apiId, domainName } = event?.requestContext ?? {};
  if (typeof apiId !== "string" || typeof domainName !== "string") return undefined;
  if (!/^[a-z0-9]+$/.test(apiId) || !new RegExp(`^${apiId}\\.execute-api\\.[a-z0-9-]+\\.amazonaws\\.com$`).test(domainName)) return undefined;
  return `https://${domainName}/health`;
}

export function createPublicStatusSource({ siteOrigin, fetchImpl = fetch, now = Date.now, timeoutMs = PROBE_TIMEOUT_MS }) {
  const origin = new URL(siteOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Public status origin must be an HTTPS origin.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PROBE_TIMEOUT_MS) throw new Error("Public status probe timeout is invalid.");
  let cache;
  return async function publicStatus(apiHealthUrl) {
    const key = apiHealthUrl || "";
    if (cache?.key === key && now() - cache.at < CACHE_MS) return cache.value;
    const pending = Promise.all([
      ...pages.map(({ id, path, marker }) => probe(new URL(path, origin), "html", marker, fetchImpl, now, timeoutMs).then((observation) => [id, observation])),
      apiHealthUrl
        ? probe(apiHealthUrl, "json", "", fetchImpl, now, timeoutMs).then((observation) => ["api-health", observation])
        : Promise.resolve(["api-health", { state: "not_monitored", checkedAt: new Date(now()).toISOString(), validForMs: VALID_FOR_MS }]),
    ]).then((entries) => ({ observations: Object.fromEntries(entries) }));
    cache = { key, at: now(), value: pending };
    return pending;
  };
}
