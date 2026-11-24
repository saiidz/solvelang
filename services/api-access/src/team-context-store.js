import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

// Durable team -> subscription mapping for Team Context Index
// billing, kept in the customer auth table under a dedicated authKey
// prefix (the same table and key discipline as the agent actions
// store). The hosted MCP service owns team records; this store only
// remembers which Stripe subscription belongs to which team so the
// seat-sync route can find it when membership changes. Records are
// written at checkout time and refreshed whenever a seat sync applies
// a new quantity.
const TEAM_SUBSCRIPTION_KIND = "team-context-subscription";

function teamSubscriptionKey(teamId) {
  return `team-context-subscription#${teamId}`;
}

export function createDynamoTeamContextStore(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Team context store table is required.");

  return {
    async recordTeamSubscription(record) {
      const item = {
        authKey: teamSubscriptionKey(record.teamId),
        kind: TEAM_SUBSCRIPTION_KIND,
        teamId: record.teamId,
        accountId: record.accountId,
        subscriptionId: record.subscriptionId,
        customerId: record.customerId,
        seats: record.seats,
        updatedAt: record.updatedAt,
      };
      await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
      return item;
    },

    async getTeamSubscription(teamId) {
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { authKey: teamSubscriptionKey(teamId) },
        ConsistentRead: true,
      }));
      const item = response.Item;
      return item && item.kind === TEAM_SUBSCRIPTION_KIND ? item : undefined;
    },
  };
}
