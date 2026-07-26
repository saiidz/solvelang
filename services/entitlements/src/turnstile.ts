import { randomUUID } from "node:crypto";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "checkout";

type SiteverifyResponse = {
  success: true;
  hostname: string;
  action: string;
};

export type TurnstileGateway = {
  verify(input: { token: string; remoteIp: string }): Promise<boolean>;
};

export type TurnstileGatewayOptions = {
  secret: string;
  expectedHostname: string;
  fetchImpl?: typeof fetch;
  createIdempotencyKey?: () => string;
};

function isSiteverifyResponse(value: unknown): value is SiteverifyResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.success === true && typeof result.hostname === "string" && typeof result.action === "string";
}

export function createTurnstileGateway({
  secret,
  expectedHostname,
  fetchImpl = fetch,
  createIdempotencyKey = randomUUID,
}: TurnstileGatewayOptions): TurnstileGateway {
  return {
    async verify({ token, remoteIp }) {
      const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: remoteIp,
          idempotency_key: createIdempotencyKey(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Turnstile verification request failed.");

      let result: unknown;
      try {
        result = await response.json();
      } catch {
        return false;
      }
      return isSiteverifyResponse(result)
        && result.hostname === expectedHostname
        && result.action === TURNSTILE_ACTION;
    },
  };
}
