import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/preflight-production-customer-priority.yml", import.meta.url);
const ciUrl = new URL("../../../.github/workflows/customer-priority-production-ci.yml", import.meta.url);

async function source() {
  return readFile(workflowUrl, "utf8");
}

test("customer priority production preflight is manual, protected, main-only, and validation-only", async () => {
  const workflow = await source();
  assert.match(workflow, /name: Preflight Production Customer Priority/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_production_customer_priority_preflight/);
  assert.match(workflow, /environment: api-access-production/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /git rev-parse HEAD.*GITHUB_SHA/);
  assert.match(workflow, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.doesNotMatch(workflow, /AWS_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(workflow, /sam deploy/);
  assert.doesNotMatch(workflow, /cloudformation deploy/);
  assert.match(workflow, /Deployment performed: \*\*no\*\*/);
  assert.match(workflow, /Source uploaded: \*\*no\*\*/);
  assert.match(workflow, /Credits consumed: \*\*no\*\*/);
  assert.match(workflow, /Provider called: \*\*no\*\*/);
  assert.match(workflow, /Stripe\/charges: \*\*no\*\*/);
});

test("customer priority preflight requires live customer accounts, disabled billing, and three disabled launch gates", async () => {
  const workflow = await source();
  assert.match(workflow, /ParameterKey == "ApiAccessEnabled"/);
  assert.match(workflow, /ParameterKey == "CustomerAccountsEnabled"/);
  assert.match(workflow, /ParameterKey == "SubscriptionBillingEnabled"/);
  assert.match(workflow, /\[\[ "\$billing" == false \]\]/);
  assert.match(workflow, /PriorityQueueEnabled:/);
  assert.match(workflow, /CustomerPriorityEnabled:/);
  assert.match(workflow, /ProviderExecutionEnabled:/);
  assert.match(workflow, /Default: \\"false\\"/);
  assert.match(workflow, /Run API and priority tests/);
  assert.match(workflow, /Validate production-off priority foundation/);
  assert.match(workflow, /Build production-off priority foundation/);
  assert.match(workflow, /Verify source\/executor fail-closed contracts are present/);
});

test("customer priority CI reruns whenever the production preflight contract changes", async () => {
  const ci = await readFile(ciUrl, "utf8");
  const preflightPath = ".github/workflows/preflight-production-customer-priority.yml";
  const testPath = "services/api-access/test/production-customer-priority-preflight.test.js";
  assert.equal(ci.split(preflightPath).length - 1, 2);
  assert.equal(ci.split(testPath).length - 1, 2);
});
