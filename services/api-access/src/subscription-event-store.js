import { PutCommand } from "@aws-sdk/lib-dynamodb";

export function createDynamoSubscriptionEventStore(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Subscription events table is required.");
  return {
    async putEventIfAbsent(record) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(eventId)",
        }));
        return "created";
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return "duplicate";
        throw error;
      }
    },
  };
}
