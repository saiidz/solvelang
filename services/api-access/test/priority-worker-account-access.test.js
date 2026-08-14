import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityWorker } from "../src/priority-worker.js";

const JOB_ID = `job_${"a".repeat(32)}`;
const ACCOUNT_ID = `acct_${"b".repeat(32)}`;

function record(receiveCount = "1") {
  return {
    messageId: "message-1",
    attributes: { ApproximateReceiveCount: receiveCount },
    body: JSON.stringify({ schemaVersion: 1, jobId: JOB_ID, priority: "standard" }),
  };
}

function store(job, calls) {
  return {
    async claimJob() { calls.push("claim"); return { status: "claimed", job }; },
    async completeJob() { calls.push("complete"); },
    async releaseJob() { calls.push("release"); },
    async failJob() { calls.push("fail"); },
  };
}

test("server-owned queue canary remains valid without an account verifier", async () => {
  const calls = [];
  const worker = createPriorityWorker({
    laneName: "standard",
    jobStore: store({ jobType: "queue_canary", sourceFingerprint: "c".repeat(64) }, calls),
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), { batchItemFailures: [] });
  assert.deepEqual(calls, ["claim", "complete"]);
});

test("customer-owned job fails closed when account verification is unavailable", async () => {
  const calls = [];
  const worker = createPriorityWorker({
    laneName: "standard",
    jobStore: store({ jobType: "queue_canary", accountId: ACCOUNT_ID, sourceFingerprint: "d".repeat(64) }, calls),
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), {
    batchItemFailures: [{ itemIdentifier: "message-1" }],
  });
  assert.deepEqual(calls, ["claim", "release"]);
});

test("active customer-owned job verifies account before completion", async () => {
  const calls = [];
  const worker = createPriorityWorker({
    laneName: "standard",
    accountAccess: {
      async assertActive(accountId) {
        calls.push(`access:${accountId}`);
      },
    },
    jobStore: store({ jobType: "queue_canary", accountId: ACCOUNT_ID, sourceFingerprint: "e".repeat(64) }, calls),
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), { batchItemFailures: [] });
  assert.deepEqual(calls, ["claim", `access:${ACCOUNT_ID}`, "complete"]);
});

test("restricted customer-owned job never completes and becomes terminal on third receive", async () => {
  const calls = [];
  const worker = createPriorityWorker({
    laneName: "standard",
    accountAccess: {
      async assertActive() {
        calls.push("access");
        throw new Error("restricted");
      },
    },
    jobStore: store({ jobType: "queue_canary", accountId: ACCOUNT_ID, sourceFingerprint: "f".repeat(64) }, calls),
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record("3")] }), {
    batchItemFailures: [{ itemIdentifier: "message-1" }],
  });
  assert.deepEqual(calls, ["claim", "access", "fail"]);
});

test("malformed customer account identifiers fail closed", async () => {
  const calls = [];
  const worker = createPriorityWorker({
    laneName: "standard",
    accountAccess: { async assertActive() { calls.push("access"); } },
    jobStore: store({ jobType: "queue_canary", accountId: "acct_bad", sourceFingerprint: "f".repeat(64) }, calls),
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), {
    batchItemFailures: [{ itemIdentifier: "message-1" }],
  });
  assert.deepEqual(calls, ["claim", "release"]);
});
