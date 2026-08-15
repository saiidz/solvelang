import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const deployUrl = new URL(".github/workflows/deploy-api-access-production-admin-crm.yml", root);
const templateUrl = new URL("services/api-access/template.yaml", root);
const deployPolicyUrl = new URL("ops/aws/production-foundation-deploy-policy.json", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("production Admin CRM rollout is manual, protected, main-only, serialized, and billing-disabled", async () => {
  const source = await text(deployUrl);
  assert.match(source, /name: Deploy API Access Production Admin CRM/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /confirm_admin_crm_enable/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /ADMIN_CRM_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\.STRIPE_/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
});

test("production Admin CRM rollout preserves authenticator state and restores the previous CRM flag on failure", async () => {
  const source = await text(deployUrl);
  assert.match(source, /totp_enabled=\$totp_enabled/);
  assert.match(source, /totp_kms=\$totp_kms/);
  assert.match(source, /crm_enabled=\$crm_enabled/);
  assert.match(source, /CustomerTotpEnabled="\$PRESERVED_TOTP_ENABLED"/);
  assert.match(source, /CustomerTotpKmsKeyArn="\$PRESERVED_TOTP_KMS"/);
  assert.match(source, /AdminCrmEnabled="true"/);
  assert.match(source, /AdminCrmEnabled="\$INITIAL_CRM_ENABLED"/);
  assert.match(source, /if: \$\{\{ failure\(\).*steps\.before\.outcome == 'success'.*steps\.artifact-bucket\.outcome == 'success'/);
});

test("production Admin CRM rollout verifies retained/PITR storage and probes the protected route without mutation", async () => {
  const source = await text(deployUrl);
  assert.match(source, /PointInTimeRecoveryEnabled: true/);
  assert.match(source, /DeletionPolicy: Retain/);
  assert.match(source, /UpdateReplacePolicy: Retain/);
  assert.match(source, /logical-resource-id AdminCrmTable/);
  assert.match(source, /\/internal\/admin\/customers/);
  assert.match(source, /--get --data-urlencode 'accountId=invalid'/);
  assert.match(source, /\[\[ "\$http_status" == 400 \]\]/);
  assert.match(source, /\.code == "invalid_request"/);
  assert.match(source, /Customer\/CRM records mutated by verification: \*\*no\*\*/);
  assert.match(source, /Email sent by this workflow: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("CRM template remains opt-in, retained, encrypted, PITR-enabled, and outside the API key authorizer", async () => {
  const template = await text(templateUrl);
  assert.match(template, /AdminCrmEnabled:[\s\S]*Default: "false"/);
  assert.match(template, /AdminCrmTable:[\s\S]*Condition: AdminCrmFeatureEnabled/);
  assert.match(template, /AdminCrmTable:[\s\S]*DeletionPolicy: Retain[\s\S]*UpdateReplacePolicy: Retain/);
  assert.match(template, /AdminCrmTable:[\s\S]*PointInTimeRecoveryEnabled: true/);
  assert.match(template, /AdminCrmTable:[\s\S]*SSEEnabled: true/);
  assert.match(template, /API_ADMIN_CRM_ENABLED: !Ref AdminCrmEnabled/);

  const authorizer = template.match(/ApiKeyAuthorizerFunction:[\s\S]*?(?=\n  [A-Za-z0-9]+Function:|\nOutputs:|$)/)?.[0] ?? "";
  assert.doesNotMatch(authorizer, /AdminCrmTable|API_ADMIN_CRM_TABLE|API_ADMIN_CRM_ENABLED/);
});

test("existing production deploy role can create and protect the CRM table but has no Stripe authority in the rollout workflow", async () => {
  const policy = JSON.parse(await text(deployPolicyUrl));
  const dynamo = policy.Statement.find(({ Sid }) => Sid === "SolveLangProductionDynamoDB");
  const actions = Array.isArray(dynamo?.Action) ? dynamo.Action : [dynamo?.Action];
  assert.ok(actions.includes("dynamodb:CreateTable"));
  assert.ok(actions.includes("dynamodb:UpdateContinuousBackups"));
  assert.match(dynamo.Resource, /table\/solvelang-api-access-production-\*/);
});
