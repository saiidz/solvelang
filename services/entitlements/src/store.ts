import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ConfirmationOutboxRecord, EntitlementRecord, EntitlementStore } from "./service.js";

type DocumentCommand = GetCommand | PutCommand | TransactWriteCommand | UpdateCommand;
type DocumentClient = {
  send(command: DocumentCommand): Promise<{ Item?: Record<string, unknown> }>;
};

export function createEntitlementStore(client: DocumentClient, tableName: string, dispatchTableName = `${tableName}-confirmation-dispatch`, withdrawalThrottleTableName = `${tableName}-withdrawal-throttle`): EntitlementStore {
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
    async commitPaidEntitlementAndOutbox(record, outbox) {
      try {
        await client.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: record,
                ConditionExpression: "attribute_not_exists(scanId)",
              },
            },
            {
              Put: {
                TableName: dispatchTableName,
                Item: outbox,
                ConditionExpression: "attribute_not_exists(dispatchKey)",
              },
            },
          ],
        }));
        return "created";
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
        const result = await client.send(new GetCommand({ TableName: dispatchTableName, Key: { dispatchKey: outbox.dispatchKey }, ConsistentRead: true }));
        if (!result.Item) throw error;
        return "existing";
      }
    },
    async getConfirmationOutbox(key) {
      const result = await client.send(new GetCommand({
        TableName: dispatchTableName,
        Key: { dispatchKey: key },
        ConsistentRead: true,
      }));
      return result.Item as ConfirmationOutboxRecord | undefined;
    },
    async markConfirmationOutboxDispatched(key) {
      await client.send(new UpdateCommand({
        TableName: dispatchTableName,
        Key: { dispatchKey: key },
        ConditionExpression: "#state = :pending",
        UpdateExpression: "SET #state = :dispatched",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":pending": "pending", ":dispatched": "dispatched" },
      }));
    },
    async consumeWithdrawalRateLimit(key, expiresAt) {
      try {
        await client.send(new UpdateCommand({
          TableName: withdrawalThrottleTableName,
          Key: { throttleKey: key },
          ConditionExpression: "attribute_not_exists(attempts) OR attempts < :limit",
          UpdateExpression: "ADD attempts :one SET expiresAt = :expiresAt",
          ExpressionAttributeValues: { ":one": 1, ":limit": 5, ":expiresAt": expiresAt },
        }));
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
  };
}
