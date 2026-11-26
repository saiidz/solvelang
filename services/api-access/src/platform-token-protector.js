import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";

// KMS sealing for customer-supplied platform access tokens
// (repository-audit platform connections). This is the sibling of
// totp-kms.js and follows the same discipline exactly: the token
// is encrypted with the customer-secrets KMS key under an
// encryption context bound to BOTH this purpose and the owning
// account, so a ciphertext lifted out of one account's record
// cannot be decrypted as another account's token, and the
// template's IAM policy can allow this purpose separately from
// the TOTP purpose. Only the base64 ciphertext and a short
// SHA-256 fingerprint ever leave this module's callers — the
// plaintext token exists only for the duration of the register
// request and is never stored, logged, or returned.

const PURPOSE = "solvelang-platform-connection";

function context(accountId) {
  if (typeof accountId !== "string" || !/^acct_[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("Platform connection account identifier is invalid.");
  }
  return { purpose: PURPOSE, accountId };
}

export function createPlatformTokenProtector(kmsClient, keyArn) {
  if (!kmsClient || typeof kmsClient.send !== "function") throw new Error("KMS client is required.");
  if (typeof keyArn !== "string" || !/^arn:[^:]+:kms:[^:]+:\d{12}:key\/.+/.test(keyArn)) {
    throw new Error("Platform connection KMS key ARN is required.");
  }

  return {
    async encrypt(accountId, token) {
      if (typeof token !== "string" || token.length < 8 || token.length > 8192) {
        throw new Error("Platform access token is invalid.");
      }
      const response = await kmsClient.send(new EncryptCommand({
        KeyId: keyArn,
        Plaintext: Buffer.from(token, "utf8"),
        EncryptionContext: context(accountId),
      }));
      if (!response.CiphertextBlob) throw new Error("KMS did not return encrypted platform token data.");
      return Buffer.from(response.CiphertextBlob).toString("base64");
    },

    async decrypt(accountId, ciphertext) {
      if (typeof ciphertext !== "string" || !ciphertext) throw new Error("Encrypted platform token is missing.");
      const response = await kmsClient.send(new DecryptCommand({
        KeyId: keyArn,
        CiphertextBlob: Buffer.from(ciphertext, "base64"),
        EncryptionContext: context(accountId),
      }));
      if (!response.Plaintext) throw new Error("KMS did not return decrypted platform token data.");
      return Buffer.from(response.Plaintext).toString("utf8");
    },
  };
}
