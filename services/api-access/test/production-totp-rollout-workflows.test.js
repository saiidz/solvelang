import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const preflightUrl = new URL(".github/workflows/preflight-api-access-production-totp.yml", root);
const deployUrl = new URL(".github/workflows/deploy-api-access-production-totp.yml", root);
const kmsDeployUrl = new URL(".github/workflows/deploy-api-access-production-totp-kms.yml", root);
const kmsTemplateUrl = new URL("ops/aws/customer-totp-kms-template.yaml", root);
const preflightPolicyUrl = new URL("ops/aws/production-preflight-policy.json", root);
const deployPolicyUrl = new URL("ops/aws/production-foundation-deploy-policy.json", root);

async function text(url) {
  return await readFile(url, "utf8");
}

test("TOTP production preflight is manual, protected, main-only, and validation-only", async () => {
  const source = await text(preflightUrl);
  assert.match(source, /name: Preflight API Access Production TOTP/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /confirm_production_totp_preflight/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /git rev-parse HEAD.*GITHUB_SHA/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.doesNotMatch(source, /AWS_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(source, /sam deploy/);
  assert.doesNotMatch(source, /cloudformation deploy/);
  assert.doesNotMatch(source, /kms:CreateKey/);
  assert.doesNotMatch(source, /send-email/i);
  assert.match(source, /Deployment performed: \*\*no\*\*/);
  assert.match(source, /Customer enrolled: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Stripe\/webhook used: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("TOTP preflight requires existing live customer accounts, disabled billing, KMS readiness, and deployed browser support", async () => {
  const source = await text(preflightUrl);
  assert.match(source, /ApiAccessEnabled/);
  assert.match(source, /CustomerAccountsEnabled/);
  assert.match(source, /CustomerTotpEnabled/);
  assert.match(source, /SubscriptionBillingEnabled/);
  assert.match(source, /\[\[ "\$totp" == false \]\]/);
  assert.match(source, /solvelang-api-access-production-totp-kms/);
  assert.match(source, /KeyState == "Enabled"/);
  assert.match(source, /KeyManager == "CUSTOMER"/);
  assert.match(source, /KeySpec == "SYMMETRIC_DEFAULT"/);
  assert.match(source, /KeyUsage == "ENCRYPT_DECRYPT"/);
  assert.match(source, /get-key-rotation-status/);
  assert.match(source, /Purpose == "customer-totp"/);
  assert.match(source, /alias\/solvelang-customer-totp-production/);
  for (const marker of [
    "/customer/auth/totp/verify",
    "/customer/auth/totp/setup",
    "/customer/auth/totp/confirm",
    "/customer/auth/totp/backup-codes",
    "/customer/auth/totp/disable",
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /Authenticator app/);
  assert.match(source, /Verify SES sender and production sending access/);
  assert.match(source, /Run API access tests/);
  assert.match(source, /Validate API access SAM template/);
  assert.match(source, /Build API access stack/);
});

test("TOTP production deployment is protected, serialized, derives the KMS ARN, and never injects billing credentials", async () => {
  const source = await text(deployUrl);
  assert.match(source, /name: Deploy API Access Production TOTP/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /confirm_production_totp/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /actions: read/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /git rev-parse HEAD.*GITHUB_SHA/);
  assert.match(source, /CUSTOMER_TOTP_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
  assert.match(source, /CustomerTotpKmsKeyArn="\$CUSTOMER_TOTP_KMS_KEY_ARN"/);
  assert.match(source, /CUSTOMER_TOTP_KMS_KEY_ARN: \$\{\{ steps\.kms\.outputs\.key_arn \}\}/);
  assert.doesNotMatch(source, /secrets\.CUSTOMER_TOTP_KMS/);
  assert.doesNotMatch(source, /secrets\.STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /secrets\.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
  assert.match(source, /customerTotpEnabled == true/);
  assert.match(source, /subscriptionBillingEnabled == false/);
  assert.match(source, /subscription_billing_disabled/);
  assert.match(source, /Stripe credentials injected: \*\*no\*\*/);
  assert.match(source, /Email sent by deployment: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("TOTP deployment captures exact starting TOTP/KMS state and rolls back transactionally on post-deploy failure", async () => {
  const source = await text(deployUrl);
  assert.match(source, /initial_customer_totp_enabled=\$initial_customer_totp_enabled/);
  assert.match(source, /initial_customer_totp_kms_key_arn=\$initial_customer_totp_kms_key_arn/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_ENABLED: \$\{\{ steps\.stack\.outputs\.initial_customer_totp_enabled \}\}/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN: \$\{\{ steps\.stack\.outputs\.initial_customer_totp_kms_key_arn \}\}/);
  assert.match(source, /failure\(\) && steps\.deploy\.outcome == 'success'/);
  assert.match(source, /rollback-production-customer-accounts\.sh/);
  assert.match(source, /already enabled with a different KMS key; refusing key migration/);
});

test("dedicated KMS deployment mutates only the retained TOTP KMS stack and does not enable the API feature", async () => {
  const source = await text(kmsDeployUrl);
  assert.match(source, /name: Deploy API Access Production TOTP KMS/);
  assert.match(source, /confirm_production_totp_kms/);
  assert.match(source, /confirm_totp_remains_disabled/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
  assert.match(source, /cloudformation deploy/);
  assert.match(source, /--stack-name "\$KMS_STACK_NAME"/);
  assert.match(source, /\[\[ "\$totp" == false \]\]/);
  assert.doesNotMatch(source, /sam deploy/);
  assert.doesNotMatch(source, /CustomerTotpEnabled=true/);
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.match(source, /Customer authenticator 2FA enabled by this workflow: \*\*no\*\*/);
  assert.match(source, /API stack changed: \*\*no\*\*/);
  assert.match(source, /Email sent: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("TOTP KMS template is symmetric, rotating, retained, single-region, and tagged", async () => {
  const source = await text(kmsTemplateUrl);
  assert.match(source, /Type: AWS::KMS::Key/);
  assert.match(source, /DeletionPolicy: Retain/);
  assert.match(source, /UpdateReplacePolicy: Retain/);
  assert.match(source, /EnableKeyRotation: true/);
  assert.match(source, /KeySpec: SYMMETRIC_DEFAULT/);
  assert.match(source, /KeyUsage: ENCRYPT_DECRYPT/);
  assert.match(source, /MultiRegion: false/);
  assert.match(source, /PendingWindowInDays: 30/);
  assert.match(source, /Value: customer-totp/);
  assert.match(source, /Value: production/);
  assert.match(source, /alias\/solvelang-customer-totp-production/);
  assert.doesNotMatch(source, /AWS::KMS::ReplicaKey/);
});

test("preflight IAM contract is read-only for KMS and the deploy policy cannot schedule or directly delete the retained TOTP key", async () => {
  const preflight = JSON.parse(await text(preflightPolicyUrl));
  const preflightActions = preflight.Statement.flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  for (const action of preflightActions) {
    assert.doesNotMatch(action, /Create|Delete|Put|Update|Enable|Disable|Schedule|Cancel/i, action);
  }
  assert.ok(preflightActions.includes("kms:DescribeKey"));
  assert.ok(preflightActions.includes("kms:GetKeyPolicy"));
  assert.ok(preflightActions.includes("kms:GetKeyRotationStatus"));
  assert.ok(preflightActions.includes("kms:ListResourceTags"));

  const deploy = JSON.parse(await text(deployPolicyUrl));
  const deployActions = deploy.Statement.flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  assert.ok(deployActions.includes("kms:CreateKey"));
  assert.ok(deployActions.includes("kms:EnableKeyRotation"));
  assert.ok(deployActions.includes("kms:CreateAlias"));
  assert.ok(!deployActions.includes("kms:ScheduleKeyDeletion"));
  assert.ok(!deployActions.includes("kms:DisableKey"));
  assert.ok(!deployActions.includes("kms:PutKeyPolicy"));
  assert.ok(!deployActions.includes("kms:Decrypt"));
  assert.ok(!deployActions.includes("kms:Encrypt"));
});
