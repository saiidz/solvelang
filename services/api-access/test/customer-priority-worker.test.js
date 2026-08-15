import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityWorker } from "../src/priority-worker.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const JOB_ID = `job_${"b".repeat(32)}`;

function record(priority = "express", receiveCount = "1") {
  return {
    messageId: "message-1",
    body: JSON.stringify({ schemaVersion: 1, jobId: JOB_ID, priority }),
    attributes: { ApproximateReceiveCount: receiveCount },
  };
}

function storeWith(job) {
  const calls = [];
  return {
    calls,
    async claimJob(...args) { calls.push(["claim", ...args]); return { status: "claimed", job }; },
    async completeJob(...args) { calls.push(["complete", ...args]); },
    async failJob(...args) { calls.push(["fail", ...args]); },
    async releaseJob(...args) { calls.push(["release", ...args]); },
  };
}

test("customer-owned repository audit invokes only an explicitly supplied executor after account verification", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: "c".repeat(64),
    weightedCredits: 4,
  });
  const order = [];
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive(accountId) { order.push(["account", accountId]); } },
    executeCustomerJob: async (input) => {
      order.push(["execute", input]);
      return { reportId: "report-123", provider: "test-fixture" };
    },
    workerId: "worker",
    now: () => 1000,
  });
  const result = await worker({ Records: [record()] }, { awsRequestId: "request-1" });
  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(order[0][0], "account");
  assert.equal(order[1][0], "execute");
  assert.equal(order[1][1].accountId, ACCOUNT_ID);
  assert.equal(order[1][1].sourceFingerprint, "c".repeat(64));
  const completed = store.calls.find((call) => call[0] === "complete");
  assert.equal(completed[1], JOB_ID);
  assert.deepEqual(completed[3], {
    schemaVersion: 1,
    jobType: "repository_audit",
    priority: "express",
    capacityWeight: 2,
    sourceFingerprint: "c".repeat(64),
    processedBy: "worker:request-1",
    reportId: "report-123",
    provider: "test-fixture",
  });
});

test("customer-owned jobs fail closed when no provider executor is configured", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
  });
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() {} },
    workerId: "worker",
    now: () => 1000,
    logger: { error() {} },
  });
  const result = await worker({ Records: [record()] }, { awsRequestId: "request-1" });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "message-1" }] });
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);
  assert.equal(store.calls.some((call) => call[0] === "release"), true);
});

test("account restriction is checked before customer provider execution", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
  });
  let executed = false;
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() { throw new Error("restricted"); } },
    executeCustomerJob: async () => { executed = true; return {}; },
    workerId: "worker",
    now: () => 1000,
    logger: { error() {} },
  });
  const result = await worker({ Records: [record("express", "2")] }, { awsRequestId: "request-1" });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "message-1" }] });
  assert.equal(executed, false);
  assert.equal(store.calls.some((call) => call[0] === "release"), true);
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);
});
