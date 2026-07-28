import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

function requireTables(documentClient, values) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || !value) throw new Error(`${name} is required.`);
  }
}

function isExpectedConditionalCancellation(error) {
  if (error?.name !== "TransactionCanceledException") return false;
  const reasons = error.CancellationReasons;
  return Array.isArray(reasons)
    && reasons.length > 0
    && reasons.every((reason) => !reason?.Code || reason.Code === "None" || reason.Code === "ConditionalCheckFailed");
}

function usageMethods(documentClient, { usageTable, idempotencyTable }) {
  async function getUsage(usageKey) {
    const response = await documentClient.send(new GetCommand({ TableName: usageTable, Key: { usageKey }, ConsistentRead: true }));
    return Number.isSafeInteger(response.Item?.used) ? response.Item.used : 0;
  }

  return {
    async consumeUsage({ accountId, period, units, limit, idempotencyKey, expiresAt }) {
      const usageKey = `${accountId}:${period}`;
      const dedupeKey = `${accountId}:${period}:${idempotencyKey}`;
      try {
        await documentClient.send(new TransactWriteCommand({
          ReturnCancellationReasons: true,
          TransactItems: [
            {
              Put: {
                TableName: idempotencyTable,
                Item: { idempotencyKey: dedupeKey, accountId, period, units, expiresAt },
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
      } catch (error) {
        if (!isExpectedConditionalCancellation(error)) throw error;
        const duplicate = await documentClient.send(new GetCommand({
          TableName: idempotencyTable,
          Key: { idempotencyKey: dedupeKey },
          ConsistentRead: true,
        }));
        const used = await getUsage(usageKey);
        if (duplicate.Item) {
          return duplicate.Item.units === units
            ? { status: "duplicate", used }
            : { status: "idempotency_conflict", used };
        }
        return { status: "quota_exceeded", used };
      }
    },
  };
}

export function createDynamoApiKeyAuthorizerStore(documentClient, {
  accountsTable,
  keysTable,
  usageTable,
  idempotencyTable,
}) {
  requireTables(documentClient, { accountsTable, keysTable, usageTable, idempotencyTable });
  return {
    async getAccount(accountId) {
      const response = await documentClient.send(new GetCommand({ TableName: accountsTable, Key: { accountId }, ConsistentRead: true }));
      return response.Item;
    },
    async getKey(keyId) {
      const response = await documentClient.send(new GetCommand({ TableName: keysTable, Key: { keyId }, ConsistentRead: true }));
      return response.Item;
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
    ...usageMethods(documentClient, { usageTable, idempotencyTable }),
  };
}

export function createDynamoApiAccessStore(documentClient, {
  accountsTable,
  keysTable,
  keysAccountIndex,
  usageTable,
  idempotencyTable,
}) {
  requireTables(documentClient, { accountsTable, keysTable, keysAccountIndex, usageTable, idempotencyTable });

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

    async putKeyWithLimit(key, maxActiveKeys) {
      try {
        await documentClient.send(new TransactWriteCommand({
          ReturnCancellationReasons: true,
          TransactItems: [
            {
              Update: {
                TableName: accountsTable,
                Key: { accountId: key.accountId },
                UpdateExpression: "SET activeKeyCount = if_not_exists(activeKeyCount, :zero) + :one",
                ConditionExpression: "attribute_exists(accountId) AND (attribute_not_exists(activeKeyCount) OR activeKeyCount < :limit)",
                ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": maxActiveKeys },
              },
            },
            {
              Put: {
                TableName: keysTable,
                Item: key,
                ConditionExpression: "attribute_not_exists(keyId)",
              },
            },
          ],
        }));
        return "created";
      } catch (error) {
        if (!isExpectedConditionalCancellation(error)) throw error;
        const [existingKey, account] = await Promise.all([
          documentClient.send(new GetCommand({ TableName: keysTable, Key: { keyId: key.keyId }, ConsistentRead: true })),
          documentClient.send(new GetCommand({ TableName: accountsTable, Key: { accountId: key.accountId }, ConsistentRead: true })),
        ]);
        if (existingKey.Item) return "key_collision";
        if (Number.isSafeInteger(account.Item?.activeKeyCount) && account.Item.activeKeyCount >= maxActiveKeys) return "limit_reached";
        throw error;
      }
    },

    async getKey(keyId) {
      const response = await documentClient.send(new GetCommand({ TableName: keysTable, Key: { keyId }, ConsistentRead: true }));
      return response.Item;
    },

    async revokeKeyAndDecrement(keyId, accountId, revokedAt) {
      try {
        await documentClient.send(new TransactWriteCommand({
          ReturnCancellationReasons: true,
          TransactItems: [
            {
              Update: {
                TableName: keysTable,
                Key: { keyId },
                UpdateExpression: "SET revokedAt = :revokedAt",
                ConditionExpression: "accountId = :accountId AND attribute_not_exists(revokedAt)",
                ExpressionAttributeValues: { ":accountId": accountId, ":revokedAt": revokedAt },
              },
            },
            {
              Update: {
                TableName: accountsTable,
                Key: { accountId },
                UpdateExpression: "SET activeKeyCount = activeKeyCount - :one",
                ConditionExpression: "attribute_exists(accountId) AND activeKeyCount > :zero",
                ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
              },
            },
          ],
        }));
        return "revoked";
      } catch (error) {
        if (!isExpectedConditionalCancellation(error)) throw error;
        const key = await documentClient.send(new GetCommand({ TableName: keysTable, Key: { keyId }, ConsistentRead: true }));
        if (!key.Item || key.Item.accountId !== accountId) return "not_found";
        if (key.Item.revokedAt) return "already_revoked";
        throw error;
      }
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

    ...usageMethods(documentClient, { usageTable, idempotencyTable }),
  };
}
