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
      const magicKey = `magic#${tokenId}`;
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { authKey: magicKey },
        ConsistentRead: true,
      }));
      const magic = response.Item;
      if (!magic || magic.kind !== "magic" || magic.expiresAt <= now) return undefined;

      const sessionItem = {
        authKey: `session#${session.sessionId}`,
        kind: "session",
        ...session,
        accountId: magic.accountId,
        email: magic.email,
      };
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: tableName,
                Key: { authKey: magicKey },
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
      return { accountId: magic.accountId, email: magic.email };
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
            createdAt,
            updatedAt: createdAt,
          },
          ConditionExpression: "attribute_not_exists(authKey)",
        }));
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
        const existing = await account(accountId);
        if (!existing || existing.email !== email) throw new Error("Customer account identity conflict.");
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
      username,
      passwordSalt,
      passwordHash,
      passwordScheme,
      passwordUpdatedAt,
    }) {
      const existing = await account(accountId);
      if (!existing) return "missing";
      if (existing.username && existing.username !== username) return "username_locked";

      if (existing.username === username) {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { authKey: `account#${accountId}` },
          UpdateExpression: "SET passwordSalt = :passwordSalt, passwordHash = :passwordHash, passwordScheme = :passwordScheme, passwordUpdatedAt = :passwordUpdatedAt, updatedAt = :passwordUpdatedAt",
          ConditionExpression: "kind = :accountKind AND username = :username",
          ExpressionAttributeValues: {
            ":passwordSalt": passwordSalt,
            ":passwordHash": passwordHash,
            ":passwordScheme": passwordScheme,
            ":passwordUpdatedAt": passwordUpdatedAt,
            ":accountKind": "account",
            ":username": username,
          },
        }));
        return "updated";
      }

      try {
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
                UpdateExpression: "SET username = :username, passwordSalt = :passwordSalt, passwordHash = :passwordHash, passwordScheme = :passwordScheme, passwordUpdatedAt = :passwordUpdatedAt, updatedAt = :passwordUpdatedAt",
                ConditionExpression: "kind = :accountKind AND attribute_not_exists(username)",
                ExpressionAttributeValues: {
                  ":username": username,
                  ":passwordSalt": passwordSalt,
                  ":passwordHash": passwordHash,
                  ":passwordScheme": passwordScheme,
                  ":passwordUpdatedAt": passwordUpdatedAt,
                  ":accountKind": "account",
                },
              },
            },
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
  };
}
