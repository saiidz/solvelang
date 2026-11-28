import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

// Platform connections for the repository audit's non-GitHub
// doors (GitLab, Azure DevOps, Bitbucket, Forgejo / Gitea), kept
// in the customer auth table under their own key prefixes — the
// same single-table discipline as the agent actions store, whose
// records already live in this table. A connection record holds
// the connection's identifiers and, only when the customer
// supplied one at registration, the access token's KMS-sealed
// ciphertext and SHA-256 fingerprint (see
// platform-connections.js and platform-token-protector.js). The
// plaintext token is never stored anywhere, and the ciphertext
// never leaves this table through a read view. Audit run records
// (one per repository per audit action, read_complete with the
// read manifest facts or read_failed) live under their own
// prefix in the same table.

const CONNECTION_KIND = "platform-connection";
const RUN_KIND = "platform-audit-run";

function connectionKey(accountId, connectionId) {
  return `platform-connection#${accountId}#${connectionId}`;
}

function connectionPrefix(accountId) {
  return `platform-connection#${accountId}#`;
}

function runKey(accountId, runId) {
  return `platform-audit-run#${accountId}#${runId}`;
}

function runPrefix(accountId) {
  return `platform-audit-run#${accountId}#`;
}

export function createDynamoPlatformConnectionsStore(documentClient, tableName) {
  if (!documentClient?.send || typeof tableName !== "string" || !tableName) {
    throw new Error("Platform connections store is required.");
  }

  // The auth table's only key is the authKey HASH — there is no
  // sort key to range over, so a Query can never express a prefix
  // read: DynamoDB requires "=" on the partition key and refuses
  // begins_with there (the agent actions store documents the
  // production failure that taught this). A filtered Scan is the
  // correct read for this small per-account record family.
  async function listByPrefix(prefix) {
    const items = [];
    let exclusiveStartKey;
    do {
      const page = await documentClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: "begins_with(authKey, :prefix)",
        ExpressionAttributeValues: { ":prefix": prefix },
        ExclusiveStartKey: exclusiveStartKey,
      }));
      items.push(...(page.Items ?? []));
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  return {
    async addConnection(accountId, record) {
      const item = {
        authKey: connectionKey(accountId, record.connectionId),
        kind: CONNECTION_KIND,
        accountId,
        ...record,
      };
      await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
      return item;
    },

    async listConnections(accountId) {
      const items = await listByPrefix(connectionPrefix(accountId));
      return items
        .filter((item) => item?.kind === CONNECTION_KIND && typeof item.connectionId === "string")
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    },

    async putAuditRun(accountId, run) {
      const item = {
        authKey: runKey(accountId, run.runId),
        kind: RUN_KIND,
        accountId,
        ...run,
      };
      await documentClient.send(new PutCommand({ TableName: tableName, Item: item }));
      return item;
    },

    async listAuditRuns(accountId) {
      const items = await listByPrefix(runPrefix(accountId));
      return items
        .filter((item) => item?.kind === RUN_KIND && typeof item.runId === "string")
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    },
  };
}
