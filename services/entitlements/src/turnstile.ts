const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileGateway = {
  verify(input: { token: string; remoteIp: string }): Promise<boolean>;
};

export function createTurnstileGateway(secret: string, fetchImpl: typeof fetch = fetch): TurnstileGateway {
  return {
    async verify({ token, remoteIp }) {
      const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Turnstile verification request failed.");

      const result = await response.json() as { success?: unknown };
      return result.success === true;
    },
  };
}
