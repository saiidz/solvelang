// State store for the SolveLang merge-governance pilot.
//
// Tenant-first single-table design. Every record lives under
// PK = "TENANT#<tenantId>" and is discriminated by SK:
//   SK "PROFILE"                          tenant profile
//   SK "REPO#<owner/name>"                repo record (paused, killSwitch, rulesVersion)
//   SK "QUEUE#<owner/name>#<prNumber>"    one governed pull request
//   SK "BATCH#<id>"                       a merge batch
//   SK "DECISION#<ISO-ts>#<id>"           structured decision-log entry (SIEM-exportable JSON)
//   SK "USAGE#<yyyy-mm-dd>"               daily usage counters (atomic ADD)
//
// The DynamoDB implementation uses the AWS SDK v3 document client.
// An in-memory implementation with the same interface is provided for
// tests and local proof runs; the handler accepts either via its factory.

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export function tenantPk(tenantId) {
  return `TENANT#${tenantId}`;
}

export function repoSk(repo) {
  return `REPO#${repo}`;
}

export function queueSk(repo, prNumber) {
  return `QUEUE#${repo}#${prNumber}`;
}

export function decisionSk(ts, id) {
  return `DECISION#${ts}#${id}`;
}

export function usageSk(day) {
  return `USAGE#${day}`;
}

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

function snapshotItem(snapshot, record) {
  return {
    PK: tenantPk(snapshot.tenantId),
    SK: queueSk(snapshot.repo, record.prNumber),
    tenantId: snapshot.tenantId,
    repo: snapshot.repo,
    prNumber: record.prNumber,
    title: record.title,
    headSha: record.headSha,
    baseRef: record.baseRef,
    draft: record.draft,
    state: record.state,
    updatedAt: record.updatedAt,
    observedAt: snapshot.generatedAt,
  };
}

function decisionRecord(decision, ts, rulesDefault) {
  return {
    ts,
    tenantId: decision.tenantId,
    repo: decision.repo || null,
    pr: decision.pr ?? null,
    action: decision.action,
    reason: decision.reason || null,
    rulesVersion: decision.rulesVersion || rulesDefault,
  };
}

export function createMemoryStore() {
  const items = new Map();
  const key = (pk, sk) => `${pk}\n${sk}`;
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  const store = {
    async putItem(item) {
      items.set(key(item.PK, item.SK), clone(item));
      return clone(item);
    },

    async getItem(pk, sk) {
      return clone(items.get(key(pk, sk)) ?? null);
    },

    async putQueueSnapshot(snapshot) {
      const written = [];
      for (const record of snapshot.records) {
        const item = snapshotItem(snapshot, record);
        await store.putItem(item);
        written.push(item);
      }
      return written;
    },

    async getRepoRecord(tenantId, repo) {
      return store.getItem(tenantPk(tenantId), repoSk(repo));
    },

    async setRepoPaused(tenantId, repo, paused, meta = {}) {
      const existing = (await store.getRepoRecord(tenantId, repo)) || {
        PK: tenantPk(tenantId),
        SK: repoSk(repo),
        tenantId,
        repo,
        killSwitch: false,
        rulesVersion: meta.rulesVersion || "pilot-0",
      };
      const item = {
        ...existing,
        paused: Boolean(paused),
        pausedReason: meta.reason || null,
        updatedAt: new Date().toISOString(),
      };
      await store.putItem(item);
      return item;
    },

    async getQueueEntry(tenantId, repo, prNumber) {
      return store.getItem(tenantPk(tenantId), queueSk(repo, prNumber));
    },

    async listQueueEntries(tenantId, repo) {
      const prefix = `${tenantPk(tenantId)}\nQUEUE#${repo}#`;
      const out = [];
      for (const [k, v] of items.entries()) {
        if (k.startsWith(prefix)) out.push(clone(v));
      }
      return out.sort((a, b) => a.prNumber - b.prNumber);
    },

    async upsertQueueEntry(tenantId, repo, prNumber, fields) {
      const existing = await store.getQueueEntry(tenantId, repo, prNumber);
      const item = {
        ...(existing || {}),
        PK: tenantPk(tenantId),
        SK: queueSk(repo, prNumber),
        tenantId,
        repo,
        prNumber,
        ...fields,
        updatedAt: new Date().toISOString(),
      };
      await store.putItem(item);
      return { item, created: !existing };
    },

    async appendDecision(decision) {
      const ts = decision.ts || new Date().toISOString();
      const id = decision.id || randomUUID();
      const record = decisionRecord(decision, ts, "pilot-0");
      await store.putItem({
        PK: tenantPk(decision.tenantId),
        SK: decisionSk(ts, id),
        ...record,
      });
      return record;
    },

    async bumpUsage(tenantId, counters, date = new Date()) {
      const sk = usageSk(dayOf(date));
      const pk = tenantPk(tenantId);
      const existing = (await store.getItem(pk, sk)) || {
        PK: pk,
        SK: sk,
        tenantId,
        day: dayOf(date),
      };
      for (const [name, delta] of Object.entries(counters)) {
        existing[name] = (existing[name] || 0) + delta;
      }
      existing.updatedAt = new Date().toISOString();
      await store.putItem(existing);
      return existing;
    },

    async readUsage(tenantId, date = new Date()) {
      const day = typeof date === "string" ? date : dayOf(date);
      return store.getItem(tenantPk(tenantId), usageSk(day));
    },
  };

  return store;
}

export function createDynamoStore({ tableName, client } = {}) {
  if (!tableName) {
    throw new Error("createDynamoStore requires a tableName");
  }
  const doc = client || DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const nowIso = () => new Date().toISOString();

  const store = {
    async putItem(item) {
      await doc.send(new PutCommand({ TableName: tableName, Item: item }));
      return item;
    },

    async getItem(pk, sk) {
      const out = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: pk, SK: sk } })
      );
      return out.Item || null;
    },

    async putQueueSnapshot(snapshot) {
      const written = [];
      for (const record of snapshot.records) {
        const item = snapshotItem(snapshot, record);
        await store.putItem(item);
        written.push(item);
      }
      return written;
    },

    async getRepoRecord(tenantId, repo) {
      return store.getItem(tenantPk(tenantId), repoSk(repo));
    },

    async setRepoPaused(tenantId, repo, paused, meta = {}) {
      const existing = await store.getRepoRecord(tenantId, repo);
      const item = {
        PK: tenantPk(tenantId),
        SK: repoSk(repo),
        tenantId,
        repo,
        killSwitch: existing?.killSwitch ?? false,
        rulesVersion: existing?.rulesVersion || meta.rulesVersion || "pilot-0",
        ...(existing || {}),
        paused: Boolean(paused),
        pausedReason: meta.reason || null,
        updatedAt: nowIso(),
      };
      await store.putItem(item);
      return item;
    },

    async getQueueEntry(tenantId, repo, prNumber) {
      return store.getItem(tenantPk(tenantId), queueSk(repo, prNumber));
    },

    async listQueueEntries(tenantId, repo) {
      const out = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: {
            ":pk": tenantPk(tenantId),
            ":prefix": `QUEUE#${repo}#`,
          },
        })
      );
      return (out.Items || []).sort((a, b) => a.prNumber - b.prNumber);
    },

    async upsertQueueEntry(tenantId, repo, prNumber, fields) {
      const existing = await store.getQueueEntry(tenantId, repo, prNumber);
      const item = {
        ...(existing || {}),
        PK: tenantPk(tenantId),
        SK: queueSk(repo, prNumber),
        tenantId,
        repo,
        prNumber,
        ...fields,
        updatedAt: nowIso(),
      };
      await store.putItem(item);
      return { item, created: !existing };
    },

    async appendDecision(decision) {
      const ts = decision.ts || nowIso();
      const id = decision.id || randomUUID();
      const record = decisionRecord(decision, ts, "pilot-0");
      await store.putItem({
        PK: tenantPk(decision.tenantId),
        SK: decisionSk(ts, id),
        ...record,
      });
      return record;
    },

    async bumpUsage(tenantId, counters, date = new Date()) {
      const names = Object.keys(counters);
      if (names.length === 0) return store.readUsage(tenantId, date);
      const expressionParts = [];
      const attributeNames = {};
      const attributeValues = { ":updatedAt": nowIso(), ":zero": 0 };
      names.forEach((name, i) => {
        const nk = `#c${i}`;
        const vk = `:v${i}`;
        attributeNames[nk] = name;
        attributeValues[vk] = counters[name];
        expressionParts.push(`${nk} = if_not_exists(${nk}, :zero) + ${vk}`);
      });
      const out = await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: tenantPk(tenantId), SK: usageSk(dayOf(date)) },
          UpdateExpression: `SET ${expressionParts.join(", ")}, updatedAt = :updatedAt`,
          ExpressionAttributeNames: attributeNames,
          ExpressionAttributeValues: attributeValues,
          ReturnValues: "ALL_NEW",
        })
      );
      return out.Attributes || null;
    },

    async readUsage(tenantId, date = new Date()) {
      const day = typeof date === "string" ? date : dayOf(date);
      return store.getItem(tenantPk(tenantId), usageSk(day));
    },
  };

  return store;
}
