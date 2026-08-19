const GATEWAY_PREFIX = "/admin-gateway";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
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
    return json(404, { error: "Admin UI is not published.", code: "admin_static_not_published" });
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
