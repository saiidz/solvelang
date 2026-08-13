import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL("../template.yaml", import.meta.url);
const protectorUrl = new URL("../src/totp-kms.js", import.meta.url);

test("TOTP runtime KMS IAM permission requires the same account-bound encryption context used by the protector", async () => {
  const [template, protector] = await Promise.all([
    readFile(templateUrl, "utf8"),
    readFile(protectorUrl, "utf8"),
  ]);

  assert.match(template, /kms:EncryptionContext:purpose: solvelang-customer-totp/);
  assert.match(template, /kms:EncryptionContext:accountId: acct_\*/);
  assert.match(template, /ForAllValues:StringEquals:[\s\S]*kms:EncryptionContextKeys:[\s\S]*- purpose[\s\S]*- accountId/);
  assert.match(protector, /const PURPOSE = "solvelang-customer-totp"/);
  assert.match(protector, /return \{ purpose: PURPOSE, accountId \}/);
});
