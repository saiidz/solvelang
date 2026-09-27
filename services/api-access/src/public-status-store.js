import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { REFRESH_INTERVAL_MS, sanitizedPublicStatus, unverifiedPublicStatus } from "./public-status.js";

const SNAPSHOT_KEY = "current";
const LEASE_KEY = "refresh-lease";

export function createDynamoPublicStatusStore(documentClient, tableName, { now = Date.now } = {}) {
  if (!documentClient?.send || typeof tableName !== "string" || !tableName) throw new Error("Public status store is required.");
  return {
    async readSnapshot() {
      try {
        const { Item } = await documentClient.send(new GetCommand({ TableName: tableName, Key: { snapshotKey: SNAPSHOT_KEY }, ConsistentRead: true }));
        return sanitizedPublicStatus(Item, now());
      } catch { return unverifiedPublicStatus(); }
    },
    async acquireRefreshLease(startedAt) {
      try {
        await documentClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { snapshotKey: LEASE_KEY },
          UpdateExpression: "SET nextEligibleAt = :next",
          ConditionExpression: "attribute_not_exists(nextEligibleAt) OR nextEligibleAt <= :now",
          ExpressionAttributeValues: { ":next": startedAt + REFRESH_INTERVAL_MS, ":now": startedAt },
        }));
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async writeSnapshot(snapshot) {
      const safe = sanitizedPublicStatus(snapshot, now());
      if (Object.keys(safe.observations).length === 0) throw new Error("Public status snapshot is invalid or stale.");
      const collectedAt = new Date(Date.parse(snapshot.collectedAt)).toISOString();
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: { snapshotKey: SNAPSHOT_KEY, collectedAt, observations: safe.observations },
          ConditionExpression: "attribute_not_exists(collectedAt) OR collectedAt < :collectedAt",
          ExpressionAttributeValues: { ":collectedAt": collectedAt },
        }));
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
  };
}
