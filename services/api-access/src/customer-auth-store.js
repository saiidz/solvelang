import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

function required(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Customer authentication table is required.");
}

function authVersionOf(value) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Customer authentication version is invalid.");
  return value;
}

export function createDynamoCustomerAuthStore(documentClient, tableName) {
  required(documentClient, tableName);

  async function account(accountId) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey: `account#${accountId}` },
      ConsistentRead: true,
    }));
    return response.Item?.kind === "account" ? response.Item : undefined;
  }

  function sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }) {
    return {
      Update: {
        TableName: tableName,
        Key: { authKey: `session#${sessionId}` },
        UpdateExpression: "SET authVersion = :nextAuthVersion",
        ConditionExpression: "kind = :sessionKind AND accountId = :accountId AND ((attribute_not_exists(authVersion) AND :currentAuthVersion = :one) OR authVersion = :currentAuthVersion)",
        ExpressionAttributeValues: {
          ":sessionKind": "session",
          ":accountId": accountId,
          ":currentAuthVersion": currentAuthVersion,
          ":nextAuthVersion": nextAuthVersion,
          ":one": 1,
        },
      },
    };
  }

  function accountVersionCondition(existing) {
    return existing.authVersion === undefined ? "attribute_not_exists(authVersion)" : "authVersion = :currentAuthVersion";
  }

  function accountVersionValues(existing, nextAuthVersion) {
    return {
      ":accountKind": "account",
      ":currentAuthVersion": authVersionOf(existing.authVersion),
      ":nextAuthVersion": nextAuthVersion,
    };
  }

  async function magicState(tokenId, now) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey: `magic#${tokenId}` },
      ConsistentRead: true,
    }));
    const magic = response.Item;
    if (!magic || magic.kind !== "magic" || magic.expiresAt <= now) return undefined;
    const existingAccount = await account(magic.accountId);
    const currentAuthVersion = authVersionOf(existingAccount?.authVersion);
    const magicAuthVersion = authVersionOf(magic.authVersion);
    if (magicAuthVersion !== currentAuthVersion) return undefined;
    return { magic, existingAccount, currentAuthVersion };
  }

  return {
    async reserveSourceRequest({ sourceKey, window, limit, expiresAt }) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { authKey: `source#${sourceKey}#${window}` },
          UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expiresAt, kind = :kind",
          ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
          ExpressionAttributeNames: { "#count": "requestCount" },
          ExpressionAttributeValues: {
            ":zero": 0,
            ":one": 1,
            ":limit": limit,
            ":expiresAt": expiresAt,
            ":kind": "source-throttle",
          },
        }));
        return "created";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "limited";
        throw error;
      }
    },

    async reserveEmailRequest({ throttleKey, now, expiresAt }) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: { authKey: `throttle#${throttleKey}`, kind: "throttle", expiresAt },
          ConditionExpression: "attribute_not_exists(authKey) OR expiresAt <= :now",
          ExpressionAttributeValues: { ":now": now },
        }));
        return "created";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "limited";
        throw error;
      }
    },

    async putMagicLink(record) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: { authKey: `magic#${record.tokenId}`, kind: "magic", ...record },
        ConditionExpression: "attribute_not_exists(authKey)",
      }));
    },

    async consumeMagicLinkAndCreateSession({ tokenId, presentedFingerprint, now, session }) {
      const state = await magicState(tokenId, now);
      if (!state) return undefined;
      const { magic, currentAuthVersion } = state;
      const sessionItem = {
        authKey: `session#${session.sessionId}`,
        kind: "session",
        ...session,
        accountId: magic.accountId,
        email: magic.email,
        authVersion: currentAuthVersion,
      };
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName,
                Key: { authKey: `magic#${tokenId}` },
                ConditionExpression: "secretFingerprint = :fingerprint AND expiresAt > :now",
                ExpressionAttributeValues: { ":fingerprint": presentedFingerprint, ":now": now },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: sessionItem,
                ConditionExpression: "attribute_not_exists(authKey)",
              },
            },
          ],
        }));
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return undefined;
        throw error;
      }
      return { accountId: magic.accountId, email: magic.email, authVersion: currentAuthVersion };
    },

    async consumeMagicLinkForAuth({ tokenId, presentedFingerprint, now, session, mfaChallenge }) {
      const state = await magicState(tokenId, now);
      if (!state) return undefined;
      const { magic, existingAccount, currentAuthVersion } = state;
      const mfaRequired = Boolean(existingAccount?.totpEnabledAt && existingAccount?.totpSecretCiphertext);
      const item = mfaRequired
        ? {
            authKey: `mfa#${mfaChallenge.challengeId}`,
            kind: "mfa",
            ...mfaChallenge,
            accountId: magic.accountId,
            email: magic.email,
            authVersion: currentAuthVersion,
            attemptCount: 0,
          }
        : {
            authKey: `session#${session.sessionId}`,
            kind: "session",
            ...session,
            accountId: magic.accountId,
            email: magic.email,
            authVersion: currentAuthVersion,
          };
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName,
                Key: { authKey: `magic#${tokenId}` },
                ConditionExpression: "secretFingerprint = :fingerprint AND expiresAt > :now",
                ExpressionAttributeValues: { ":fingerprint": presentedFingerprint, ":now": now },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: item,
                ConditionExpression: "attribute_not_exists(authKey)",
              },
            },
          ],
        }));
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return undefined;
        throw error;
      }
      return { accountId: magic.accountId, email: magic.email, authVersion: currentAuthVersion, mfaRequired };
    },

    async ensureAccount({ accountId, email, createdAt }) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            authKey: `account#${accountId}`,
            kind: "account",
            accountId,
            email,
            authVersion: 1,
            createdAt,
            updatedAt: createdAt,
          },
          ConditionExpression: "attribute_not_exists(authKey)",
        }));
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
        const existing = await account(accountId);
        if (!existing || existing.email !== email) throw new Error("Customer account identity conflict.");
        authVersionOf(existing.authVersion);
      }
      return account(accountId);
    },

    async getAccount(accountId) {
      return account(accountId);
    },

    async getUsername(username) {
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { authKey: `username#${username}` },
        ConsistentRead: true,
      }));
      return response.Item?.kind === "username" ? response.Item : undefined;
    },

    async setCredentials({
      accountId,
      sessionId,
      username,
      passwordSalt,
      passwordHash,
      passwordScheme,
      passwordUpdatedAt,
    }) {
      const existing = await account(accountId);
      if (!existing) return "missing";
      if (existing.username && existing.username !== username) return "username_locked";

      const currentAuthVersion = authVersionOf(existing.authVersion);
      const nextAuthVersion = currentAuthVersion + 1;
      if (!Number.isSafeInteger(nextAuthVersion)) throw new Error("Customer authentication version overflowed.");
      const accountCondition = accountVersionCondition(existing);
      const commonAccountValues = {
        ":passwordSalt": passwordSalt,
        ":passwordHash": passwordHash,
        ":passwordScheme": passwordScheme,
        ":passwordUpdatedAt": passwordUpdatedAt,
        ":accountKind": "account",
        ":currentAuthVersion": currentAuthVersion,
        ":nextAuthVersion": nextAuthVersion,
      };

      try {
        if (existing.username === username) {
          await documentClient.send(new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { authKey: `account#${accountId}` },
                  UpdateExpression: "SET passwordSalt = :passwordSalt, passwordHash = :passwordHash, passwordScheme = :passwordScheme, passwordUpdatedAt = :passwordUpdatedAt, updatedAt = :passwordUpdatedAt, authVersion = :nextAuthVersion",
                  ConditionExpression: `kind = :accountKind AND username = :username AND ${accountCondition}`,
                  ExpressionAttributeValues: { ...commonAccountValues, ":username": username },
                },
              },
              sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }),
            ],
          }));
          return "updated";
        }

        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: {
                  authKey: `username#${username}`,
                  kind: "username",
                  username,
                  accountId,
                  createdAt: passwordUpdatedAt,
                },
                ConditionExpression: "attribute_not_exists(authKey)",
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: { authKey: `account#${accountId}` },
                UpdateExpression: "SET username = :username, passwordSalt = :passwordSalt, passwordHash = :passwordHash, passwordScheme = :passwordScheme, passwordUpdatedAt = :passwordUpdatedAt, updatedAt = :passwordUpdatedAt, authVersion = :nextAuthVersion",
                ConditionExpression: `kind = :accountKind AND attribute_not_exists(username) AND ${accountCondition}`,
                ExpressionAttributeValues: { ...commonAccountValues, ":username": username },
              },
            },
            sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }),
          ],
        }));
        return "updated";
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return "conflict";
        throw error;
      }
    },

    async putSession({ session, accountId, email }) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          authKey: `session#${session.sessionId}`,
          kind: "session",
          ...session,
          accountId,
          email,
        },
        ConditionExpression: "attribute_not_exists(authKey)",
      }));
    },

    async getSession(sessionId) {
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { authKey: `session#${sessionId}` },
        ConsistentRead: true,
      }));
      if (response.Item?.kind !== "session" || response.Item.revokedAt) return undefined;
      return response.Item;
    },

    async revokeSession(sessionId, revokedAt) {
      const expiresAt = Math.floor(Date.parse(revokedAt) / 1_000);
      if (!Number.isSafeInteger(expiresAt)) throw new Error("Session revocation timestamp is invalid.");
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { authKey: `session#${sessionId}` },
          UpdateExpression: "SET revokedAt = :revokedAt, expiresAt = :expiresAt",
          ConditionExpression: "attribute_exists(authKey)",
          ExpressionAttributeValues: { ":revokedAt": revokedAt, ":expiresAt": expiresAt },
        }));
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
      }
    },

    async putMfaChallenge({ challenge, accountId, email }) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          authKey: `mfa#${challenge.challengeId}`,
          kind: "mfa",
          ...challenge,
          accountId,
          email,
          attemptCount: 0,
        },
        ConditionExpression: "attribute_not_exists(authKey)",
      }));
    },

    async reserveMfaAttempt({ challengeId, presentedFingerprint, now, limit }) {
      try {
        const response = await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { authKey: `mfa#${challengeId}` },
          UpdateExpression: "SET attemptCount = if_not_exists(attemptCount, :zero) + :one",
          ConditionExpression: "kind = :kind AND secretFingerprint = :fingerprint AND expiresAt > :now AND (attribute_not_exists(attemptCount) OR attemptCount < :limit)",
          ExpressionAttributeValues: {
            ":kind": "mfa",
            ":fingerprint": presentedFingerprint,
            ":now": now,
            ":zero": 0,
            ":one": 1,
            ":limit": limit,
          },
          ReturnValues: "ALL_NEW",
        }));
        return response.Attributes?.kind === "mfa" ? response.Attributes : undefined;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return undefined;
        throw error;
      }
    },

    async consumeMfaChallengeAndCreateSession({
      challenge,
      presentedFingerprint,
      now,
      session,
      totpStep,
      backupCodeFingerprint,
      backupIndex,
    }) {
      const accountValues = {
        ":accountKind": "account",
        ":authVersion": challenge.authVersion,
      };
      let accountUpdate;
      if (Number.isSafeInteger(totpStep)) {
        accountUpdate = {
          Update: {
            TableName: tableName,
            Key: { authKey: `account#${challenge.accountId}` },
            UpdateExpression: "SET totpLastStep = :totpStep",
            ConditionExpression: "kind = :accountKind AND authVersion = :authVersion AND attribute_exists(totpEnabledAt) AND attribute_exists(totpSecretCiphertext) AND (attribute_not_exists(totpLastStep) OR totpLastStep < :totpStep)",
            ExpressionAttributeValues: { ...accountValues, ":totpStep": totpStep },
          },
        };
      } else if (Number.isSafeInteger(backupIndex) && typeof backupCodeFingerprint === "string") {
        accountUpdate = {
          Update: {
            TableName: tableName,
            Key: { authKey: `account#${challenge.accountId}` },
            UpdateExpression: `SET backupCodeCount = backupCodeCount - :one REMOVE backupCodeFingerprints[${backupIndex}]`,
            ConditionExpression: `kind = :accountKind AND authVersion = :authVersion AND backupCodeCount > :zero AND backupCodeFingerprints[${backupIndex}] = :backupCodeFingerprint`,
            ExpressionAttributeValues: {
              ...accountValues,
              ":one": 1,
              ":zero": 0,
              ":backupCodeFingerprint": backupCodeFingerprint,
            },
          },
        };
      } else {
        throw new Error("MFA proof is required.");
      }

      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName,
                Key: { authKey: `mfa#${challenge.challengeId}` },
                ConditionExpression: "kind = :kind AND secretFingerprint = :fingerprint AND expiresAt > :now AND accountId = :accountId AND authVersion = :authVersion",
                ExpressionAttributeValues: {
                  ":kind": "mfa",
                  ":fingerprint": presentedFingerprint,
                  ":now": now,
                  ":accountId": challenge.accountId,
                  ":authVersion": challenge.authVersion,
                },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  authKey: `session#${session.sessionId}`,
                  kind: "session",
                  ...session,
                  accountId: challenge.accountId,
                  email: challenge.email,
                  authVersion: challenge.authVersion,
                },
                ConditionExpression: "attribute_not_exists(authKey)",
              },
            },
            accountUpdate,
          ],
        }));
        return "consumed";
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return "conflict";
        throw error;
      }
    },

    async putTotpPending({ accountId, secretCiphertext, createdAt, expiresAt }) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          authKey: `totp-pending#${accountId}`,
          kind: "totp-pending",
          accountId,
          secretCiphertext,
          createdAt,
          expiresAt,
        },
      }));
    },

    async getTotpPending(accountId) {
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { authKey: `totp-pending#${accountId}` },
        ConsistentRead: true,
      }));
      return response.Item?.kind === "totp-pending" ? response.Item : undefined;
    },

    async enableTotp({
      accountId,
      sessionId,
      secretCiphertext,
      enabledAt,
      now,
      backupCodeFingerprints,
      totpStep,
    }) {
      const existing = await account(accountId);
      if (!existing) return "missing";
      if (existing.totpEnabledAt || existing.totpSecretCiphertext) return "already_enabled";
      const currentAuthVersion = authVersionOf(existing.authVersion);
      const nextAuthVersion = currentAuthVersion + 1;
      if (!Number.isSafeInteger(nextAuthVersion)) throw new Error("Customer authentication version overflowed.");
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName,
                Key: { authKey: `totp-pending#${accountId}` },
                ConditionExpression: "kind = :kind AND secretCiphertext = :ciphertext AND expiresAt > :now",
                ExpressionAttributeValues: {
                  ":kind": "totp-pending",
                  ":ciphertext": secretCiphertext,
                  ":now": now,
                },
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: { authKey: `account#${accountId}` },
                UpdateExpression: "SET totpSecretCiphertext = :ciphertext, totpEnabledAt = :enabledAt, backupCodeFingerprints = :backupCodes, backupCodeCount = :backupCount, totpLastStep = :totpStep, updatedAt = :enabledAt, authVersion = :nextAuthVersion",
                ConditionExpression: `kind = :accountKind AND attribute_not_exists(totpEnabledAt) AND ${accountVersionCondition(existing)}`,
                ExpressionAttributeValues: {
                  ...accountVersionValues(existing, nextAuthVersion),
                  ":ciphertext": secretCiphertext,
                  ":enabledAt": enabledAt,
                  ":backupCodes": backupCodeFingerprints,
                  ":backupCount": backupCodeFingerprints.length,
                  ":totpStep": totpStep,
                },
              },
            },
            sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }),
          ],
        }));
        return "updated";
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return "conflict";
        throw error;
      }
    },

    async rotateBackupCodes({
      accountId,
      sessionId,
      backupCodeFingerprints,
      updatedAt,
      proofTotpStep,
      proofBackupIndex,
      proofBackupFingerprint,
    }) {
      const existing = await account(accountId);
      if (!existing) return "missing";
      const currentAuthVersion = authVersionOf(existing.authVersion);
      const nextAuthVersion = currentAuthVersion + 1;
      if (!Number.isSafeInteger(nextAuthVersion)) throw new Error("Customer authentication version overflowed.");
      let proofCondition;
      const proofValues = {};
      let updateExpression = "SET backupCodeFingerprints = :backupCodes, backupCodeCount = :backupCount, updatedAt = :updatedAt, authVersion = :nextAuthVersion";
      if (Number.isSafeInteger(proofTotpStep)) {
        proofCondition = "(attribute_not_exists(totpLastStep) OR totpLastStep < :proofTotpStep)";
        proofValues[":proofTotpStep"] = proofTotpStep;
        updateExpression += ", totpLastStep = :proofTotpStep";
      } else if (Number.isSafeInteger(proofBackupIndex) && typeof proofBackupFingerprint === "string") {
        proofCondition = `backupCodeFingerprints[${proofBackupIndex}] = :proofBackupFingerprint`;
        proofValues[":proofBackupFingerprint"] = proofBackupFingerprint;
      } else {
        throw new Error("Fresh MFA proof is required.");
      }
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: { authKey: `account#${accountId}` },
                UpdateExpression: updateExpression,
                ConditionExpression: `kind = :accountKind AND attribute_exists(totpEnabledAt) AND attribute_exists(totpSecretCiphertext) AND ${accountVersionCondition(existing)} AND ${proofCondition}`,
                ExpressionAttributeValues: {
                  ...accountVersionValues(existing, nextAuthVersion),
                  ":backupCodes": backupCodeFingerprints,
                  ":backupCount": backupCodeFingerprints.length,
                  ":updatedAt": updatedAt,
                  ...proofValues,
                },
              },
            },
            sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }),
          ],
        }));
        return "updated";
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return "conflict";
        throw error;
      }
    },

    async disableTotp({
      accountId,
      sessionId,
      updatedAt,
      proofTotpStep,
      proofBackupIndex,
      proofBackupFingerprint,
    }) {
      const existing = await account(accountId);
      if (!existing) return "missing";
      const currentAuthVersion = authVersionOf(existing.authVersion);
      const nextAuthVersion = currentAuthVersion + 1;
      if (!Number.isSafeInteger(nextAuthVersion)) throw new Error("Customer authentication version overflowed.");
      let proofCondition;
      const proofValues = {};
      if (Number.isSafeInteger(proofTotpStep)) {
        proofCondition = "(attribute_not_exists(totpLastStep) OR totpLastStep < :proofTotpStep)";
        proofValues[":proofTotpStep"] = proofTotpStep;
      } else if (Number.isSafeInteger(proofBackupIndex) && typeof proofBackupFingerprint === "string") {
        proofCondition = `backupCodeFingerprints[${proofBackupIndex}] = :proofBackupFingerprint`;
        proofValues[":proofBackupFingerprint"] = proofBackupFingerprint;
      } else {
        throw new Error("Fresh MFA proof is required.");
      }
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: { authKey: `account#${accountId}` },
                UpdateExpression: "SET updatedAt = :updatedAt, authVersion = :nextAuthVersion REMOVE totpSecretCiphertext, totpEnabledAt, totpLastStep, backupCodeFingerprints, backupCodeCount",
                ConditionExpression: `kind = :accountKind AND attribute_exists(totpEnabledAt) AND attribute_exists(totpSecretCiphertext) AND ${accountVersionCondition(existing)} AND ${proofCondition}`,
                ExpressionAttributeValues: {
                  ...accountVersionValues(existing, nextAuthVersion),
                  ":updatedAt": updatedAt,
                  ...proofValues,
                },
              },
            },
            sessionVersionUpdate({ sessionId, accountId, currentAuthVersion, nextAuthVersion }),
          ],
        }));
        return "updated";
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return "conflict";
        throw error;
      }
    },
  };
}
