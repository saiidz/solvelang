import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createHandler } from "../src/handler.js";
import { createMemoryStore } from "../src/state-store.js";
import { createWebhookHandler, verifyWebhookSignature } from "../src/webhook.js";
import { createWorker, stateForAction } from "../src/worker.js";

const SECRET = "test-webhook-secret";

function sign(body, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

const PR_OPENED_BODY = JSON.stringify({
  action: "opened",
  repository: { full_name: "saiidz/solvelang" },
  pull_request: { number: 42, head: { sha: "deadbeef" }, merged: false },
});

function webhookEvent(body, { signature, delivery = "delivery-1", event = "pull_request" } = {}) {
  return {
    rawPath: "/webhooks/github",
    requestContext: { http: { method: "POST", path: "/webhooks/github" } },
    headers: {
      "x-hub-signature-256": signature ?? sign(body),
      "x-github-delivery": delivery,
      "x-github-event": event,
    },
    body,
    isBase64Encoded: false,
  };
}

test("verifyWebhookSignature accepts a good signature", () => {
  assert.equal(verifyWebhookSignature(SECRET, PR_OPENED_BODY, sign(PR_OPENED_BODY)), true);
});

test("verifyWebhookSignature rejects a bad signature", () => {
  assert.equal(
    verifyWebhookSignature(SECRET, PR_OPENED_BODY, sign(PR_OPENED_BODY, "other-secret")),
    false
  );
  assert.equal(verifyWebhookSignature(SECRET, PR_OPENED_BODY, "sha256=00"), false);
});

test("verifyWebhookSignature rejects a missing signature or secret", () => {
  assert.equal(verifyWebhookSignature(SECRET, PR_OPENED_BODY, ""), false);
  assert.equal(verifyWebhookSignature(SECRET, PR_OPENED_BODY, undefined), false);
  assert.equal(verifyWebhookSignature("", PR_OPENED_BODY, sign(PR_OPENED_BODY)), false);
});

function webhookConfig(overrides = {}) {
  return {
    tableName: "t",
    githubToken: "gh",
    adminToken: "admin",
    webhookSecret: SECRET,
    webhookQueueUrl: "https://sqs.example/queue.fifo",
    pilotTenantId: "saiidz-pilot",
    pilotRepos: [],
    rulesVersion: "pilot-0",
    ...overrides,
  };
}

test("webhook handler enqueues and returns 202 with the delivery id as dedup id", async () => {
  const sent = [];
  const handler = createWebhookHandler({
    config: webhookConfig(),
    sqsSend: async (msg) => {
      sent.push(msg);
    },
  });
  const res = await handler(webhookEvent(PR_OPENED_BODY));
  assert.equal(res.statusCode, 202);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].deduplicationId, "delivery-1");
  assert.equal(sent[0].groupId, "saiidz/solvelang");
  const message = JSON.parse(sent[0].body);
  assert.equal(message.event, "pull_request");
  assert.equal(message.action, "opened");
  assert.equal(message.repo, "saiidz/solvelang");
  assert.equal(message.pr.number, 42);
});

test("webhook handler fails closed with 503 when the secret is missing", async () => {
  const handler = createWebhookHandler({
    config: webhookConfig({ webhookSecret: "" }),
    sqsSend: async () => {
      throw new Error("must not send");
    },
  });
  const res = await handler(webhookEvent(PR_OPENED_BODY));
  assert.equal(res.statusCode, 503);
});

test("webhook handler rejects a bad signature with 401 and does not enqueue", async () => {
  const sent = [];
  const handler = createWebhookHandler({
    config: webhookConfig(),
    sqsSend: async (msg) => {
      sent.push(msg);
    },
  });
  const res = await handler(
    webhookEvent(PR_OPENED_BODY, { signature: sign(PR_OPENED_BODY, "wrong") })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(sent.length, 0);
});

test("stateForAction maps pull_request actions to queue states", () => {
  assert.equal(stateForAction("opened", false), "queued");
  assert.equal(stateForAction("reopened", false), "queued");
  assert.equal(stateForAction("synchronize", false), "queued");
  assert.equal(stateForAction("closed", true), "landed");
  assert.equal(stateForAction("closed", false), "ejected");
  assert.equal(stateForAction("labeled", false), null);
});

function sqsEvent(message) {
  return { Records: [{ body: JSON.stringify(message) }] };
}

test("worker upserts QUEUE on opened, counts prsGoverned once, logs a decision", async () => {
  const store = createMemoryStore();
  const worker = createWorker({ store, config: webhookConfig() });
  const message = {
    tenantId: "saiidz-pilot",
    deliveryId: "d1",
    event: "pull_request",
    repo: "saiidz/solvelang",
    action: "opened",
    pr: { number: 42, headSha: "deadbeef", merged: false },
  };
  await worker(sqsEvent(message));
  let entry = await store.getQueueEntry("saiidz-pilot", "saiidz/solvelang", 42);
  assert.equal(entry.state, "queued");

  // A synchronize replay must not double-count prsGoverned.
  await worker(sqsEvent({ ...message, deliveryId: "d2", action: "synchronize" }));
  entry = await store.getQueueEntry("saiidz-pilot", "saiidz/solvelang", 42);
  assert.equal(entry.state, "queued");
  const usage = await store.readUsage("saiidz-pilot", new Date());
  assert.equal(usage.eventsReceived, 2);
  assert.equal(usage.prsGoverned, 1);
});

test("worker maps closed+merged to landed and closed to ejected", async () => {
  const store = createMemoryStore();
  const worker = createWorker({ store, config: webhookConfig() });
  const base = {
    tenantId: "saiidz-pilot",
    deliveryId: "d1",
    event: "pull_request",
    repo: "saiidz/solvelang",
  };
  await worker(
    sqsEvent({ ...base, action: "closed", pr: { number: 7, headSha: "a", merged: true } })
  );
  assert.equal(
    (await store.getQueueEntry("saiidz-pilot", "saiidz/solvelang", 7)).state,
    "landed"
  );
  await worker(
    sqsEvent({ ...base, action: "closed", pr: { number: 8, headSha: "b", merged: false } })
  );
  assert.equal(
    (await store.getQueueEntry("saiidz-pilot", "saiidz/solvelang", 8)).state,
    "ejected"
  );
});

test("main handler routes POST /webhooks/github through to the webhook handler", async () => {
  const sent = [];
  const handler = createHandler({
    store: createMemoryStore(),
    config: webhookConfig(),
    fetchImpl: async () => {
      throw new Error("unused");
    },
    sqsSend: async (msg) => {
      sent.push(msg);
    },
  });
  const res = await handler(webhookEvent(PR_OPENED_BODY));
  assert.equal(res.statusCode, 202);
  assert.equal(sent.length, 1);
});

test("main handler routes SQS records through to the worker", async () => {
  const store = createMemoryStore();
  const handler = createHandler({
    store,
    config: webhookConfig(),
    fetchImpl: async () => {
      throw new Error("unused");
    },
    sqsSend: async () => {},
  });
  const res = await handler(
    sqsEvent({
      tenantId: "saiidz-pilot",
      deliveryId: "d9",
      event: "pull_request",
      repo: "saiidz/solvelang",
      action: "opened",
      pr: { number: 99, headSha: "cafe", merged: false },
    })
  );
  assert.equal(res.results[0].state, "queued");
  assert.equal(
    (await store.getQueueEntry("saiidz-pilot", "saiidz/solvelang", 99)).state,
    "queued"
  );
});
