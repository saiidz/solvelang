import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

function pk(accountId) { return `ACCOUNT#${accountId}`; }
function eventSk(eventId) { return `EVENT#${eventId}`; }
function actionSk(eventId, actionId) { return `ACTION#${eventId}#${actionId}`; }
function conditional(error) { return error?.name === "ConditionalCheckFailedException"; }

export function createDynamoSupportAutomationStore(client, tableName, { activeIndexName = "AutomationStateIndex" } = {}) {
  if (!client?.send || typeof tableName !== "string" || !tableName || tableName === "disabled") throw new Error("Support automation DynamoDB store requires a table.");
  if (typeof activeIndexName !== "string" || !activeIndexName) throw new Error("Support automation active-config index is required.");

  async function getConfig(accountId) {
    const response = await client.send(new GetCommand({ TableName: tableName, Key: { pk: pk(accountId), sk: "CONFIG" }, ConsistentRead: true }));
    return response.Item;
  }

  async function putConfig(config, expectedRevision) {
    const item = { ...config, pk: pk(config.accountId), sk: "CONFIG" };
    if (config.automationState === "ACTIVE") {
      item.workerPartition = "ACTIVE";
      item.workerSort = config.accountId;
    }
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
    const active = automationState === "ACTIVE";
    try {
      const response = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: pk(accountId), sk: "CONFIG" },
        UpdateExpression: active
          ? "SET automationState = :state, updatedAt = :updatedAt, revision = revision + :one, workerPartition = :active, workerSort = :accountId"
          : "SET automationState = :state, updatedAt = :updatedAt, revision = revision + :one REMOVE workerPartition, workerSort",
        ConditionExpression: "revision = :expected",
        ExpressionAttributeValues: {
          ":state": automationState,
          ":updatedAt": updatedAt,
          ":one": 1,
          ":expected": expectedRevision,
          ...(active ? { ":active": "ACTIVE", ":accountId": accountId } : {}),
        },
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
        UpdateExpression: "SET automationState = :state, updatedAt = :updatedAt, revision = revision + :one REMOVE gmailCredentialSecretArn, linearCredentialSecretArn, workerPartition, workerSort",
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
    const response = await client.send(new QueryCommand({
      TableName: tableName,
      IndexName: activeIndexName,
      KeyConditionExpression: "workerPartition = :active",
      ExpressionAttributeValues: { ":active": "ACTIVE" },
      ScanIndexForward: true,
      Limit: Math.min(Math.max(limit, 1), 25),
    }));
    return (response.Items ?? []).filter((item) => item.recordType === "CONFIG" && item.automationState === "ACTIVE");
  }

  async function claimEvent(record) {
    const item = { ...record, pk: pk(record.accountId), sk: eventSk(record.eventId), recordType: "EVENT", state: "PROCESSING" };
    try {
      await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }));
      return { created: true, record: item };
    } catch (error) {
      if (!conditional(error)) throw error;
      const existingResponse = await client.send(new GetCommand({ TableName: tableName, Key: { pk: item.pk, sk: item.sk }, ConsistentRead: true }));
      const existing = existingResponse.Item;
      if (!existing) return { created: false, record: { state: "UNKNOWN" } };
      const leaseExpired = existing.state === "PROCESSING" && typeof existing.processingUntil === "string" && existing.processingUntil <= record.updatedAt;
      if (!leaseExpired) return { created: false, record: existing };
      try {
        const reclaimed = await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: "SET claimId = :claimId, processingUntil = :processingUntil, updatedAt = :updatedAt",
          ConditionExpression: "#state = :processing AND claimId = :previousClaimId AND processingUntil = :previousProcessingUntil",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":processing": "PROCESSING",
            ":claimId": record.claimId,
            ":processingUntil": record.processingUntil,
            ":updatedAt": record.updatedAt,
            ":previousClaimId": existing.claimId,
            ":previousProcessingUntil": existing.processingUntil,
          },
          ReturnValues: "ALL_NEW",
        }));
        return { created: true, reclaimed: true, record: reclaimed.Attributes };
      } catch (reclaimError) {
        if (!conditional(reclaimError)) throw reclaimError;
        const latest = await client.send(new GetCommand({ TableName: tableName, Key: { pk: item.pk, sk: item.sk }, ConsistentRead: true }));
        return { created: false, record: latest.Item ?? { state: "UNKNOWN" } };
      }
    }
  }

  async function finishEvent({ accountId, eventId, claimId, state, category, urgency, requiresReview, sensitiveReasons, policyVersion, actions, updatedAt }) {
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk: pk(accountId), sk: eventSk(eventId) },
      UpdateExpression: "SET #state = :state, category = :category, urgency = :urgency, requiresReview = :requiresReview, sensitiveReasons = :sensitiveReasons, policyVersion = :policyVersion, actions = :actions, updatedAt = :updatedAt REMOVE processingUntil",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: {
        ":state": state,
        ":category": category,
        ":urgency": urgency,
        ":requiresReview": Boolean(requiresReview),
        ":sensitiveReasons": sensitiveReasons ?? [],
        ":policyVersion": policyVersion,
        ":actions": actions ?? [],
        ":updatedAt": updatedAt,
        ":claimId": claimId,
      },
      ConditionExpression: "attribute_exists(pk) AND claimId = :claimId",
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
      ExpressionAttributeValues: { ":pk": pk(accountId), ":event": "EVENT#" },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(limit, 1), 50),
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
    async listActiveConfigs(limit) { return [...configs.values()].filter((value) => value.automationState === "ACTIVE").slice(0, limit).map((value) => structuredClone(value)); },
    async claimEvent(record) {
      const id = key(record.accountId, record.eventId);
      const existing = events.get(id);
      if (!existing) {
        const item = { ...record, recordType: "EVENT", state: "PROCESSING" };
        events.set(id, item);
        return { created: true, record: structuredClone(item) };
      }
      if (existing.state === "PROCESSING" && existing.processingUntil <= record.updatedAt) {
        const reclaimed = { ...existing, claimId: record.claimId, processingUntil: record.processingUntil, updatedAt: record.updatedAt };
        events.set(id, reclaimed);
        return { created: true, reclaimed: true, record: structuredClone(reclaimed) };
      }
      return { created: false, record: structuredClone(existing) };
    },
    async finishEvent(input) {
      const id = key(input.accountId, input.eventId);
      const existing = events.get(id);
      if (!existing || existing.claimId !== input.claimId) throw new Error("Support automation event lease changed concurrently.");
      const { processingUntil: _processingUntil, ...rest } = existing;
      events.set(id, { ...rest, ...input, recordType: "EVENT" });
    },
    async claimAction({ accountId, eventId, actionId, createdAt, claimId }) {
      const id = key(accountId, `${eventId}:${actionId}`);
      if (actions.has(id)) return structuredClone(actions.get(id));
      const item = { status: "started", eventId, actionId, claimId, createdAt, updatedAt: createdAt };
      actions.set(id, item);
      return { status: "claimed", claimId };
    },
    async finishAction({ accountId, eventId, actionId, status, outcome, updatedAt }) {
      const id = key(accountId, `${eventId}:${actionId}`); actions.set(id, { ...actions.get(id), status, ...(outcome === undefined ? {} : { outcome }), updatedAt });
    },
    async listEvents(accountId, limit) { return [...events.values()].filter((event) => event.accountId === accountId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit).map((event) => structuredClone(event)); },
    _configs: configs, _events: events, _actions: actions,
  };
}