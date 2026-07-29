import {
  DeleteCommand,
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

  return {
    async reserveEmailRequest({ throttleKey, expiresAt }) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: { authKey: `throttle#${throttleKey}`, kind: "throttle", expiresAt },
          ConditionExpression: "attribute_not_exists(authKey)",
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
      if (!magic || magic.kind !== "magic" || magic.expiresAt <= now || magic.secretFingerprint !== presentedFingerprint) {
        return undefined;
      }

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
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { authKey: `session#${sessionId}` },
          UpdateExpression: "SET revokedAt = :revokedAt, expiresAt = :expiresAt",
          ConditionExpression: "attribute_exists(authKey)",
          ExpressionAttributeValues: {
            ":revokedAt": revokedAt,
            ":expiresAt": Math.floor(Date.now() / 1_000),
          },
        }));
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
      }
    },
  };
}
