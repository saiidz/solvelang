import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const workflowUrl = new URL(".github/workflows/deploy-admin-console-gateway-production.yml", root);
const policyUrl = new URL("ops/aws/production-admin-gateway-deploy-supplemental-policy.json", root);
const queueUrl = new URL("services/api-access/scripts/wait-for-production-deployment-turn.mjs", root);

async function text(url) { return readFile(url, "utf8"); }

test("private admin gateway rollout is manual, protected, serialized, and billing/customer-safe", async () => {
  const source = await text(workflowUrl);
  assert.match(source, /name: Deploy Admin Console Gateway Production/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /confirm_production_admin_gateway/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /git rev-parse HEAD.*GITHUB_SHA/);
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
  assert.match(source, /AdminCrmEnabled/);
  assert.match(source, /SubscriptionBillingEnabled/);
  assert.match(source, /AdminConsoleGatewayEnabled=true/);
  assert.match(source, /solvelang-api-access-production-admin-console/);
  assert.match(source, /ADMIN_SESSION_SECRET.*!=.*API_ACCESS_ADMIN_SECRET/);
  assert.match(source, /gateway_describe_status/);
  assert.match(source, /does not exist/);
  assert.match(source, /Unable to determine the existing admin gateway stack state; refusing deployment/);
  assert.match(source, /sam deploy/);
  assert.match(source, /update-termination-protection/);
  assert.match(source, /"\$gateway_base\/session"/);
  assert.match(source, /\[\[ "\$code" == 401 \]\]/);
  assert.match(source, /PREVIOUS_ENABLED/);
  assert.match(source, /\.\.\/\.\.\/admin-console-static/);
  assert.doesNotMatch(source, /\.\.\/\.\.\/admin-static(?:\s|\/)/);
  assert.match(source, /Customer\/CRM mutation by verification: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
  assert.doesNotMatch(source, /secrets\.STRIPE_|StripeSecretKey=|StripeSubscriptionWebhookSecret=/);
  assert.doesNotMatch(source, /send-email|sesv2 send/i);
});

test("admin gateway deploy supplement grants only CloudFormation authority for the exact gateway stack", async () => {
  const policy = JSON.parse(await text(policyUrl));
  assert.equal(policy.Statement.length, 1);
  const statement = policy.Statement[0];
  assert.equal(statement.Effect, "Allow");
  assert.equal(statement.Resource, "arn:aws:cloudformation:*:*:stack/solvelang-api-access-production-admin-console/*");
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  assert.ok(actions.includes("cloudformation:ExecuteChangeSet"));
  assert.ok(actions.includes("cloudformation:UpdateTerminationProtection"));
  for (const action of actions) assert.match(action, /^cloudformation:/);
});

test("admin gateway rollout participates in the attempt-aware production queue", async () => {
  const queue = await text(queueUrl);
  assert.match(queue, /deploy-admin-console-gateway-production\.yml/);
});
