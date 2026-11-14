import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-merge-governance-pilot.yml", import.meta.url);
async function workflow() { return await readFile(workflowUrl, "utf8"); }

test("pilot dispatcher reads the branded product app credentials from environment secrets", async () => {
  const source = await workflow();
  assert.match(source, /MGOV_PRODUCT_APP_ID: \$\{\{ secrets\.MGOV_PRODUCT_APP_ID \}\}/);
  assert.match(source, /MGOV_PRODUCT_APP_PRIVATE_KEY: \$\{\{ secrets\.MGOV_PRODUCT_APP_PRIVATE_KEY \}\}/);
});

test("pilot dispatcher passes the product app parameters only when the secrets are set", async () => {
  const source = await workflow();
  assert.match(source, /\[\[ -z "\$MGOV_PRODUCT_APP_ID" \]\] \|\| parameters\+=\(ProductAppId="\$MGOV_PRODUCT_APP_ID" ProductAppSlug="solvelang-process-solution"\)/);
  assert.match(source, /\[\[ -z "\$MGOV_PRODUCT_APP_PRIVATE_KEY" \]\] \|\| parameters\+=\(ProductAppPrivateKeyB64="\$MGOV_PRODUCT_APP_PRIVATE_KEY_B64"\)/);
});

test("product app private key travels base64-encoded, like the reader app key", async () => {
  const source = await workflow();
  assert.match(source, /printf 'MGOV_PRODUCT_APP_PRIVATE_KEY_B64=%s\\n' "\$\(printf '%s' "\$MGOV_PRODUCT_APP_PRIVATE_KEY" \| base64 -w 0\)" >> "\$GITHUB_ENV"/);
});

test("deployment summary reports the product app state", async () => {
  const source = await workflow();
  assert.match(source, /product_app_line="not configured"/);
  assert.match(source, /\[\[ -z "\$MGOV_PRODUCT_APP_ID" \]\] \|\| product_app_line="configured \(parameters passed\)"/);
  assert.match(source, /echo "- Product app: \*\*\$product_app_line\*\*"/);
});

test("the product webhook secret is wired from the environment secret", async () => {
  const source = await workflow();
  assert.match(source, /MGOV_PRODUCT_WEBHOOK_SECRET: \$\{\{ secrets\.MGOV_PRODUCT_WEBHOOK_SECRET \}\}/);
  assert.match(source, /\[\[ -z "\$MGOV_PRODUCT_WEBHOOK_SECRET" \]\] \|\| parameters\+=\(ProductWebhookSecret="\$MGOV_PRODUCT_WEBHOOK_SECRET"\)/);
});
