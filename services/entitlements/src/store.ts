import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { EntitlementRecord, EntitlementStore } from "./service.js";

type DocumentCommand = GetCommand | PutCommand | UpdateCommand;
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
    async updateRefundStatus(scanId, paymentIntentId, refundStatus, eventId, updatedAt) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { scanId },
          ConditionExpression: "sessionId = :paymentIntentId AND (attribute_not_exists(refundEventId) OR refundEventId <> :eventId)",
          UpdateExpression: "SET refundStatus = :refundStatus, refundEventId = :eventId, refundUpdatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":paymentIntentId": paymentIntentId,
            ":refundStatus": refundStatus,
            ":eventId": eventId,
            ":updatedAt": updatedAt,
          },
        }));
        return "updated";
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return "duplicate_or_missing";
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
