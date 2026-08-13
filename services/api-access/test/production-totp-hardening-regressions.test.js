import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findProductionStripeSecretReferences } from "../scripts/assert-no-production-stripe-secret-references.mjs";

const root = new URL("../../../", import.meta.url);
const deployUrl = new URL(".github/workflows/deploy-api-access-production-totp.yml", root);
const preflightUrl = new URL(".github/workflows/preflight-api-access-production-totp.yml", root);
const deployPolicyUrl = new URL("ops/aws/production-foundation-deploy-policy.json", root);

async function text(url) {
  return readFile(url, "utf8");
}

test("production TOTP workflows contain no Stripe secret references and use the non-self-matching guard", async () => {
  const deploy = await text(deployUrl);
  const preflight = await text(preflightUrl);
  assert.deepEqual(findProductionStripeSecretReferences(deploy), []);
  assert.deepEqual(findProductionStripeSecretReferences(preflight), []);
  assert.match(deploy, /node scripts\/assert-no-production-stripe-secret-references\.mjs/);
  assert.match(preflight, /node scripts\/assert-no-production-stripe-secret-references\.mjs/);
});

test("Stripe secret guard detects real GitHub secret references without embedding those references in its own workflow call", () => {
  const secretKey = ["STRIPE", "SECRET", "KEY"].join("_");
  const webhookKey = ["STRIPE", "SUBSCRIPTION", "WEBHOOK", "SECRET"].join("_");
  const source = [
    "env:",
    `  BILLING_ONE: \${{ secrets.${secretKey} }}`,
    `  BILLING_TWO: \${{secrets.${webhookKey}}}`,
  ].join("\n");
  assert.deepEqual(
    findProductionStripeSecretReferences(source),
    [["secrets", secretKey].join("."), ["secrets", webhookKey].join(".")],
  );
});

test("production deploy role can turn TOTP key rotation on but cannot turn it off", async () => {
  const policy = JSON.parse(await text(deployPolicyUrl));
  const actions = policy.Statement.flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
  assert.ok(actions.includes("kms:EnableKeyRotation"));
  assert.ok(!actions.includes("kms:DisableKeyRotation"));
  assert.ok(!actions.includes("kms:ScheduleKeyDeletion"));
  assert.ok(!actions.includes("kms:DisableKey"));
  assert.ok(!actions.includes("kms:PutKeyPolicy"));
});
