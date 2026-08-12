import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/preflight-api-access-production-customer-accounts.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("production customer-account preflight is manual, protected, main-only, and validation-only", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_customer_accounts_preflight/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "false"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "false"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.doesNotMatch(source, /sam deploy/);
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
});

test("production customer-account preflight validates auth independence, inert health, and SES readiness", async () => {
  const source = await workflow();
  assert.match(source, /CUSTOMER_AUTH_PEPPER/);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_KEY_PEPPER/);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_ACCESS_ADMIN_SECRET/);
  assert.match(source, /customerAccountsEnabled == false/);
  assert.match(source, /subscriptionBillingEnabled == false/);
  assert.match(source, /sesv2 get-email-identity/);
  assert.match(source, /VerifiedForSendingStatus/);
  assert.match(source, /sesv2 get-account/);
  assert.match(source, /ProductionAccessEnabled/);
});

test("production customer-account preflight requires an exact compiled CloudFormation production API string", async () => {
  const source = await workflow();
  assert.match(source, /Verify deployed customer frontend targets exact production API/);
  assert.match(source, /SITE_ORIGIN.*account\/api-keys\//);
  assert.match(source, /steps\.stack\.outputs\.api_base/);
  assert.match(source, /grep -Fq -- "\\"\$API_BASE\\""/);
  assert.match(source, /grep -Fq -- "'\$API_BASE'"/);
  assert.doesNotMatch(source, /grep -Fq -- "\$API_BASE" <<<"\$asset"/);
  assert.match(source, /NEXT_PUBLIC_API_ACCESS_BASE_URL exactly/);
  assert.match(source, /exact production API base string from CloudFormation/);
});

test("production customer-account preflight preserves the live template gate", async () => {
  const source = await workflow();
  assert.match(source, /CustomerAccountsRemainTestOnly/);
  assert.match(source, /Customer accounts are test-mode only until production review is complete\./);
  assert.match(source, /Deployment performed: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});
