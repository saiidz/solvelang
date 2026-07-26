import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { EntitlementRecord, EntitlementStore } from "./service.js";

type DocumentCommand = DeleteCommand | GetCommand | PutCommand | UpdateCommand;
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
    async reserveConfirmationDispatch(key, createdAt) {
      try {
        await client.send(new PutCommand({
          TableName: dispatchTableName,
          Item: { dispatchKey: key, state: "in_progress", createdAt },
          ConditionExpression: "attribute_not_exists(dispatchKey)",
        }));
        return "created";
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
        const result = await client.send(new GetCommand({ TableName: dispatchTableName, Key: { dispatchKey: key }, ConsistentRead: true }));
        return result.Item?.state === "queued" ? "queued" : "in_progress";
      }
    },
    async markConfirmationDispatchQueued(key) {
      await client.send(new UpdateCommand({
        TableName: dispatchTableName,
        Key: { dispatchKey: key },
        ConditionExpression: "#state = :inProgress",
        UpdateExpression: "SET #state = :queued",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":inProgress": "in_progress", ":queued": "queued" },
      }));
    },
    async releaseConfirmationDispatch(key) {
      await client.send(new DeleteCommand({
        TableName: dispatchTableName,
        Key: { dispatchKey: key },
        ConditionExpression: "#state = :inProgress",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":inProgress": "in_progress" },
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
