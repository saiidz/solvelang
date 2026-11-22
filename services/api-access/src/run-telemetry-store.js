import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { runCountsFromItems } from "./run-telemetry.js";

export const RUN_TELEMETRY_ALL_KEY = "run-counts#ALL";

// One counter item per UTC day, plus one all-time item. An item carries
// only its key and the two counts — the beacon records that a run
// happened, and nothing else about it.
export function runTelemetryDayKey(nowMs) {
  return `run-counts#${new Date(nowMs).toISOString().slice(0, 10)}`;
}

export function createDynamoRunTelemetryStore(documentClient, tableName, { now = Date.now } = {}) {
  if (!documentClient?.send || typeof tableName !== "string" || !tableName) throw new Error("Run telemetry store is required.");

  async function increment(counterKey, event) {
    await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { counterKey },
      UpdateExpression: "ADD #counter :one",
      ExpressionAttributeNames: { "#counter": event },
      ExpressionAttributeValues: { ":one": 1 },
    }));
  }

  async function readItem(counterKey) {
    const { Item } = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: { counterKey },
      ConsistentRead: true,
    }));
    return Item;
  }

  return {
    async record(event) {
      await increment(RUN_TELEMETRY_ALL_KEY, event);
      await increment(runTelemetryDayKey(now()), event);
    },
    async readCounts() {
      const [allItem, todayItem] = await Promise.all([
        readItem(RUN_TELEMETRY_ALL_KEY),
        readItem(runTelemetryDayKey(now())),
      ]);
      return runCountsFromItems(allItem, todayItem);
    },
  };
}
