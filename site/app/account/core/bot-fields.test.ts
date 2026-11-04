import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBotFields } from "./bot-fields";

test("bot fields carry the honeypot value and the elapsed form time", () => {
  assert.deepEqual(
    buildBotFields({ renderedAt: 1_000, now: 6_500, website: "" }),
    { website: "", formElapsedMs: 5_500 },
  );
  assert.deepEqual(
    buildBotFields({ renderedAt: 1_000, now: 6_500, website: "spammy", turnstileToken: "tok" }),
    { website: "spammy", formElapsedMs: 5_500, turnstileToken: "tok" },
  );
});

test("bot fields clamp negative elapsed time and omit an empty token", () => {
  const fields = buildBotFields({ renderedAt: 9_000, now: 1_000, website: "", turnstileToken: "" });
  assert.equal(fields.formElapsedMs, 0);
  assert.ok(!("turnstileToken" in fields));
});

test("the sign-in page sends bot fields with both public auth requests", async () => {
  const page = await readFile(new URL("../../(english)/account/api-keys/page.tsx", import.meta.url), "utf8");
  assert.match(page, /SignInTurnstile/);
  assert.match(page, /SignInHoneypot/);
  const magicLink = page.slice(page.indexOf("/customer/auth/magic-link") - 200, page.indexOf("/customer/auth/magic-link") + 200);
  const password = page.slice(page.indexOf("/customer/auth/password") - 200, page.indexOf("/customer/auth/password") + 200);
  assert.match(magicLink, /botFields\(\)/);
  assert.match(password, /botFields\(\)/);
});

test("the sign-in bot check uses the signin action and the canonical Turnstile script", async () => {
  const component = await readFile(new URL("./signin-bot-check.tsx", import.meta.url), "utf8");
  assert.match(component, /action: "signin"/);
  assert.match(component, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(component, /name="website"/);
});
