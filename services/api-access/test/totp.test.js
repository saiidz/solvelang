import assert from "node:assert/strict";
import { test } from "node:test";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { authenticatorUri, encodeBase32, generateTotpCode, matchingTotpStep, totpStep } from "../src/totp.js";
import { createTotpSecretProtector } from "../src/totp-kms.js";

test("TOTP matches RFC 6238 SHA-1 vectors", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  const vectors = [
    [59_000, "94287082"],
    [1_111_111_109_000, "07081804"],
    [1_111_111_111_000, "14050471"],
    [1_234_567_890_000, "89005924"],
    [2_000_000_000_000, "69279037"],
    [20_000_000_000_000, "65353130"],
  ];
  for (const [timestamp, expected] of vectors) {
    assert.equal(generateTotpCode(secret, totpStep(timestamp), 8), expected);
  }
});

test("six-digit verification accepts a one-step clock window and returns the exact step", () => {
  const secret = encodeBase32(Buffer.alloc(20, 7));
  const timestamp = 1_800_000_000_000;
  const step = totpStep(timestamp);
  const previous = generateTotpCode(secret, step - 1);
  const current = generateTotpCode(secret, step);
  const next = generateTotpCode(secret, step + 1);
  assert.equal(matchingTotpStep(secret, previous, timestamp), step - 1);
  assert.equal(matchingTotpStep(secret, current, timestamp), step);
  assert.equal(matchingTotpStep(secret, next, timestamp), step + 1);
  assert.equal(matchingTotpStep(secret, "00000", timestamp), undefined);
  assert.equal(matchingTotpStep(secret, generateTotpCode(secret, step + 2), timestamp), undefined);
});

test("authenticator URI is standards-compatible and does not alter the secret", () => {
  const secret = encodeBase32(Buffer.alloc(20, 3));
  const uri = new URL(authenticatorUri({ secret, accountLabel: "user@example.com" }));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.hostname, "totp");
  assert.equal(uri.searchParams.get("secret"), secret);
  assert.equal(uri.searchParams.get("issuer"), "SolveLang");
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
});

test("KMS protector binds encrypted TOTP material to non-secret account context", async () => {
  const calls = [];
  const ciphertext = Buffer.from("ciphertext");
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof EncryptCommand) return { CiphertextBlob: ciphertext };
      if (command instanceof DecryptCommand) return { Plaintext: Buffer.from("ABCDEF234567", "utf8") };
      throw new Error("unexpected command");
    },
  };
  const protector = createTotpSecretProtector(client, "arn:aws:kms:us-east-2:123456789012:key/example");
  const accountId = `acct_${"a".repeat(32)}`;
  const encrypted = await protector.encrypt(accountId, "ABCDEF234567");
  assert.equal(encrypted, ciphertext.toString("base64"));
  assert.equal(await protector.decrypt(accountId, encrypted), "ABCDEF234567");
  assert.deepEqual(calls[0].input.EncryptionContext, { purpose: "solvelang-customer-totp", accountId });
  assert.deepEqual(calls[1].input.EncryptionContext, { purpose: "solvelang-customer-totp", accountId });
  assert.equal(calls[0].input.KeyId, calls[1].input.KeyId);
});
