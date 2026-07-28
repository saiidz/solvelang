import {
  GetCommand,
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

function isTransactionCanceled(error) {
  return error?.name === "TransactionCanceledException";
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
        if (!isTransactionCanceled(error)) throw error;
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
        if (used + units > limit) return { status: "quota_exceeded", used };
        throw error;
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
      const names = {
        "#email": "email",
        "#plan": "plan",
        "#status": "subscriptionStatus",
        "#periodEnd": "currentPeriodEnd",
        "#customer": "stripeCustomerId",
        "#subscription": "stripeSubscriptionId",
        "#updatedAt": "updatedAt",
        "#eventCreatedAt": "subscriptionEventCreatedAt",
        "#eventOrder": "subscriptionEventOrder",
      };
      const values = {
        ":email": account.email,
        ":plan": account.plan,
        ":status": account.subscriptionStatus,
        ":periodEnd": account.currentPeriodEnd,
        ":customer": account.stripeCustomerId,
        ":subscription": account.stripeSubscriptionId,
        ":updatedAt": account.updatedAt,
        ":eventCreatedAt": account.subscriptionEventCreatedAt,
        ":eventOrder": account.subscriptionEventOrder,
        ":zero": 0,
      };
      const updates = [
        "#email = :email",
        "#plan = :plan",
        "#status = :status",
        "#periodEnd = :periodEnd",
        "#customer = :customer",
        "#subscription = :subscription",
        "#updatedAt = :updatedAt",
        "#eventCreatedAt = :eventCreatedAt",
        "#eventOrder = :eventOrder",
        "activeKeyCount = if_not_exists(activeKeyCount, :zero)",
      ];
      const removals = ["pendingCheckoutRequestId", "pendingCheckoutExpiresAt"];
      if (account.graceUntil === undefined) {
        removals.push("graceUntil");
      } else {
        updates.push("graceUntil = :graceUntil");
        values[":graceUntil"] = account.graceUntil;
      }
      try {
        await documentClient.send(new UpdateCommand({
          TableName: accountsTable,
          Key: { accountId: account.accountId },
          UpdateExpression: `SET ${updates.join(", ")} REMOVE ${removals.join(", ")}`,
          ConditionExpression: "attribute_not_exists(#eventOrder) OR #eventOrder < :eventOrder",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));
        return "updated";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "stale";
        throw error;
      }
    },

    async getAccount(accountId) {
      const response = await documentClient.send(new GetCommand({ TableName: accountsTable, Key: { accountId }, ConsistentRead: true }));
      return response.Item;
    },

    async reserveSubscriptionCheckout({ accountId, requestId, now, expiresAt }) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: accountsTable,
          Key: { accountId },
          UpdateExpression: "SET pendingCheckoutRequestId = :requestId, pendingCheckoutExpiresAt = :expiresAt",
          ConditionExpression: "(attribute_not_exists(stripeSubscriptionId) OR #status IN (:canceled, :unpaid)) AND (attribute_not_exists(pendingCheckoutExpiresAt) OR pendingCheckoutExpiresAt <= :now OR pendingCheckoutRequestId = :requestId)",
          ExpressionAttributeNames: { "#status": "subscriptionStatus" },
          ExpressionAttributeValues: {
            ":requestId": requestId,
            ":expiresAt": expiresAt,
            ":now": now,
            ":canceled": "canceled",
            ":unpaid": "unpaid",
          },
        }));
        return "created";
      } catch (error) {
        if (error?.name !== "ConditionalCheckFailedException") throw error;
        const response = await documentClient.send(new GetCommand({
          TableName: accountsTable,
          Key: { accountId },
          ConsistentRead: true,
        }));
        const account = response.Item;
        const replaceable = !account?.stripeSubscriptionId || account.subscriptionStatus === "canceled" || account.subscriptionStatus === "unpaid";
        if (replaceable && account?.pendingCheckoutRequestId === requestId && account.pendingCheckoutExpiresAt > now) {
          return "duplicate";
        }
        return "conflict";
      }
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
        if (!isTransactionCanceled(error)) throw error;
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
        if (!isTransactionCanceled(error)) throw error;
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
