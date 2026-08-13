import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-customer-accounts.yml", import.meta.url);
const rollbackUrl = new URL("../scripts/rollback-production-customer-accounts.sh", import.meta.url);
const execFileAsync = promisify(execFile);
const disabledTotpKmsArn = "arn:aws:kms:us-east-1:000000000000:key/disabled";
const productionTotpKmsArn = "arn:aws:kms:us-east-2:123456789012:key/11111111-2222-3333-4444-555555555555";

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("production customer-account deployment is manual, protected, main-only, and doubly confirmed", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_production_customer_accounts/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "true"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
});

test("production customer-account deployment never injects billing credentials", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
  assert.match(source, /SubscriptionBillingEnabled="\$SUBSCRIPTION_BILLING_ENABLED"/);
  assert.match(source, /subscriptionBillingEnabled == false/);
  assert.match(source, /subscription_billing_disabled/);
  assert.match(source, /Stripe credentials injected: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("deployment revalidates readiness before assuming deploy role", async () => {
  const source = await workflow();
  assert.match(source, /Assume production preflight role/);
  assert.match(source, /Verify production stack and capture exact feature state/);
  assert.match(source, /Verify deployed customer frontend targets exact production API/);
  assert.match(source, /Verify SES sender and production sending access/);
  assert.match(source, /Run API access tests/);
  assert.match(source, /Validate SAM template/);
  assert.match(source, /Build API access stack/);
  assert.match(source, /Assume production deploy role/);
  assert.ok(source.indexOf("Assume production deploy role") > source.indexOf("Verify SES sender and production sending access"));
});

test("ordinary customer-account redeploy captures and preserves the exact authenticator flag and KMS ARN", async () => {
  const source = await workflow();
  assert.match(source, /ParameterKey == "CustomerTotpEnabled"/);
  assert.match(source, /ParameterKey == "CustomerTotpKmsKeyArn"/);
  assert.match(source, /initial_customer_totp_enabled=\$initial_customer_totp_enabled/);
  assert.match(source, /initial_customer_totp_kms_key_arn=\$initial_customer_totp_kms_key_arn/);
  assert.match(source, /PRESERVED_CUSTOMER_TOTP_ENABLED/);
  assert.match(source, /PRESERVED_CUSTOMER_TOTP_KMS_KEY_ARN/);
  assert.match(source, /CustomerTotpEnabled="\$PRESERVED_CUSTOMER_TOTP_ENABLED"/);
  assert.match(source, /CustomerTotpKmsKeyArn="\$PRESERVED_CUSTOMER_TOTP_KMS_KEY_ARN"/);
  assert.match(source, /aws kms describe-key/);
  assert.match(source, /get-key-rotation-status/);
  assert.match(source, /customerTotpEnabled == \$customer_totp/);
});

test("deployment captures the exact starting flags and invokes automatic state-preserving rollback", async () => {
  const source = await workflow();
  assert.match(source, /sam deploy/);
  assert.match(source, /ParameterKey == "ApiAccessEnabled"/);
  assert.match(source, /ParameterKey == "CustomerAccountsEnabled"/);
  assert.match(source, /ParameterKey == "SubscriptionBillingEnabled"/);
  assert.match(source, /initial_api_access_enabled=\$initial_api_access_enabled/);
  assert.match(source, /initial_customer_accounts_enabled=\$initial_customer_accounts_enabled/);
  assert.match(source, /Roll back to the exact pre-deploy feature state if post-deploy verification fails/);
  assert.match(source, /failure\(\) && steps\.deploy\.outcome == 'success'/);
  assert.match(source, /INITIAL_API_ACCESS_ENABLED: \$\{\{ steps\.stack\.outputs\.initial_api_access_enabled \}\}/);
  assert.match(source, /INITIAL_CUSTOMER_ACCOUNTS_ENABLED: \$\{\{ steps\.stack\.outputs\.initial_customer_accounts_enabled \}\}/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_ENABLED: \$\{\{ steps\.stack\.outputs\.initial_customer_totp_enabled \}\}/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN: \$\{\{ steps\.stack\.outputs\.initial_customer_totp_kms_key_arn \}\}/);
  assert.match(source, /bash scripts\/rollback-production-customer-accounts\.sh/);
});

async function simulatePostDeployFailureRollback(
  apiAccessEnabled,
  customerAccountsEnabled,
  customerTotpEnabled,
  customerTotpKmsKeyArn,
) {
  const directory = await mkdtemp(join(tmpdir(), "solvelang-api-access-rollback-"));
  const binDirectory = join(directory, "bin");
  const samArgsFile = join(directory, "sam-args.txt");

  try {
    await mkdir(binDirectory);
    const samPath = join(binDirectory, "sam");
    const curlPath = join(binDirectory, "curl");
    await writeFile(samPath, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$SAM_ARGS_FILE"\n');
    await writeFile(
      curlPath,
      '#!/usr/bin/env bash\nprintf \'{"status":"ok","enabled":%s,"customerAccountsEnabled":%s,"customerTotpEnabled":%s,"subscriptionBillingEnabled":false}\\n\' "$INITIAL_API_ACCESS_ENABLED" "$INITIAL_CUSTOMER_ACCOUNTS_ENABLED" "$INITIAL_CUSTOMER_TOTP_ENABLED"\n',
    );
    await Promise.all([chmod(samPath, 0o755), chmod(curlPath, 0o755)]);

    await execFileAsync("bash", [fileURLToPath(rollbackUrl)], {
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        SAM_ARGS_FILE: samArgsFile,
        STACK_NAME: "solvelang-api-access-production",
        SAM_ARTIFACT_BUCKET: "solvelang-api-access-production-artifacts",
        API_BASE: "https://api.example.com",
        INITIAL_API_ACCESS_ENABLED: String(apiAccessEnabled),
        INITIAL_CUSTOMER_ACCOUNTS_ENABLED: String(customerAccountsEnabled),
        INITIAL_CUSTOMER_TOTP_ENABLED: String(customerTotpEnabled),
        INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN: customerTotpKmsKeyArn,
        SITE_ORIGIN: "https://example.com",
        API_KEY_PEPPER: "api-key-pepper",
        API_ACCESS_ADMIN_SECRET: "api-access-admin-secret",
        CUSTOMER_AUTH_PEPPER: "customer-auth-pepper",
        CUSTOMER_AUTH_EMAIL_SENDER: "accounts@example.com",
        CUSTOMER_AUTH_EMAIL_REPLY_TO: "support@example.com",
      },
    });

    return await readFile(samArgsFile, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("simulated rollback restores an enabled customer stack while preserving disabled authenticator state", async () => {
  const samArgs = await simulatePostDeployFailureRollback(true, true, false, disabledTotpKmsArn);
  assert.match(samArgs, /^ApiAccessEnabled=true$/m);
  assert.match(samArgs, /^CustomerAccountsEnabled=true$/m);
  assert.match(samArgs, /^CustomerTotpEnabled=false$/m);
  assert.match(samArgs, new RegExp(`^CustomerTotpKmsKeyArn=${disabledTotpKmsArn.replaceAll("/", "\\/")}$`, "m"));
  assert.match(samArgs, /^SubscriptionBillingEnabled=false$/m);
});

test("simulated rollback restores enabled authenticator state with the exact production KMS ARN", async () => {
  const samArgs = await simulatePostDeployFailureRollback(true, true, true, productionTotpKmsArn);
  assert.match(samArgs, /^ApiAccessEnabled=true$/m);
  assert.match(samArgs, /^CustomerAccountsEnabled=true$/m);
  assert.match(samArgs, /^CustomerTotpEnabled=true$/m);
  assert.ok(samArgs.includes(`CustomerTotpKmsKeyArn=${productionTotpKmsArn}`));
  assert.match(samArgs, /^SubscriptionBillingEnabled=false$/m);
});

test("simulated rollback restores a previously disabled stack to false/false/false", async () => {
  const samArgs = await simulatePostDeployFailureRollback(false, false, false, disabledTotpKmsArn);
  assert.match(samArgs, /^ApiAccessEnabled=false$/m);
  assert.match(samArgs, /^CustomerAccountsEnabled=false$/m);
  assert.match(samArgs, /^CustomerTotpEnabled=false$/m);
  assert.match(samArgs, /^SubscriptionBillingEnabled=false$/m);
});
