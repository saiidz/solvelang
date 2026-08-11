import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-foundation.yml", import.meta.url);

function regionHash(region) {
  return createHash("sha256").update(region).digest("hex").slice(0, 8);
}

function artifactBucket(accountId, region) {
  return `solvelang-api-access-production-artifacts-${accountId}-${regionHash(region)}`;
}

test("production artifact bucket keeps a bounded deterministic region discriminator", async () => {
  const source = await readFile(workflowUrl, "utf8");
  assert.match(source, /region_hash="\$\(printf '%s' "\$AWS_REGION" \| sha256sum \| cut -c1-8\)"/);
  assert.match(source, /\^\[a-f0-9\]\{8\}\$/);
  assert.match(source, /solvelang-api-access-production-artifacts-\$\{account_id\}-\$\{region_hash\}/);
  assert.match(source, /\$\{#bucket\} <= 63/);

  const accountId = "817198673108";
  for (const region of ["us-east-2", "eu-central-1", "ap-southeast-2", "us-gov-west-1"]) {
    const bucket = artifactBucket(accountId, region);
    assert.equal(bucket.length, 63);
    assert.match(bucket, /^solvelang-api-access-production-artifacts-817198673108-[a-f0-9]{8}$/);
  }

  assert.notEqual(artifactBucket(accountId, "us-east-2"), artifactBucket(accountId, "eu-central-1"));
});
