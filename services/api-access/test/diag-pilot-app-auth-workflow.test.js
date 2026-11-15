import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/diag-pilot-app-auth.yml", import.meta.url);
async function workflow() { return await readFile(workflowUrl, "utf8"); }

test("diagnostic workflow is dispatch-only", async () => {
  const source = await workflow();
  assert.match(source, /^on:\n  workflow_dispatch:$/m);
  assert.doesNotMatch(source, /^  (pull_request|push|schedule):/m);
});

test("diagnostic workflow runs in the api-access-production environment", async () => {
  const source = await workflow();
  assert.match(source, /environment: api-access-production/);
});

test("diagnostic workflow assumes the pilot deploy role the same way as the pilot deploy", async () => {
  const source = await workflow();
  assert.match(source, /uses: aws-actions\/configure-aws-credentials@v4/);
  assert.match(source, /role-to-assume: \$\{\{ secrets\.AWS_DEPLOY_ROLE_ARN \}\}/);
});

test("the only secret references are the key env assignment and the deploy role", async () => {
  const source = await workflow();
  const references = source.match(/secrets\.[A-Z_]+/g) ?? [];
  assert.deepEqual(
    [...new Set(references)].sort(),
    ["secrets.AWS_DEPLOY_ROLE_ARN", "secrets.GH_APP_PRIVATE_KEY"],
  );
});

test("every shell expansion of the private key is piped through a shaping command", async () => {
  const source = await workflow();
  const lines = source.split("\n").filter((line) => line.includes("$GH_APP_PRIVATE_KEY"));
  assert.ok(lines.length >= 3, "expected the key to be measured at the secret and transport hops");
  for (const line of lines) {
    assert.match(line, /(sha256sum|wc -c|base64)/, line);
  }
});

test("no step echoes the private key or its base64 raw", async () => {
  const source = await workflow();
  // Lengths and hashes are printed; the value itself and its base64 are
  // never the argument of an echo, and the Lambda-side inspection never
  // prints the received value or its decoded bytes either.
  assert.doesNotMatch(source, /echo\s+"?\$(GH_APP_PRIVATE_KEY|encoded)"?(\s|$)/);
  assert.doesNotMatch(source, /print\((key|decoded)\)/);
});
