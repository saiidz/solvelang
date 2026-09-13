import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function pk(accountId) { return `ACCOUNT#${accountId}`; }
function eventSk(eventId) { return `EVENT#${eventId}`; }
function actionSk(eventId, actionId) { return `EVENT#${eventId}#ACTION#${actionId}`; }
function conditional(error) { return error?.name === "ConditionalCheckFailedException"; }

export function createDynamoSupportAutomationStore(client, tableName) {
  if (!client?.send || typeof tableName !== "string" || !tableName || tableName === "disabled") throw new Error("Support automation DynamoDB store requires a table.");

  async function getConfig(accountId) {
    const response = await client.send(new GetCommand({ TableName: tableName, Key: { pk: pk(accountId), sk: "CONFIG" }, ConsistentRead: true }));
    return response.Item;
  }

  async function putConfig(config, expectedRevision) {
    const item = { ...config, pk: pk(config.accountId), sk: "CONFIG" };
    const expression = expectedRevision === undefined ? "attribute_not_exists(pk)" : "revision = :expected";
    const values = expectedRevision === undefined ? undefined : { ":expected": expectedRevision };
    try {
      await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: expression, ...(values ? { ExpressionAttributeValues: values } : {}) }));
      return item;
    } catch (error) {
      if (conditional(error)) throw new Error("Support automation configuration changed concurrently.");
      throw error;
    }
  }

  async function setState(accountId, expectedRevision, automationState, updatedAt) {
    try {
      const response = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: pk(accountId), sk: "CONFIG" },
        UpdateExpression: "SET automationState = :state, updatedAt = :updatedAt, revision = revision + :one",
        ConditionExpression: "revision = :expected",
        ExpressionAttributeValues: { ":state": automationState, ":updatedAt": updatedAt, ":one": 1, ":expected": expectedRevision },
        ReturnValues: "ALL_NEW",
      }));
      return response.Attributes;
    } catch (error) {
      if (conditional(error)) throw new Error("Support automation configuration changed concurrently.");
      throw error;
    }
  }

  async function revokeConfig(accountId, expectedRevision, updatedAt) {
    try {
      const response = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: pk(accountId), sk: "CONFIG" },
        UpdateExpression: "SET automationState = :state, updatedAt = :updatedAt, revision = revision + :one REMOVE gmailCredentialSecretArn, linearCredentialSecretArn",
        ConditionExpression: "revision = :expected",
        ExpressionAttributeValues: { ":state": "REVOKED", ":updatedAt": updatedAt, ":one": 1, ":expected": expectedRevision },
        ReturnValues: "ALL_NEW",
      }));
      return response.Attributes;
    } catch (error) {
      if (conditional(error)) throw new Error("Support automation configuration changed concurrently.");
      throw error;
    }
  }

  async function listActiveConfigs(limit) {
    const response = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: "recordType = :config AND automationState = :active",
      ExpressionAttributeValues: { ":config": "CONFIG", ":active": "ACTIVE" },
      Limit: Math.min(Math.max(limit, 1), 25),
    }));
    return response.Items ?? [];
  }

  async function claimEvent(record) {
    const item = { ...record, pk: pk(record.accountId), sk: eventSk(record.eventId), recordType: "EVENT", state: "PROCESSING" };
    try {
      await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
      return { created: true, record: item };
    } catch (error) {
      if (!conditional(error)) throw error;
      const existing = await client.send(new GetCommand({ TableName: tableName, Key: { pk: item.pk, sk: item.sk }, ConsistentRead: true }));
      return { created: false, record: existing.Item ?? { state: "UNKNOWN" } };
    }
  }

  async function finishEvent({ accountId, eventId, state, category, urgency, requiresReview, sensitiveReasons, actions, updatedAt }) {
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: pk(accountId), sk: eventSk(eventId) },
      UpdateExpression: "SET #state = :state, category = :category, urgency = :urgency, requiresReview = :requiresReview, sensitiveReasons = :sensitiveReasons, actions = :actions, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: { ":state": state, ":category": category, ":urgency": urgency, ":requiresReview": Boolean(requiresReview), ":sensitiveReasons": sensitiveReasons ?? [], ":actions": actions ?? [], ":updatedAt": updatedAt },
      ConditionExpression: "attribute_exists(pk)",
    }));
  }

  async function claimAction({ accountId, eventId, actionId, createdAt, claimId }) {
    const key = { pk: pk(accountId), sk: actionSk(eventId, actionId) };
    const item = { ...key, recordType: "ACTION", eventId, actionId, status: "started", claimId, createdAt, updatedAt: createdAt };
    try {
      await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
      return { status: "claimed", claimId };
    } catch (error) {
      if (!conditional(error)) throw error;
      const response = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      return response.Item ?? { status: "unknown" };
    }
  }

  async function finishAction({ accountId, eventId, actionId, status, outcome, updatedAt }) {
    const values = { ":status": status, ":updatedAt": updatedAt };
    let expression = "SET #status = :status, updatedAt = :updatedAt";
    if (outcome !== undefined) { expression += ", outcome = :outcome"; values[":outcome"] = outcome; }
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: pk(accountId), sk: actionSk(eventId, actionId) },
      UpdateExpression: expression,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
    }));
  }

  async function listEvents(accountId, limit) {
    const response = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :event)",
      FilterExpression: "recordType = :recordType",
      ExpressionAttributeValues: { ":pk": pk(accountId), ":event": "EVENT#", ":recordType": "EVENT" },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(limit * 3, limit), 150),
    }));
    return (response.Items ?? []).filter((item) => item.recordType === "EVENT").slice(0, limit);
  }

  return { getConfig, putConfig, setState, revokeConfig, listActiveConfigs, claimEvent, finishEvent, claimAction, finishAction, listEvents };
}

export function createMemorySupportAutomationStore() {
  const configs = new Map();
  const events = new Map();
  const actions = new Map();
  const key = (accountId, id) => `${accountId}:${id}`;
  return {
    async getConfig(accountId) { const value = configs.get(accountId); return value ? structuredClone(value) : undefined; },
    async putConfig(config, expectedRevision) {
      const existing = configs.get(config.accountId);
      if ((existing?.revision) !== expectedRevision) throw new Error("Support automation configuration changed concurrently.");
      configs.set(config.accountId, structuredClone(config)); return structuredClone(config);
    },
    async setState(accountId, expectedRevision, automationState, updatedAt) {
      const existing = configs.get(accountId);
      if (!existing || existing.revision !== expectedRevision) throw new Error("Support automation configuration changed concurrently.");
      const updated = { ...existing, automationState, updatedAt, revision: existing.revision + 1 };
      configs.set(accountId, updated); return structuredClone(updated);
    },
    async revokeConfig(accountId, expectedRevision, updatedAt) {
      const existing = configs.get(accountId);
      if (!existing || existing.revision !== expectedRevision) throw new Error("Support automation configuration changed concurrently.");
      const { gmailCredentialSecretArn: _gmail, linearCredentialSecretArn: _linear, ...rest } = existing;
      const updated = { ...rest, automationState: "REVOKED", updatedAt, revision: existing.revision + 1 };
      configs.set(accountId, updated); return structuredClone(updated);
    },
    async listActiveConfigs(limit) { return [...configs.values()].filter((value) => value.automationState === "ACTIVE").slice(0, limit).map(structuredClone); },
    async claimEvent(record) {
      const id = key(record.accountId, record.eventId);
      if (events.has(id)) return { created: false, record: structuredClone(events.get(id)) };
      const item = { ...record, recordType: "EVENT", state: "PROCESSING" }; events.set(id, item); return { created: true, record: structuredClone(item) };
    },
    async finishEvent(input) { const id = key(input.accountId, input.eventId); events.set(id, { ...events.get(id), ...input, recordType: "EVENT" }); },
    async claimAction({ accountId, eventId, actionId, createdAt, claimId }) {
      const id = key(accountId, `${eventId}:${actionId}`);
      if (actions.has(id)) return structuredClone(actions.get(id));
      const item = { status: "claimed", eventId, actionId, claimId, createdAt, updatedAt: createdAt }; actions.set(id, item); return structuredClone(item);
    },
    async finishAction({ accountId, eventId, actionId, status, outcome, updatedAt }) {
      const id = key(accountId, `${eventId}:${actionId}`); actions.set(id, { ...actions.get(id), status, ...(outcome === undefined ? {} : { outcome }), updatedAt });
    },
    async listEvents(accountId, limit) { return [...events.values()].filter((event) => event.accountId === accountId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit).map(structuredClone); },
    _configs: configs, _events: events, _actions: actions,
  };
}
