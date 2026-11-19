import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

// Level 3 agent-actions store (design §2, §6): delegated agent
// tokens and API-plan purchase intents, kept in the customer auth
// table under their own key prefixes so no existing record shape
// changes. Token records NEVER hold the token secret — only an
// HMAC fingerprint of it (see agent-actions-service.js); the secret
// itself is shown to the account holder exactly once, at creation.
//
// This module is part of the Level 3 surface only. The read-only
// Level 2 talk-back service does not import it and cannot reach it.

const tokenKey = (accountId, tokenId) => `agent-token#${accountId}#${tokenId}`;
const planIntentKey = (accountId, intentId) => `agent-plan-intent#${accountId}#${intentId}`;

export function createDynamoAgentActionsStore(documentClient, tableName) {
  if (!documentClient?.send || typeof tableName !== "string" || !tableName) {
    throw new Error("Agent actions store is required.");
  }

  async function put(item) {
    await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
    return item;
  }

  async function get(authKey) {
    const { Item } = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { authKey },
      ConsistentRead: true,
    }));
    return Item ?? null;
  }

  async function listByPrefix(prefix) {
    const items = [];
    let exclusiveStartKey;
    do {
      const page = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "begins_with(authKey, :prefix)",
        ExpressionAttributeValues: { ":prefix": prefix },
        ExclusiveStartKey: exclusiveStartKey,
      }));
      items.push(...(page.Items ?? []));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  return {
    async putToken(record) {
      return put({ authKey: tokenKey(record.accountId, record.tokenId), kind: "agent-token", ...record });
    },
    async getToken(accountId, tokenId) {
      return get(tokenKey(accountId, tokenId));
    },
    async listTokens(accountId) {
      return listByPrefix(`agent-token#${accountId}#`);
    },
    async putPlanIntent(record) {
      return put({ authKey: planIntentKey(record.accountId, record.id), kind: "agent-plan-intent", ...record });
    },
    async getPlanIntent(accountId, intentId) {
      return get(planIntentKey(accountId, intentId));
    },
    async listPlanIntents(accountId) {
      return listByPrefix(`agent-plan-intent#${accountId}#`);
    },
  };
}
