import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { EntitlementRecord, EntitlementStore } from "./service.js";

type DocumentCommand = GetCommand | PutCommand;
type DocumentClient = {
  send(command: DocumentCommand): Promise<{ Item?: Record<string, unknown> }>;
};

export function createEntitlementStore(client: DocumentClient, tableName: string): EntitlementStore {
  return {
    async putIfAbsent(record) {
      try {
        await client.send(new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(scanId)",
        }));
        return "created";
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return "duplicate";
        throw error;
      }
    },
    async get(scanId) {
      const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { scanId },
        ConsistentRead: true,
      }));
      return result.Item as EntitlementRecord | undefined;
    },
  };
}
