import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export function createDynamoApiAccessStore(documentClient, {
  accountsTable,
  keysTable,
  keysAccountIndex,
  usageTable,
  idempotencyTable,
}) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  for (const [name, value] of Object.entries({ accountsTable, keysTable, keysAccountIndex, usageTable, idempotencyTable })) {
    if (typeof value !== "string" || !value) throw new Error(`${name} is required.`);
  }

  async function getUsage(usageKey) {
    const response = await documentClient.send(new GetCommand({ TableName: usageTable, Key: { usageKey }, ConsistentRead: true }));
    return Number.isSafeInteger(response.Item?.used) ? response.Item.used : 0;
  }

  return {
    async putAccount(account) {
      await documentClient.send(new PutCommand({ TableName: accountsTable, Item: account }));
    },

    async getAccount(accountId) {
      const response = await documentClient.send(new GetCommand({ TableName: accountsTable, Key: { accountId }, ConsistentRead: true }));
      return response.Item;
    },

    async listKeys(accountId) {
      const response = await documentClient.send(new QueryCommand({
        TableName: keysTable,
        IndexName: keysAccountIndex,
        KeyConditionExpression: "accountId = :accountId",
        ExpressionAttributeValues: { ":accountId": accountId },
        ConsistentRead: false,
      }));
      return response.Items ?? [];
    },

    async putKey(key) {
      await documentClient.send(new PutCommand({
        TableName: keysTable,
        Item: key,
        ConditionExpression: "attribute_not_exists(keyId)",
      }));
    },

    async getKey(keyId) {
      const response = await documentClient.send(new GetCommand({ TableName: keysTable, Key: { keyId }, ConsistentRead: true }));
      return response.Item;
    },

    async revokeKey(keyId, accountId, revokedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: keysTable,
        Key: { keyId },
        UpdateExpression: "SET revokedAt = if_not_exists(revokedAt, :revokedAt)",
        ConditionExpression: "accountId = :accountId",
        ExpressionAttributeValues: { ":accountId": accountId, ":revokedAt": revokedAt },
      }));
    },

    async touchKey(keyId, lastUsedAt) {
      await documentClient.send(new UpdateCommand({
        TableName: keysTable,
        Key: { keyId },
        UpdateExpression: "SET lastUsedAt = :lastUsedAt",
        ConditionExpression: "attribute_exists(keyId) AND attribute_not_exists(revokedAt)",
        ExpressionAttributeValues: { ":lastUsedAt": lastUsedAt },
      }));
    },

    async consumeUsage({ accountId, period, units, limit, idempotencyKey, expiresAt }) {
      const usageKey = `${accountId}:${period}`;
      const dedupeKey = `${accountId}:${period}:${idempotencyKey}`;
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: idempotencyTable,
                Item: { idempotencyKey: dedupeKey, accountId, period, expiresAt },
                ConditionExpression: "attribute_not_exists(idempotencyKey)",
              },
            },
            {
              Update: {
                TableName: usageTable,
                Key: { usageKey },
                UpdateExpression: "SET #used = if_not_exists(#used, :zero) + :units, accountId = :accountId, period = :period, expiresAt = :expiresAt",
                ConditionExpression: "attribute_not_exists(#used) OR #used + :units <= :limit",
                ExpressionAttributeNames: { "#used": "used" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":units": units,
                  ":limit": limit,
                  ":accountId": accountId,
                  ":period": period,
                  ":expiresAt": expiresAt,
                },
              },
            },
          ],
        }));
        return { status: "consumed", used: await getUsage(usageKey) };
      } catch {
        const duplicate = await documentClient.send(new GetCommand({
          TableName: idempotencyTable,
          Key: { idempotencyKey: dedupeKey },
          ConsistentRead: true,
        }));
        const used = await getUsage(usageKey);
        return duplicate.Item ? { status: "duplicate", used } : { status: "quota_exceeded", used };
      }
    },
  };
}
