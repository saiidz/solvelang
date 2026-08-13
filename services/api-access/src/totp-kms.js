import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";

const PURPOSE = "solvelang-customer-totp";

function context(accountId) {
  if (typeof accountId !== "string" || !/^acct_[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("TOTP account identifier is invalid.");
  }
  return { purpose: PURPOSE, accountId };
}

export function createTotpSecretProtector(kmsClient, keyArn) {
  if (!kmsClient || typeof kmsClient.send !== "function") throw new Error("KMS client is required.");
  if (typeof keyArn !== "string" || !/^arn:[^:]+:kms:[^:]+:\d{12}:key\/.+/.test(keyArn)) {
    throw new Error("TOTP KMS key ARN is required.");
  }

  return {
    async encrypt(accountId, secret) {
      if (typeof secret !== "string" || secret.length < 16 || secret.length > 128) {
        throw new Error("TOTP secret is invalid.");
      }
      const response = await kmsClient.send(new EncryptCommand({
        KeyId: keyArn,
        Plaintext: Buffer.from(secret, "utf8"),
        EncryptionContext: context(accountId),
      }));
      if (!response.CiphertextBlob) throw new Error("KMS did not return encrypted TOTP data.");
      return Buffer.from(response.CiphertextBlob).toString("base64");
    },

    async decrypt(accountId, ciphertext) {
      if (typeof ciphertext !== "string" || !ciphertext) throw new Error("Encrypted TOTP secret is missing.");
      const response = await kmsClient.send(new DecryptCommand({
        KeyId: keyArn,
        CiphertextBlob: Buffer.from(ciphertext, "base64"),
        EncryptionContext: context(accountId),
      }));
      if (!response.Plaintext) throw new Error("KMS did not return decrypted TOTP data.");
      return Buffer.from(response.Plaintext).toString("utf8");
    },
  };
}
