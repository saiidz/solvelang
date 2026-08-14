import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/account-access-production-admin.yml", import.meta.url);
const apiAccessCiUrl = new URL("../../../.github/workflows/api-access-ci.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

async function apiAccessCi() {
  return await readFile(apiAccessCiUrl, "utf8");
}

test("production account admin workflow is manual, protected, main-only, owner-only, and serialized", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /group: api-access-production-account-admin/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /git rev-parse HEAD/);
  assert.match(source, /GITHUB_SHA/);
  assert.match(source, /GITHUB_ACTOR.*OWNER_LOGIN/);
  assert.match(source, /GITHUB_TRIGGERING_ACTOR.*OWNER_LOGIN/);
  assert.match(source, /OWNER_LOGIN: \$\{\{ github\.repository_owner \}\}/);
});

test("production account admin workflow accepts one bounded account identity selector", async () => {
  const source = await workflow();
  assert.match(source, /identity_type:/);
  assert.match(source, /- account_id/);
  assert.match(source, /- email/);
  assert.match(source, /- username/);
  assert.match(source, /IDENTITY_TYPE: \$\{\{ inputs\.identity_type \}\}/);
  assert.match(source, /IDENTITY: \$\{\{ inputs\.identity \}\}/);
  assert.match(source, /\$\{#IDENTITY\} >= 1/);
  assert.match(source, /\$\{#IDENTITY\} <= 254/);
  assert.match(source, /\^acct_\[a-f0-9\]\{32\}\$/);
  assert.match(source, /normalized_username="\$\{IDENTITY,,\}"/);
  assert.match(source, /explode \| all\(\. >= 32 and \. != 127\)/);
  assert.doesNotMatch(source, /for\s+IDENTITY\s+in/);
});

test("production account admin workflow resolves identity read-only before any canonical mutation", async () => {
  const source = await workflow();
  assert.match(source, /Resolve identity and read current account state/);
  assert.match(source, /account_id\) lookup_key="accountId"/);
  assert.match(source, /email\) lookup_key="email"/);
  assert.match(source, /username\) lookup_key="username"/);
  assert.match(source, /--data-urlencode "\$lookup_key=\$IDENTITY"/);
  assert.match(source, /resolved_account_id=.*\.account\.accountId/);
  assert.match(source, /matched_by=.*\.lookup\.matchedBy/);
  assert.match(source, /matched_by.*IDENTITY_TYPE/);
  assert.match(source, /RESOLVED_ACCOUNT_ID: \$\{\{ steps\.before\.outputs\.account_id \}\}/);
  assert.match(source, /--arg accountId "\$RESOLVED_ACCOUNT_ID"/);
  assert.doesNotMatch(source, /--arg accountId "\$IDENTITY"/);
});

test("production account admin workflow supports status, reversible suspension, and strongly confirmed irreversible termination", async () => {
  const source = await workflow();
  assert.match(source, /- status/);
  assert.match(source, /- suspend/);
  assert.match(source, /- reactivate/);
  assert.match(source, /- terminate/);
  assert.match(source, /suspend\) target_state="suspended"/);
  assert.match(source, /reactivate\) target_state="active"/);
  assert.match(source, /terminate\) target_state="terminated"/);
  assert.match(source, /TERMINATION_CONFIRMATION.*TERMINATE \$resolved_account_id/);
  assert.match(source, /if: inputs\.operation != 'status'/);
});

test("production account admin workflow allows exact idempotent replay while rejecting unsafe terminated transitions", async () => {
  const source = await workflow();
  assert.match(source, /Suspend cannot operate on a terminated account/);
  assert.match(source, /Reactivate cannot operate on a terminated account/);
  assert.match(source, /before_state.*terminated/);
  assert.match(source, /\.account\.changed == true or \.account\.duplicate == true/);
  assert.match(source, /Idempotent replay unexpectedly changed authentication version/);
});

test("production account admin workflow resolves the live stack read-only and keeps billing disabled", async () => {
  const source = await workflow();
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.doesNotMatch(source, /AWS_DEPLOY_ROLE_ARN/);
  assert.match(source, /cloudformation describe-stacks/);
  assert.match(source, /ApiAccessEnabled/);
  assert.match(source, /CustomerAccountsEnabled/);
  assert.match(source, /SubscriptionBillingEnabled/);
  assert.match(source, /billing_enabled.*== false/);
  assert.match(source, /subscriptionBillingEnabled == false/);
  assert.doesNotMatch(source, /sam deploy/);
});

test("production account admin workflow uses only the protected internal access endpoint and never prints secrets or raw identity", async () => {
  const source = await workflow();
  assert.match(source, /API_ACCESS_ADMIN_SECRET: \$\{\{ secrets\.API_ACCESS_ADMIN_SECRET \}\}/);
  assert.match(source, /x-solvelang-admin-secret: \$API_ACCESS_ADMIN_SECRET/);
  assert.match(source, /\/internal\/accounts\/access/);
  assert.match(source, /-X POST/);
  assert.doesNotMatch(source, /echo[^\n]*API_ACCESS_ADMIN_SECRET/);
  assert.doesNotMatch(source, /printf[^\n]*API_ACCESS_ADMIN_SECRET/);
  assert.doesNotMatch(source, /echo[^\n]*\$IDENTITY/);
  assert.doesNotMatch(source, /printf[^\n]*\$IDENTITY/);
  assert.doesNotMatch(source, /set -x/);
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /sesv2/);
});

test("production account admin workflow verifies before and after state plus auth-version invalidation", async () => {
  const source = await workflow();
  assert.match(source, /Resolve identity and read current account state/);
  assert.match(source, /Verify resulting account state/);
  assert.match(source, /authVersion/);
  assert.match(source, /resulting_auth_version == BEFORE_AUTH_VERSION \+ 1/);
  assert.match(source, /\.account\.changed == true or \.account\.duplicate == true/);
  assert.match(source, /Idempotent replay:/);
  assert.match(source, /Lookup type:/);
  assert.match(source, /Billing changed: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Stripe\/webhook used: \*\*no\*\*/);
});

test("API Access CI runs whenever the production account admin workflow changes", async () => {
  const source = await apiAccessCi();
  const matches = source.match(/'\.github\/workflows\/account-access-production-admin\.yml'/g) ?? [];
  assert.equal(matches.length, 2);
});
