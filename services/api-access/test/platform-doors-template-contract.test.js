import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// QA pins for the platform-doors template train: the gateway
// events, env pointer, and KMS permission for the repository
// audit's non-GitHub connections live on GitHubFunction — the
// function that already serves the audit page's other session
// reads — because ApiAccessFunction sits at its pinned 44-event
// resource-policy ceiling.

const templateUrl = new URL("../template.yaml", import.meta.url);

function resourceBlock(source, name) {
  const start = source.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `${name} exists in the template`);
  const rest = source.slice(start + 1);
  const next = rest.slice(name.length + 3).search(/\n  [A-Z][A-Za-z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 3 + next);
}

test("the platform-connection events live on GitHubFunction, never on ApiAccessFunction", async () => {
  const source = await readFile(templateUrl, "utf8");
  const github = resourceBlock(source, "GitHubFunction");
  const apiAccess = resourceBlock(source, "ApiAccessFunction");
  assert.ok(github.includes("Path: /customer/platform-connections"), "register/list path on GitHubFunction");
  assert.ok(github.includes("Path: /customer/platform-connections/{proxy+}"), "greedy audit path on GitHubFunction");
  assert.ok(github.includes("CustomerPlatformConnectionsRegister:"), "register event named");
  assert.ok(github.includes("CustomerPlatformConnectionsList:"), "list event named");
  assert.ok(github.includes("CustomerPlatformConnectionsAudit:"), "audit event named");
  assert.equal(apiAccess.includes("/customer/platform-connections"), false, "ApiAccessFunction stays at its cured event ceiling");
});

test("GitHubFunction points the platform token protector at the customer-secrets key with its own conditioned KMS statement", async () => {
  const source = await readFile(templateUrl, "utf8");
  const github = resourceBlock(source, "GitHubFunction");
  assert.ok(github.includes("API_PLATFORM_TOKENS_KMS_KEY_ARN: !Ref CustomerTotpKmsKeyArn"), "env pointer at the existing key parameter — no new stack parameter");
  assert.ok(github.includes("PlatformConnectionsFeatureEnabled"), "the statement is separately conditioned");
  assert.match(github, /kms:EncryptionContext:purpose: solvelang-platform-connection/);
  assert.match(github, /kms:EncryptionContext:accountId: acct_\*/);
  assert.match(source, /PlatformConnectionsFeatureEnabled: !Equals \[!Ref CustomerAccountsEnabled, "true"\]/);
});
