import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const rollbackUrl = new URL("services/api-access/scripts/rollback-production-customer-accounts.sh", root);
const totpDeployUrl = new URL(".github/workflows/deploy-api-access-production-totp.yml", root);
const customerDeployUrl = new URL(".github/workflows/deploy-api-access-production-customer-accounts.yml", root);
const crmDeployUrl = new URL(".github/workflows/deploy-api-access-production-admin-crm.yml", root);
const totpPreflightUrl = new URL(".github/workflows/preflight-api-access-production-totp.yml", root);
const templateUrl = new URL("services/api-access/template.yaml", root);

async function text(url) {
  return readFile(url, "utf8");
}

test("shared production rollback restores an exact Admin CRM flag and never defaults an existing stack to false", async () => {
  const source = await text(rollbackUrl);
  assert.match(source, /INITIAL_ADMIN_CRM_ENABLED/);
  assert.match(source, /select\(\.ParameterKey == "AdminCrmEnabled"\)/);
  assert.match(source, /AdminCrmEnabled="\$INITIAL_ADMIN_CRM_ENABLED"/);
  assert.match(source, /current_admin_crm/);
  assert.match(source, /Rollback did not restore the exact Admin CRM feature state/);
  assert.doesNotMatch(source, /AdminCrmEnabled="false"/);
  assert.doesNotMatch(source, /first \/\/ "false"/);
  assert.ok((source.match(/first \/\/ empty/g) ?? []).length >= 2);
});

test("auth-related production deploy workflows never force Admin CRM off", async () => {
  for (const url of [totpDeployUrl, customerDeployUrl]) {
    const source = await text(url);
    assert.doesNotMatch(source, /AdminCrmEnabled\s*=\s*["']?false/i);
    assert.doesNotMatch(source, /AdminCrmEnabled="false"/);
    assert.match(source, /rollback-production-customer-accounts\.sh/);
  }
});

test("CRM remains an opt-in independent feature in SAM and the dedicated CRM rollout is billing-disabled", async () => {
  const template = await text(templateUrl);
  const crmDeploy = await text(crmDeployUrl);
  assert.match(template, /AdminCrmEnabled:/);
  assert.match(template, /AdminCrmRequirements:/);
  assert.match(crmDeploy, /AdminCrmEnabled="true"/);
  assert.match(crmDeploy, /SubscriptionBillingEnabled="false"/);
  assert.doesNotMatch(crmDeploy, /StripeSecretKey=/);
  assert.doesNotMatch(crmDeploy, /StripeSubscriptionWebhookSecret=/);
});

test("TOTP preflight proves rollback contract before any authenticator deployment", async () => {
  const preflight = await text(totpPreflightUrl);
  assert.match(preflight, /rollback-production-customer-accounts\.sh/);
  assert.doesNotMatch(preflight, /sam deploy/);
  assert.doesNotMatch(preflight, /cloudformation deploy/);
  assert.match(preflight, /Deployment performed: \*\*no\*\*/);
});
