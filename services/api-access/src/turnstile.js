import { randomUUID } from "node:crypto";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Server-side Cloudflare Turnstile verification for the public auth routes,
// mirroring services/entitlements: the token, the client IP and a fresh
// idempotency key go to the canonical siteverify endpoint, and the result
// must be a success for this hostname and the expected action. Every
// failure — missing token, network error, timeout, malformed reply,
// hostname/action mismatch — returns false (fail closed): the caller then
// sends nothing and creates nothing.
export function createTurnstileVerifier({ secret, expectedHostname, fetchImpl = fetch, createIdempotencyKey = randomUUID } = {}) {
  if (typeof secret !== "string" || !secret) throw new Error("Turnstile secret is required.");
  if (typeof expectedHostname !== "string" || !expectedHostname) throw new Error("Turnstile expected hostname is required.");
  return {
    async verify({ token, remoteIp, expectedAction } = {}) {
      if (typeof token !== "string" || !token || token.length > 2_048) return false;
      try {
        const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret,
            response: token,
            ...(remoteIp ? { remoteip: remoteIp } : {}),
            idempotency_key: createIdempotencyKey(),
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return false;
        const result = await response.json().catch(() => null);
        return Boolean(result?.success) && result.hostname === expectedHostname && result.action === expectedAction;
      } catch {
        return false;
      }
    },
  };
}
