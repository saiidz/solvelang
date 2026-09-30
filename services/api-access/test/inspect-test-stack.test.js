import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectTestStack, safeInspectionError } from "../scripts/inspect-test-stack.mjs";

const account = "123456789012";
const stackName = "solvelang-api-access-test";
const stackId = `arn:aws:cloudformation:us-east-2:${account}:stack/${stackName}/00000000-0000-0000-0000-000000000000`;
const environment = {
  GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "saiidz/solvelang",
  GITHUB_SHA: "a".repeat(40), AWS_REGION: "us-east-2", STACK_NAME: stackName,
  EXPECTED_AWS_ACCOUNT_ID: account, CONFIRM_INSPECTION_ONLY: "true",
};
function fixture() {
  return {
    identity: { Account: account, Arn: "hidden-identity" },
    stack: { Stacks: [{ StackId: stackId, StackName: stackName, StackStatus: "UPDATE_COMPLETE",
      LastUpdatedTime: "2026-08-09T04:19:57Z",
      Parameters: [
        { ParameterKey: "ApiAccessMode", ParameterValue: "test" },
        { ParameterKey: "ApiAccessEnabled", ParameterValue: "true" },
        { ParameterKey: "CustomerAccountsEnabled", ParameterValue: "true" },
        { ParameterKey: "SubscriptionBillingEnabled", ParameterValue: "true" },
        { ParameterKey: "StripeSecretKey", ParameterValue: "sk_test_NEVER_OUTPUT" },
      ], Outputs: [{ OutputKey: "DoNotOutput", OutputValue: "secret-output-NEVER_OUTPUT" }],
    }] },
    template: { TemplateBody: { Parameters: { StripeSecretKey: { NoEcho: true } }, Resources: {
      ApiAccessFunction: { Type: "AWS::Lambda::Function", Properties: {
        Environment: { Variables: { STRIPE_SECRET_KEY: "sk_test_NEVER_OUTPUT", API_ACCESS_MODE: "test" } },
      } },
      ApiAccountsTable: { Type: "AWS::DynamoDB::Table", Properties: { SecretSentinel: "NEVER_OUTPUT" } },
    } } },
    resources: { StackResourceSummaries: [
      { LogicalResourceId: "ApiAccessFunction", ResourceType: "AWS::Lambda::Function", ResourceStatus: "UPDATE_COMPLETE", PhysicalResourceId: "secret-physical-NEVER_OUTPUT" },
      { LogicalResourceId: "ApiAccountsTable", ResourceType: "AWS::DynamoDB::Table", ResourceStatus: "CREATE_COMPLETE" },
    ] },
  };
}
function runner(data, calls) {
  return (args) => {
    calls.push(args);
    const key = { "get-caller-identity": "identity", "describe-stacks": "stack", "get-template": "template", "list-stack-resources": "resources" }[args[1]];
    assert.ok(key, `Unexpected AWS operation: ${args[1]}`);
    return structuredClone(data[key]);
  };
}
function inspect(data = fixture(), overrides = {}) {
  const calls = [];
  const result = inspectTestStack({ environment: { ...environment, ...overrides }, runAws: runner(data, calls), now: () => new Date("2026-09-30T16:00:00Z") });
  return { result, calls };
}

test("test inspection reports only sanitized state and uses four read-only AWS calls", () => {
  const { result, calls } = inspect();
  assert.equal(result.stackName, stackName);
  assert.equal(result.accountIdentityVerified, true);
  assert.equal(result.mode, "test");
  assert.equal(result.features.SubscriptionBillingEnabled, true);
  assert.equal(result.templateDeclaresPublicStatusTable, false);
  assert.deepEqual(calls.map(args => args.slice(0, 2).join(" ")), [
    "sts get-caller-identity", "cloudformation describe-stacks", "cloudformation get-template", "cloudformation list-stack-resources",
  ]);
  for (const args of calls.slice(1)) {
    assert.equal(args[args.indexOf("--stack-name") + 1], stackName);
    assert.equal(args[args.indexOf("--region") + 1], "us-east-2");
  }
  const serialized = JSON.stringify(result);
  for (const value of ["NEVER_OUTPUT", account, "hidden-identity", "ParameterValue", "OutputValue", "PhysicalResourceId"]) assert.ok(!serialized.includes(value), value);
});

test("invalid dispatch context fails before any AWS call", () => {
  for (const overrides of [
    { GITHUB_REF: "refs/heads/feature" }, { GITHUB_REPOSITORY: "other/repo" },
    { AWS_REGION: "us-east-1" }, { STACK_NAME: "solvelang-api-access-production" },
    { EXPECTED_AWS_ACCOUNT_ID: "" }, { GITHUB_SHA: "main" }, { CONFIRM_INSPECTION_ONLY: "false" },
  ]) {
    let calls = 0;
    assert.throws(() => inspectTestStack({ environment: { ...environment, ...overrides }, runAws: () => { calls++; } }), /invalid_inspection_context/);
    assert.equal(calls, 0);
  }
});

test("inspection rejects wrong identity, wrong stack, live or absent mode, malformed flags and unstable stacks", () => {
  const mutate = [
    d => { d.identity.Account = "999999999999"; },
    d => { d.stack.Stacks[0].StackId = stackId.replace(account, "999999999999"); },
    d => { d.stack.Stacks[0].StackName = "solvelang-api-access-production"; },
    d => { d.stack.Stacks[0].StackStatus = "UPDATE_IN_PROGRESS"; },
    d => { d.stack.Stacks[0].Parameters[0].ParameterValue = "live"; },
    d => { d.stack.Stacks[0].Parameters.shift(); },
    d => { d.stack.Stacks[0].Parameters[1].ParameterValue = "sometimes"; },
    d => { d.stack.Stacks = []; },
  ];
  for (const change of mutate) { const data = fixture(); change(data); assert.throws(() => inspect(data)); }
  const wrongIdentity = fixture(); wrongIdentity.identity.Account = "999999999999";
  const calls = [];
  assert.throws(() => inspectTestStack({ environment, runAws: runner(wrongIdentity, calls) }), /unexpected_account/);
  assert.equal(calls.length, 1, "wrong-account credentials must never read a stack");
});

test("CLI errors, malformed templates and malformed resource names cannot leak raw material", () => {
  const failure = new Error("sk_test_NEVER_OUTPUT");
  failure.stderr = "another-secret-NEVER_OUTPUT";
  assert.equal(safeInspectionError(failure), "inspection_failed");
  assert.throws(() => inspectTestStack({ environment, runAws: () => { throw failure; } }), /aws_read_failed/);
  const badTemplate = fixture(); badTemplate.template.TemplateBody = "not JSON sk_test_NEVER_OUTPUT";
  assert.throws(() => inspect(badTemplate), /invalid_template/);
  const badResources = fixture(); badResources.resources.StackResourceSummaries[0].LogicalResourceId = "secret_with_underscores";
  assert.throws(() => inspect(badResources), /invalid_resource_summary/);
});

test("public status reports a validated template declaration, never effective Lambda configuration", () => {
  for (const [declaration, expected] of [[undefined, false], [null, false], ["", false], [" ", false], ["test-table", true], [{ Ref: "PublicStatusTable" }, true]]) {
    const data = fixture();
    data.template.TemplateBody.Resources.ApiAccessFunction.Properties.Environment.Variables.PUBLIC_STATUS_TABLE = declaration;
    const { result } = inspect(data);
    assert.equal(result.templateDeclaresPublicStatusTable, expected);
    assert.match(result.limitations[0], /effective Lambda configuration.*not verified/);
  }
  const wrongType = fixture(); wrongType.template.TemplateBody.Resources.ApiAccessFunction.Type = "AWS::S3::Bucket";
  assert.throws(() => inspect(wrongType), /invalid_template/);
  const missing = fixture(); delete missing.template.TemplateBody.Resources.ApiAccessFunction;
  assert.throws(() => inspect(missing), /invalid_template/);
});

test("inspection workflow isolates its role session and cannot fall through to deployment", async () => {
  const source = await readFile(new URL("../../../.github/workflows/inspect-api-access-test.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-test/);
  assert.match(source, /refs\/heads\/main/);
  assert.match(source, /EXPECTED_AWS_ACCOUNT_ID: \$\{\{ steps\.boundary\.outputs\.aws_account_id \}\}/);
  assert.match(source, /inline-session-policy:/);
  assert.match(source, /cloudformation:DescribeStacks/);
  assert.match(source, /cloudformation:GetTemplate/);
  assert.match(source, /cloudformation:ListStackResources/);
  const policyText = source.match(/inline-session-policy: >-\n\s+(\{.+\})/)[1]
    .replaceAll("${{ steps.boundary.outputs.aws_account_id }}", account);
  assert.deepEqual(JSON.parse(policyText), { Version: "2012-10-17", Statement: [
    { Effect: "Allow", Action: "sts:GetCallerIdentity", Resource: "*" },
    { Effect: "Allow", Action: ["cloudformation:DescribeStacks", "cloudformation:GetTemplate", "cloudformation:ListStackResources"],
      Resource: `arn:aws:cloudformation:us-east-2:${account}:stack/${stackName}/*` },
  ] });
  assert.match(source, /concurrency:\n  group: api-access-test-deployment\n  cancel-in-progress: false/);
  assert.doesNotMatch(source, /sam deploy|create-change-set|execute-change-set|api-access-production|STRIPE_SECRET_KEY|API_KEY_PEPPER|API_ACCESS_ADMIN_SECRET|secretsmanager|ssm:|s3:/);
  assert.doesNotMatch(source, /push:|pull_request:|schedule:/);
  const secrets = [...source.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(secrets)], ["AWS_ROLE_ARN"]);
});
