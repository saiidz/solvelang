import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/preflight-production-admin-console-gateway.yml", import.meta.url);

async function source() {
  return readFile(workflowUrl, "utf8");
}

test("admin gateway production preflight is manual, protected, main-only, and validation-only", async () => {
  const workflow = await source();
  assert.match(workflow, /name: Preflight Production Admin Console Gateway/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_production_admin_console_preflight/);
  assert.match(workflow, /environment: api-access-production/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/);
  assert.match(workflow, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.doesNotMatch(workflow, /AWS_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(workflow, /sam deploy/);
  assert.doesNotMatch(workflow, /cloudformation deploy/);
  assert.doesNotMatch(workflow, /aws s3 sync/);
  assert.match(workflow, /Deployment performed: \*\*no\*\*/);
  assert.match(workflow, /Customer\/CRM mutation: \*\*no\*\*/);
  assert.match(workflow, /Email sent: \*\*no\*\*/);
  assert.match(workflow, /Stripe\/charges: \*\*no\*\*/);
});

test("admin gateway preflight requires live CRM, disabled billing, independent secrets, and a private origin", async () => {
  const workflow = await source();
  assert.match(workflow, /ParameterKey == "AdminCrmEnabled"/);
  assert.match(workflow, /\[\[ "\$crm" == true \]\]/);
  assert.match(workflow, /ParameterKey == "SubscriptionBillingEnabled"/);
  assert.match(workflow, /\[\[ "\$billing" == false \]\]/);
  assert.match(workflow, /ADMIN_CONSOLE_PASSWORD_SCRYPT/);
  assert.match(workflow, /ADMIN_CONSOLE_SESSION_SECRET/);
  assert.match(workflow, /ADMIN_SESSION_SECRET.*!=.*API_ACCESS_ADMIN_SECRET/);
  assert.match(workflow, /Private admin origin must not reuse the public customer origin/);
  assert.match(workflow, /Run gateway unit tests/);
  assert.match(workflow, /Validate gateway SAM contract/);
  assert.match(workflow, /Build gateway SAM contract/);
  assert.match(workflow, /Verify static admin bundle contains no privileged secret material/);
});
