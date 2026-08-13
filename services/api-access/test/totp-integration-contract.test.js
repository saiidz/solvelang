import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";

const templateUrl = new URL("../template.yaml", import.meta.url);

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "k".repeat(64),
    API_ACCESS_ADMIN_SECRET: "a".repeat(64),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(64),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "hello@example.com",
    API_SUBSCRIPTION_BILLING_ENABLED: "false",
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

test("authenticator feature is off by default and requires a dedicated KMS key ARN when enabled", () => {
  const disabled = parseApiAccessEnvironment(baseEnvironment());
  assert.equal(disabled.customerTotpEnabled, false);
  assert.equal(disabled.customerTotpKmsKeyArn, undefined);
  assert.throws(
    () => parseApiAccessEnvironment(baseEnvironment({ API_CUSTOMER_TOTP_ENABLED: "true" })),
    /API_CUSTOMER_TOTP_KMS_KEY_ARN is required/,
  );
  assert.throws(
    () => parseApiAccessEnvironment(baseEnvironment({
      API_CUSTOMER_TOTP_ENABLED: "true",
      API_CUSTOMER_TOTP_KMS_KEY_ARN: "alias/solvelang-totp",
    })),
    /must contain a full KMS key ARN/,
  );
  const enabled = parseApiAccessEnvironment(baseEnvironment({
    API_CUSTOMER_TOTP_ENABLED: "true",
    API_CUSTOMER_TOTP_KMS_KEY_ARN: "arn:aws:kms:us-east-2:123456789012:key/example",
  }));
  assert.equal(enabled.customerTotpEnabled, true);
  assert.match(enabled.customerTotpKmsKeyArn, /^arn:aws:kms:/);
});

test("SAM template keeps authenticator opt-in and scopes runtime KMS permissions to Encrypt/Decrypt", async () => {
  const source = await readFile(templateUrl, "utf8");
  assert.match(source, /CustomerTotpEnabled:[\s\S]*Default: "false"/);
  assert.match(source, /CustomerTotpKmsKeyArn:/);
  assert.match(source, /AllowedPattern:.*kms/);
  assert.match(source, /CustomerTotpRequirements:/);
  assert.match(source, /Authenticator 2FA requires a dedicated KMS encryption key ARN/);
  assert.match(source, /API_CUSTOMER_TOTP_ENABLED: !Ref CustomerTotpEnabled/);
  assert.match(source, /API_CUSTOMER_TOTP_KMS_KEY_ARN: !Ref CustomerTotpKmsKeyArn/);
  assert.match(source, /- kms:Encrypt/);
  assert.match(source, /- kms:Decrypt/);
  assert.match(source, /Resource: !Ref CustomerTotpKmsKeyArn/);
  assert.doesNotMatch(source, /kms:\*/);
  assert.doesNotMatch(source, /kms:GenerateDataKey/);
  for (const path of [
    "/customer/auth/totp/verify",
    "/customer/auth/totp/setup",
    "/customer/auth/totp/confirm",
    "/customer/auth/totp/backup-codes",
    "/customer/auth/totp/disable",
  ]) assert.match(source, new RegExp(`Path: ${path.replaceAll("/", "\\/")}`));
});

test("password first factor returns no session cookie when MFA is required", async () => {
  const handler = createApiAccessHandler({
    service: {},
    enabled: true,
    adminSecret: "a".repeat(64),
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth: {
      async loginWithPassword() {
        return { mfaRequired: true, challengeToken: `mfa_${"a".repeat(24)}_${"B".repeat(43)}`, expiresInSeconds: 300 };
      },
    },
    customerAccount: {},
  });
  const response = await handler({
    rawPath: "/customer/auth/password",
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.5" } },
    body: JSON.stringify({ identifier: "owner", password: "secret" }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.cookies, undefined);
  const payload = JSON.parse(response.body);
  assert.equal(payload.mfaRequired, true);
  assert.match(payload.challengeToken, /^mfa_/);
  assert.equal(payload.csrfToken, undefined);
});

test("MFA verification is the only challenge endpoint that can create the authenticated cookie", async () => {
  const handler = createApiAccessHandler({
    service: {},
    enabled: true,
    adminSecret: "a".repeat(64),
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth: {
      async verifyMfaChallenge() {
        return {
          mfaRequired: false,
          accountId: "acct_example",
          email: "owner@example.com",
          csrfToken: "csrf",
          cookie: "sl_api_session=session; HttpOnly; Secure; SameSite=None; Partitioned",
        };
      },
    },
    customerAccount: {},
  });
  const response = await handler({
    rawPath: "/customer/auth/totp/verify",
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.5" } },
    body: JSON.stringify({ challengeToken: "challenge", code: "123456" }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.cookies.length, 1);
  assert.match(response.cookies[0], /HttpOnly/);
  assert.equal(JSON.parse(response.body).mfaRequired, false);
});
