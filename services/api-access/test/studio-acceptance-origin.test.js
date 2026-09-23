import assert from "node:assert/strict";
import test from "node:test";
import { parseApiAccessEnvironment } from "../src/config.js";

function environment(extra = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCESS_ADMIN_SECRET: "a".repeat(32),
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(32),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "support@example.com",
    ...extra,
  };
}

test("Studio acceptance origin defaults off and accepts the exact dedicated Amplify branch origin", () => {
  assert.equal(parseApiAccessEnvironment(environment()).studioAcceptanceOrigin, undefined);
  const parsed = parseApiAccessEnvironment(environment({
    STUDIO_ACCEPTANCE_ORIGIN: "https://studio-acceptance.dabcdef123456.amplifyapp.com",
  }));
  assert.equal(parsed.studioAcceptanceOrigin, "https://studio-acceptance.dabcdef123456.amplifyapp.com");
});

test("Studio acceptance origin rejects canonical, unrelated, non-HTTPS, wildcard and non-origin values", () => {
  for (const value of [
    "https://www.solve-lang.com",
    "http://studio-acceptance.dabcdef123456.amplifyapp.com",
    "https://preview.example.com",
    "https://studio-acceptance.dabcdef123456.amplifyapp.com/",
    "https://*.dabcdef123456.amplifyapp.com",
    "https://studio-acceptance.dabcdef123456.amplifyapp.com.evil.example",
  ]) {
    assert.throws(() => parseApiAccessEnvironment(environment({ STUDIO_ACCEPTANCE_ORIGIN: value })), /exact dedicated Amplify acceptance-branch/);
  }
});
