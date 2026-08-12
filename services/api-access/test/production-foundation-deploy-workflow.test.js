import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-foundation.yml", import.meta.url);
const deployPolicyUrl = new URL("../../../ops/aws/production-foundation-deploy-policy.json", import.meta.url);
const opsScriptUrl = new URL("../scripts/configure-production-foundation.sh", import.meta.url);
const foundationGuardUrl = new URL("../scripts/verify-production-foundation-is-inert.sh", import.meta.url);
const execFileAsync = promisify(execFile);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

async function opsScript() {
  return await readFile(opsScriptUrl, "utf8");
}

async function deployPolicy() {
  return JSON.parse(await readFile(deployPolicyUrl, "utf8"));
}

test("production foundation deployment is manual, protected, main-only, and inert", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_production_foundation/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "false"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "false"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.match(source, /AWS_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(source, /secrets\.AWS_ROLE_ARN/);
});

test("production foundation never injects Stripe or webhook credentials", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
  assert.doesNotMatch(source, /stripe\.com\/v1\/(payment_intents|charges|checkout\/sessions|subscriptions)/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("production foundation deploy verifies disabled health state and operations controls", async () => {
  const source = await workflow();
  assert.match(source, /sam deploy/);
  assert.match(source, /ApiAccessEnabled="\$API_ACCESS_ENABLED"/);
  assert.match(source, /CustomerAccountsEnabled="\$CUSTOMER_ACCOUNTS_ENABLED"/);
  assert.match(source, /SubscriptionBillingEnabled="\$SUBSCRIPTION_BILLING_ENABLED"/);
  assert.match(source, /\.enabled == false/);
  assert.match(source, /\.customerAccountsEnabled == false/);
  assert.match(source, /\.subscriptionBillingEnabled == false/);
  assert.match(source, /configure-production-foundation\.sh/);
  assert.match(source, /OPERATIONS_ALARM_TOPIC_ARN/);
  assert.match(source, /verify-production-foundation-is-inert\.sh/);
});

test("production foundation refuses to overwrite an enabled true/true stack", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solvelang-production-foundation-guard-"));
  const binDirectory = join(directory, "bin");

  try {
    await mkdir(binDirectory);
    const awsPath = join(binDirectory, "aws");
    await writeFile(awsPath, '#!/usr/bin/env bash\nprintf "%s\\n" "$STACK_DESCRIPTION"\n');
    await chmod(awsPath, 0o755);

    const stackDescription = JSON.stringify({
      Stacks: [
        {
          StackStatus: "UPDATE_COMPLETE",
          Parameters: [
            { ParameterKey: "ApiAccessEnabled", ParameterValue: "true" },
            { ParameterKey: "CustomerAccountsEnabled", ParameterValue: "true" },
            { ParameterKey: "SubscriptionBillingEnabled", ParameterValue: "false" },
          ],
        },
      ],
    });

    await assert.rejects(
      execFileAsync("bash", [fileURLToPath(foundationGuardUrl)], {
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          STACK_NAME: "solvelang-api-access-production",
          STACK_DESCRIPTION: stackDescription,
        },
      }),
      (error) => error.code === 1 && /refuses to overwrite feature state true\/true/.test(error.stderr),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production deploy policy scopes API Gateway tagging to HTTP API resources", async () => {
  const policy = await deployPolicy();
  const statement = policy.Statement.find(({ Sid }) => Sid === "ApiGatewayV2ForSolveLangProduction");

  assert.ok(statement);
  assert.deepEqual(statement.Resource, [
    "arn:aws:apigateway:*::/apis",
    "arn:aws:apigateway:*::/apis/*",
    "arn:aws:apigateway:*::/tags/arn%3Aaws%3Aapigateway%3A*%3A%3A%2Fv2%2Fapis%2F*",
  ]);
  assert.ok(statement.Action.includes("apigateway:TagResource"));
  assert.ok(statement.Action.includes("apigateway:UntagResource"));
  assert.ok(!statement.Resource.includes("arn:aws:apigateway:*::/tags/*"));
  assert.ok(!statement.Action.includes("apigateway:*"));
});

test("operations baseline enables PITR, retention, and alarm routing", async () => {
  const source = await opsScript();
  assert.match(source, /update-continuous-backups/);
  assert.match(source, /PointInTimeRecoveryEnabled=true/);
  assert.match(source, /retention-in-days 90/);
  assert.match(source, /put-metric-alarm/);
  assert.match(source, /--alarm-actions "\$ALARM_TOPIC_ARN"/);
  assert.match(source, /ApiAccountsTable/);
  assert.match(source, /ApiKeysTable/);
  assert.match(source, /ApiCustomerAuthTable/);
  assert.match(source, /ApiSubscriptionEventsTable/);
});
