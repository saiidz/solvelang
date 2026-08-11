import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-foundation.yml", import.meta.url);

test("production artifact bucket stays region-specific and within the S3 name limit", async () => {
  const source = await readFile(workflowUrl, "utf8");
  assert.match(source, /region_slug="\$\{AWS_REGION\/\/-\/\}"/);
  assert.match(source, /solvelang-api-access-production-artifacts-\$\{account_id\}-\$\{region_slug\}/);
  assert.match(source, /\$\{#bucket\} <= 63/);

  const accountId = "817198673108";
  const region = "us-east-2";
  const regionSlug = region.replaceAll("-", "");
  const bucket = `solvelang-api-access-production-artifacts-${accountId}-${regionSlug}`;
  assert.equal(bucket, "solvelang-api-access-production-artifacts-817198673108-useast2");
  assert.ok(bucket.length <= 63);
});
