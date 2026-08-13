import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/preflight-api-access-production-password-auth.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("production password-auth preflight is manual, protected, main-only, and validation-only", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_password_auth_preflight/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /git rev-parse HEAD/);
  assert.match(source, /GITHUB_SHA/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "true"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.doesNotMatch(source, /sam deploy/);
  assert.doesNotMatch(source, /secrets\.STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /secrets\.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
});

test("production password-auth preflight validates the already-live customer-account baseline", async () => {
  const source = await workflow();
  assert.match(source, /current_api_access_enabled.*== true/);
  assert.match(source, /current_customer_accounts_enabled.*== true/);
  assert.match(source, /current_subscription_billing_enabled.*== false/);
  assert.match(source, /\.enabled == true/);
  assert.match(source, /\.customerAccountsEnabled == true/);
  assert.match(source, /\.subscriptionBillingEnabled == false/);
  assert.doesNotMatch(source, /customerAccountsEnabled == false/);
});

test("production password-auth preflight validates auth independence, SES readiness, and exact frontend API targeting", async () => {
  const source = await workflow();
  assert.match(source, /CUSTOMER_AUTH_PEPPER/);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_KEY_PEPPER/);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_ACCESS_ADMIN_SECRET/);
  assert.match(source, /sesv2 get-email-identity/);
  assert.match(source, /VerifiedForSendingStatus/);
  assert.match(source, /sesv2 get-account/);
  assert.match(source, /ProductionAccessEnabled/);
  assert.match(source, /Verify deployed customer frontend targets exact production API/);
  assert.match(source, /SITE_ORIGIN.*account\/api-keys\//);
  assert.match(source, /grep -Fq -- "\\"\$API_BASE\\""/);
  assert.match(source, /grep -Fq -- "'\$API_BASE'"/);
});

test("production password-auth preflight verifies password routes, revocation hardening, and safe redeploy controls", async () => {
  const source = await workflow();
  assert.match(source, /Path: \/customer\/auth\/password/);
  assert.match(source, /Path: \/customer\/auth\/credentials/);
  assert.match(source, /scrypt-v1/);
  assert.match(source, /authVersion/);
  assert.match(source, /SubscriptionBillingRemainsTestOnly/);
  assert.match(source, /Wait for earlier production deployment requests/);
  assert.match(source, /INITIAL_API_ACCESS_ENABLED/);
  assert.match(source, /INITIAL_CUSTOMER_ACCOUNTS_ENABLED/);
  assert.match(source, /rollback-production-customer-accounts\.sh/);
});

test("production password-auth preflight writes an explicit no-side-effect readiness summary", async () => {
  const source = await workflow();
  assert.match(source, /Validated commit: `%s`/);
  assert.match(source, /Current API access enabled: \*\*true\*\*/);
  assert.match(source, /Current customer accounts enabled: \*\*true\*\*/);
  assert.match(source, /Current subscription billing enabled: \*\*false\*\*/);
  assert.match(source, /Deployment performed: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Stripe\/webhook used: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});
