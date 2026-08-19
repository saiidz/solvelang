import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/customer-priority-production-stack.yaml", root);
const workflowUrl = new URL(".github/workflows/deploy-customer-priority-production-foundation.yml", root);
const policyUrl = new URL("ops/aws/production-priority-foundation-deploy-supplemental-policy.json", root);
const queueUrl = new URL("services/api-access/scripts/wait-for-production-deployment-turn.mjs", root);

async function text(url) { return readFile(url, "utf8"); }

test("production priority foundation provisions durable data/queues but defaults every processing gate OFF", async () => {
  const source = await text(templateUrl);
  assert.match(source, /PriorityQueueEnabled:[\s\S]*?Default: "false"/);
  assert.match(source, /CustomerPriorityEnabled:[\s\S]*?Default: "false"/);
  assert.match(source, /ProviderExecutionEnabled:[\s\S]*?Default: "false"/);
  assert.match(source, /Type: AWS::DynamoDB::Table/);
  assert.match(source, /PointInTimeRecoveryEnabled: true/);
  assert.match(source, /DeletionPolicy: Retain/);
  assert.match(source, /Type: AWS::S3::Bucket/);
  assert.match(source, /BlockPublicPolicy: true/);
  assert.match(source, /VersioningConfiguration:[\s\S]*?Status: Enabled/);
  assert.match(source, /ExpirationInDays: 7/);
  assert.match(source, /StandardQueue:[\s\S]*?Type: AWS::SQS::Queue/);
  assert.match(source, /CriticalQueue:[\s\S]*?Type: AWS::SQS::Queue/);
  assert.match(source, /PriorityDispatcherFunction:[\s\S]*?Condition: QueueEnabled/);
  assert.match(source, /StandardWorkerFunction:[\s\S]*?Condition: QueueEnabled/);
  assert.match(source, /CriticalWorkerFunction:[\s\S]*?Condition: QueueEnabled/);
  assert.match(source, /StandardDlqAlarm:/);
  assert.match(source, /CriticalDlqAlarm:/);
  assert.doesNotMatch(source, /stripe|subscriptionbilling|webhook|charge/i);
});

test("foundation deployment workflow is manual/protected, serialized, and refuses to activate processing or billing", async () => {
  const source = await text(workflowUrl);
  assert.match(source, /name: Deploy Customer Priority Production Foundation/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /confirm_priority_foundation/);
  assert.match(source, /confirm_processing_remains_disabled/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /actions: read/);
  assert.doesNotMatch(source, /^concurrency:/m);
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.ok(
    source.indexOf("Wait for earlier production deployment requests")
      < source.indexOf("Assume production read-only preflight role"),
  );
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_ROLE_ARN \}\}/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
  assert.match(source, /priority_describe_status/);
  assert.match(source, /does not exist/);
  assert.match(source, /Unable to determine existing priority stack state; refusing deployment/);
  assert.match(source, /PriorityQueueEnabled=false/);
  assert.match(source, /CustomerPriorityEnabled=false/);
  assert.match(source, /ProviderExecutionEnabled=false/);
  assert.match(source, /function_count/);
  assert.match(source, /\[\[ "\$function_count" == 0 \]\]/);
  assert.match(source, /PointInTimeRecoveryStatus/);
  assert.match(source, /SubscriptionBillingEnabled/);
  assert.match(source, /Customer source uploaded: \*\*no\*\*/);
  assert.match(source, /Customer credits consumed: \*\*no\*\*/);
  assert.match(source, /Customer job submitted: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
  assert.doesNotMatch(source, /secrets\.STRIPE_|StripeSecretKey=|StripeSubscriptionWebhookSecret=/);
  assert.doesNotMatch(source, /send-email|sesv2 send/i);

  const queue = await text(queueUrl);
  assert.match(queue, /deploy-customer-priority-production-foundation\.yml/);
});

test("priority foundation deployment supplement cannot mutate IAM, KMS, SES, Stripe, or unrelated S3/SQS resources", async () => {
  const policy = JSON.parse(await text(policyUrl));
  const actions = policy.Statement.flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  for (const action of actions) assert.match(action, /^(cloudformation|s3|sqs):/);
  assert.ok(!actions.some((action) => /^(iam|kms|ses|sesv2):/.test(action)));
  const cfn = policy.Statement.find(({ Sid }) => Sid === "PriorityProductionCloudFormation");
  assert.equal(cfn.Resource, "arn:aws:cloudformation:*:*:stack/solvelang-api-access-production-priority/*");
  const queues = policy.Statement.find(({ Sid }) => Sid === "PriorityProductionQueues");
  assert.equal(queues.Resource, "arn:aws:sqs:*:*:solvelang-priority-prod-*");
  const source = policy.Statement.find(({ Sid }) => Sid === "PriorityProductionSourceBucket");
  assert.equal(source.Resource, "arn:aws:s3:::solvelang-priority-prod-source-*");
});
