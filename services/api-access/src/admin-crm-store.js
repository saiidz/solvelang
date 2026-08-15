import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

function required(documentClient, tableName) {
  if (!documentClient) throw new Error("DynamoDB document client is required.");
  if (typeof tableName !== "string" || !tableName) throw new Error("Admin CRM table is required.");
}

function accountPk(accountId) {
  return `ACCOUNT#${accountId}`;
}

function profileKey(accountId) {
  return { pk: accountPk(accountId), sk: "PROFILE" };
}

function auditPut(tableName, accountId, audit) {
  return {
    Put: {
      TableName: tableName,
      Item: {
        pk: accountPk(accountId),
        sk: `AUDIT#${audit.at}#${audit.auditId}`,
        kind: "audit",
        recordType: "AUDIT",
        accountId,
        auditId: audit.auditId,
        action: audit.action,
        actor: audit.actor,
        at: audit.at,
        details: audit.details ?? {},
      },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    },
  };
}

function touchProfile(tableName, accountId, at) {
  return {
    Update: {
      TableName: tableName,
      Key: profileKey(accountId),
      UpdateExpression: "SET recordType = if_not_exists(recordType, :profile), accountId = if_not_exists(accountId, :accountId), createdAt = if_not_exists(createdAt, :at), updatedAt = :at",
      ExpressionAttributeValues: {
        ":profile": "PROFILE",
        ":accountId": accountId,
        ":at": at,
      },
    },
  };
}

export function createDynamoAdminCrmStore(documentClient, {
  tableName,
  profileIndex = "RecordTypeUpdatedAtIndex",
}) {
  required(documentClient, tableName);

  async function getProfile(accountId) {
    const response = await documentClient.send(new GetCommand({
      TableName: tableName,
      Key: profileKey(accountId),
      ConsistentRead: true,
    }));
    return response.Item;
  }

  return {
    getProfile,

    async listProfiles({ limit = 50, exclusiveStartKey } = {}) {
      const response = await documentClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: profileIndex,
        KeyConditionExpression: "recordType = :profile",
        ExpressionAttributeValues: { ":profile": "PROFILE" },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }));
      return {
        items: response.Items ?? [],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    },

    async listByPrefix(accountId, prefix, limit = 50) {
      const response = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": accountPk(accountId),
          ":prefix": prefix,
        },
        ScanIndexForward: false,
        Limit: limit,
        ConsistentRead: true,
      }));
      return response.Items ?? [];
    },

    async updateProfile(accountId, profile, audit) {
      const names = {
        "#stage": "stage",
        "#priority": "priority",
        "#owner": "owner",
        "#company": "company",
        "#tags": "tags",
        "#summary": "summary",
        "#nextAction": "nextAction",
      };
      const values = {
        ":profile": "PROFILE",
        ":accountId": accountId,
        ":at": audit.at,
        ":stage": profile.stage,
        ":priority": profile.priority,
        ":owner": profile.owner,
        ":company": profile.company,
        ":tags": profile.tags,
        ":summary": profile.summary,
        ":nextAction": profile.nextAction,
      };
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: profileKey(accountId),
              UpdateExpression: "SET recordType = :profile, accountId = :accountId, createdAt = if_not_exists(createdAt, :at), updatedAt = :at, #stage = :stage, #priority = :priority, #owner = :owner, #company = :company, #tags = :tags, #summary = :summary, #nextAction = :nextAction",
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          },
          auditPut(tableName, accountId, audit),
        ],
      }));
      return getProfile(accountId);
    },

    async addNote(accountId, note, audit) {
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                pk: accountPk(accountId),
                sk: `NOTE#${note.createdAt}#${note.noteId}`,
                kind: "note",
                accountId,
                noteId: note.noteId,
                text: note.text,
                createdAt: note.createdAt,
                createdBy: note.createdBy,
              },
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
            },
          },
          touchProfile(tableName, accountId, audit.at),
          auditPut(tableName, accountId, audit),
        ],
      }));
      return note;
    },

    async createTask(accountId, task, audit) {
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                pk: accountPk(accountId),
                sk: `TASK#${task.taskId}`,
                kind: "task",
                accountId,
                ...task,
              },
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
            },
          },
          touchProfile(tableName, accountId, audit.at),
          auditPut(tableName, accountId, audit),
        ],
      }));
      return task;
    },

    async updateTask(accountId, taskId, updates, audit) {
      const values = {
        ":title": updates.title,
        ":status": updates.status,
        ":dueAt": updates.dueAt,
        ":updatedAt": audit.at,
      };
      try {
        await documentClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: { pk: accountPk(accountId), sk: `TASK#${taskId}` },
                UpdateExpression: "SET title = :title, #status = :status, dueAt = :dueAt, updatedAt = :updatedAt",
                ConditionExpression: "kind = :taskKind",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: { ...values, ":taskKind": "task" },
              },
            },
            touchProfile(tableName, accountId, audit.at),
            auditPut(tableName, accountId, audit),
          ],
        }));
      } catch (error) {
        if (error?.name === "TransactionCanceledException") return undefined;
        throw error;
      }
      const response = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { pk: accountPk(accountId), sk: `TASK#${taskId}` },
        ConsistentRead: true,
      }));
      return response.Item;
    },
  };
}
