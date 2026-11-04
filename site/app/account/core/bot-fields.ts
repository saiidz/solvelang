// Bot-check fields for the public sign-in requests. The API verifies these
// before it sends any email or creates any record (see the bot gate in
// services/api-access/src/api-handler.js): a filled honeypot or an
// implausibly fast submission fails closed with a neutral response, and a
// Turnstile token is verified server-side once a secret is configured.
export const BOT_HONEYPOT_FIELD = "website";

export interface BotFieldInput {
  renderedAt: number;
  now: number;
  website: string;
  turnstileToken?: string;
}

export function buildBotFields({ renderedAt, now, website, turnstileToken }: BotFieldInput) {
  return {
    website,
    formElapsedMs: Math.max(0, Math.floor(now - renderedAt)),
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}
