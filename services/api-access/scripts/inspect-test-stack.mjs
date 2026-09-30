// Inspect only the existing protected test stack. Never emit raw AWS responses.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const stackName = "solvelang-api-access-test";
const region = "us-east-2";
const stableStatuses = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);
const featureNames = ["ApiAccessEnabled", "CustomerAccountsEnabled", "SubscriptionBillingEnabled", "CustomerTotpEnabled", "AdminCrmEnabled"];
const errorCodes = new Set([
  "invalid_inspection_context", "aws_read_failed", "unexpected_account", "unexpected_stack",
  "unstable_stack", "invalid_test_mode", "invalid_feature_flag", "invalid_parameters",
  "invalid_template", "invalid_resource_summary", "invalid_stack_timestamp",
]);
function fail(code) { throw Object.assign(new Error(code), { inspectionCode: code }); }
export function safeInspectionError(error) {
  return errorCodes.has(error?.inspectionCode) ? error.inspectionCode : "inspection_failed";
}

function defaultRunAws(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  }));
}
function readAws(runAws, args) {
  try { return runAws(args); } catch { fail("aws_read_failed"); }
}
function identifier(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,254}$/.test(value); }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid_stack_timestamp");
  return new Date(value).toISOString();
}

export function inspectTestStack({ environment = process.env, runAws = defaultRunAws, now = () => new Date() } = {}) {
  const expectedAccount = environment.EXPECTED_AWS_ACCOUNT_ID;
  if (environment.GITHUB_REF !== "refs/heads/main" || environment.GITHUB_REPOSITORY !== "saiidz/solvelang"
    || !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? "")
    || environment.AWS_REGION !== region || environment.STACK_NAME !== stackName
    || !/^\d{12}$/.test(expectedAccount ?? "") || environment.CONFIRM_INSPECTION_ONLY !== "true") fail("invalid_inspection_context");

  const identity = readAws(runAws, ["sts", "get-caller-identity", "--region", region]);
  if (identity?.Account !== expectedAccount) fail("unexpected_account");
  const stackArgs = ["--stack-name", stackName, "--region", region];
  const description = readAws(runAws, ["cloudformation", "describe-stacks", ...stackArgs]);
  const stack = description?.Stacks?.length === 1 ? description.Stacks[0] : undefined;
  const expectedArn = new RegExp(`^arn:aws:cloudformation:${region}:${expectedAccount}:stack/${stackName}/[a-f0-9-]+$`);
  if (stack?.StackName !== stackName || !expectedArn.test(stack?.StackId ?? "")) fail("unexpected_stack");
  if (!stableStatuses.has(stack.StackStatus)) fail("unstable_stack");
  if (!Array.isArray(stack.Parameters) || stack.Parameters.some(item => !identifier(item?.ParameterKey))) fail("invalid_parameters");
  const parameterNames = stack.Parameters.map(item => item.ParameterKey);
  if (new Set(parameterNames).size !== parameterNames.length) fail("invalid_parameters");
  const parameters = new Map(stack.Parameters.map(item => [item.ParameterKey, item.ParameterValue]));
  if (parameters.get("ApiAccessMode") !== "test") fail("invalid_test_mode");
  const features = {};
  for (const name of featureNames) {
    const value = parameters.get(name);
    if (value === undefined && ["CustomerTotpEnabled", "AdminCrmEnabled"].includes(name)) features[name] = null;
    else if (value === "true" || value === "false") features[name] = value === "true";
    else fail("invalid_feature_flag");
  }

  const templateResponse = readAws(runAws, ["cloudformation", "get-template", ...stackArgs, "--template-stage", "Processed"]);
  let template = templateResponse?.TemplateBody;
  if (typeof template === "string") {
    try { template = JSON.parse(template); } catch { fail("invalid_template"); }
  }
  if (!template || typeof template !== "object" || !template.Resources || typeof template.Resources !== "object" || Array.isArray(template.Resources)) fail("invalid_template");
  const resourcesResponse = readAws(runAws, ["cloudformation", "list-stack-resources", ...stackArgs]);
  if (!Array.isArray(resourcesResponse?.StackResourceSummaries)) fail("invalid_resource_summary");
  const resources = resourcesResponse.StackResourceSummaries.map(resource => {
    if (!identifier(resource?.LogicalResourceId) || !/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/.test(resource?.ResourceType ?? "")
      || !/^[A-Z_]+$/.test(resource?.ResourceStatus ?? "")) fail("invalid_resource_summary");
    return { logicalId: resource.LogicalResourceId, type: resource.ResourceType, status: resource.ResourceStatus };
  }).sort((a, b) => a.logicalId.localeCompare(b.logicalId));
  const apiFunction = template.Resources.ApiAccessFunction;
  const variables = apiFunction?.Properties?.Environment?.Variables;
  if (apiFunction?.Type !== "AWS::Lambda::Function" || !variables || typeof variables !== "object" || Array.isArray(variables)) fail("invalid_template");
  const environmentVariableNames = Object.keys(variables).filter(name => /^[A-Z][A-Z0-9_]{0,127}$/.test(name)).sort();
  const publicStatusDeclaration = variables.PUBLIC_STATUS_TABLE;
  const templateDeclaresPublicStatusTable = typeof publicStatusDeclaration === "string"
    ? publicStatusDeclaration.trim().length > 0
    : publicStatusDeclaration !== null && typeof publicStatusDeclaration === "object" && !Array.isArray(publicStatusDeclaration)
      && Object.keys(publicStatusDeclaration).length > 0;
  return {
    observedAt: now().toISOString(), sourceCommit: environment.GITHUB_SHA,
    stackName, region, accountIdentityVerified: true, stackStatus: stack.StackStatus,
    stackLastUpdatedAt: timestamp(stack.LastUpdatedTime ?? stack.CreationTime),
    mode: "test", features, parameterNames: parameterNames.sort(),
    templateSha256: createHash("sha256").update(JSON.stringify(template)).digest("hex"),
    templateHandlerEnvironmentVariableNames: environmentVariableNames,
    templateDeclaresPublicStatusTable,
    resources,
    limitations: ["Template declarations and stack parameters only; effective Lambda configuration and out-of-band drift are not verified.", "Read-only stack inspection; no changeset, deployment or application acceptance performed."],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = inspectTestStack();
    const json = JSON.stringify(report, null, 2);
    console.log(json);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## SolveLang test-stack inspection\n\nRead-only; no deployment or billing action.\n\n\`\`\`json\n${json}\n\`\`\`\n`);
  } catch (error) {
    // CLI errors can contain response buffers, parameters or credentials. Never print them.
    console.error(`Test-stack inspection failed: ${safeInspectionError(error)}. No deployment was performed.`);
    process.exitCode = 1;
  }
}
