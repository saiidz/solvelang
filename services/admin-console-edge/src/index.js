const GATEWAY_PREFIX = "/admin-gateway";
const STATIC_ASSET_PATHS = new Set(["/", "/index.html", "/styles.css", "/config.js", "/app.js"]);
const STATIC_CSP = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...extraHeaders,
    },
  });
}

function stripCloudflareAccessCookie(headers) {
  const cookie = headers.get("cookie");
  if (!cookie) return;
  const filtered = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("CF_Authorization="));
  if (filtered.length) headers.set("cookie", filtered.join("; "));
  else headers.delete("cookie");
}

function upstreamTarget(requestUrl, upstreamBase) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(upstreamBase);
  const suffix = incoming.pathname.slice(GATEWAY_PREFIX.length);
  upstream.pathname = `${upstream.pathname.replace(/\/$/, "")}${suffix}`;
  upstream.search = incoming.search;
  upstream.hash = "";
  return upstream;
}

function hardenStaticResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-cache");
  headers.set("content-security-policy", STATIC_CSP);
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serveReviewedStaticAsset(request, env) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return json(404, { error: "Admin UI is not published.", code: "admin_static_not_published" });
  }

  const incoming = new URL(request.url);
  if (!STATIC_ASSET_PATHS.has(incoming.pathname)) {
    return json(404, { error: "Not found.", code: "not_found" });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(405, { error: "Method not allowed.", code: "method_not_allowed" }, { allow: "GET, HEAD" });
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = incoming.pathname === "/" ? "/index.html" : incoming.pathname;
  assetUrl.search = "";
  assetUrl.hash = "";

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("cf-access-jwt-assertion");

  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    method: request.method,
    headers,
  }));

  if (assetResponse.status !== 200) {
    return json(503, { error: "Admin UI asset unavailable.", code: "admin_static_unavailable" });
  }

  return hardenStaticResponse(assetResponse);
}

export async function handleAdminIngress(request, env, fetchImpl = fetch) {
  const adminOrigin = String(env.ADMIN_ORIGIN || "");
  const gatewayUpstream = String(env.ADMIN_GATEWAY_UPSTREAM || "");
  if (!/^https:\/\//.test(adminOrigin) || !/^https:\/\//.test(gatewayUpstream)) {
    return json(503, { error: "Private admin ingress is not configured.", code: "ingress_unconfigured" });
  }

  const expected = new URL(adminOrigin);
  const incoming = new URL(request.url);
  if (incoming.protocol !== "https:" || incoming.hostname !== expected.hostname) {
    return json(404, { error: "Not found.", code: "not_found" });
  }

  const isGatewayPath = incoming.pathname === GATEWAY_PREFIX || incoming.pathname.startsWith(`${GATEWAY_PREFIX}/`);
  if (!isGatewayPath) {
    return serveReviewedStaticAsset(request, env);
  }

  const presentedOrigin = request.headers.get("origin");
  if (presentedOrigin && presentedOrigin !== adminOrigin) {
    return json(403, { error: "Origin denied.", code: "origin_denied" });
  }

  const headers = new Headers(request.headers);
  headers.set("origin", adminOrigin);
  headers.delete("host");
  headers.delete("cf-access-jwt-assertion");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  stripCloudflareAccessCookie(headers);

  const target = upstreamTarget(request.url, gatewayUpstream);
  const upstreamRequest = new Request(target.toString(), request);
  const sanitizedRequest = new Request(upstreamRequest, { headers });
  const upstreamResponse = await fetchImpl(sanitizedRequest);

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-robots-tag", "noindex, nofollow, noarchive");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export default {
  fetch(request, env) {
    return handleAdminIngress(request, env);
  },
};
