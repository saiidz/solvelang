import { GetCommand } from "@aws-sdk/lib-dynamodb";

export function createDynamoCustomerUsageReader(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("API usage table is required.");

  return {
    async getUsage(accountId, period) {
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { usageKey: `${accountId}:${period}` },
        ConsistentRead: true,
      }));
      return Number.isSafeInteger(response.Item?.used) && response.Item.used >= 0 ? response.Item.used : 0;
    },
  };
}
