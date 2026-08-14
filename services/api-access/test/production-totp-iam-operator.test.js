import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preflightPolicyUrl = new URL("../../../ops/aws/production-totp-preflight-supplemental-policy.json", import.meta.url);
const deployPolicyUrl = new URL("../../../ops/aws/production-totp-deploy-supplemental-policy.json", import.meta.url);
const verifierUrl = new URL("../../../ops/aws/verify-production-totp-role-supplements.sh", import.meta.url);

function actions(policy) {
  return policy.Statement.flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
}

test("TOTP preflight IAM supplement remains validation/read-only", async () => {
  const policy = JSON.parse(await readFile(preflightPolicyUrl, "utf8"));
  const all = actions(policy);
  assert.equal(policy.Version, "2012-10-17");
  assert.ok(all.includes("cloudformation:ValidateTemplate"));
  assert.ok(all.includes("kms:DescribeKey"));
  for (const action of all) {
    assert.match(action, /^(cloudformation:(Describe|Get|List)|cloudformation:ValidateTemplate|kms:(Describe|Get|List))/);
  }
  assert.doesNotMatch(JSON.stringify(policy), /kms:(Encrypt|Decrypt|CreateKey|DisableKey|ScheduleKeyDeletion|PutKeyPolicy)/);
  assert.doesNotMatch(JSON.stringify(policy), /iam:/);
});

test("TOTP deploy IAM supplement grants only tagged key bootstrap/management and no cryptographic or destructive key actions", async () => {
  const policy = JSON.parse(await readFile(deployPolicyUrl, "utf8"));
  const all = actions(policy);
  assert.ok(all.includes("kms:CreateKey"));
  assert.ok(all.includes("kms:EnableKeyRotation"));
  assert.ok(all.includes("cloudformation:UpdateTerminationProtection"));
  for (const forbidden of [
    "kms:Encrypt",
    "kms:Decrypt",
    "kms:DisableKey",
    "kms:ScheduleKeyDeletion",
    "kms:CancelKeyDeletion",
    "kms:PutKeyPolicy",
    "kms:DisableKeyRotation",
    "kms:*",
  ]) assert.equal(all.includes(forbidden), false, forbidden);
  assert.equal(all.some((action) => action.startsWith("iam:")), false);

  const create = policy.Statement.find((statement) => statement.Action === "kms:CreateKey");
  assert.ok(create);
  assert.equal(create.Resource, "*");
  assert.equal(create.Condition.StringEquals["kms:KeySpec"], "SYMMETRIC_DEFAULT");
  assert.equal(create.Condition.StringEquals["kms:KeyUsage"], "ENCRYPT_DECRYPT");
  assert.equal(create.Condition.StringEquals["aws:RequestTag/Project"], "SolveLang");
  assert.equal(create.Condition.StringEquals["aws:RequestTag/Purpose"], "customer-totp");
  assert.equal(create.Condition.StringEquals["aws:RequestTag/Environment"], "production");

  const serialized = JSON.stringify(policy);
  assert.match(serialized, /solvelang-api-access-production-totp-kms/);
  assert.match(serialized, /alias\/solvelang-customer-totp-production/);
});

test("read-only IAM verifier validates exact protected-environment trust and contains no AWS write command", async () => {
  const source = await readFile(verifierUrl, "utf8");
  assert.match(source, /repo:saiidz\/solvelang:environment:api-access-production/);
  assert.match(source, /token\.actions\.githubusercontent\.com:aud/);
  assert.match(source, /token\.actions\.githubusercontent\.com:sub/);
  assert.match(source, /sts:AssumeRoleWithWebIdentity/);
  assert.match(source, /aws sts get-caller-identity/);
  assert.match(source, /aws iam get-role/);
  assert.match(source, /PREFLIGHT_ROLE_ARN/);
  assert.match(source, /DEPLOY_ROLE_ARN/);
  assert.match(source, /No AWS resource was changed/);
  assert.doesNotMatch(source, /aws iam put-role-policy/);
  assert.doesNotMatch(source, /aws iam delete-role-policy/);
  assert.doesNotMatch(source, /aws iam update-assume-role-policy/);
  assert.doesNotMatch(source, /aws kms (create|disable|schedule|put)/);
});
