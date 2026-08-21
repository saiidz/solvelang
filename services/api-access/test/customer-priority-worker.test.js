import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityWorker } from "../src/priority-worker.js";
import { customerPriorityReportId } from "../src/customer-priority-report.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const JOB_ID = `job_${"b".repeat(32)}`;
const SOURCE_FINGERPRINT = "c".repeat(64);
const REPORT_TEXT = "Repository audit completed with no critical findings.";

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
    async renewLease(...args) { calls.push(["renew", ...args]); },
    async failJob(...args) { calls.push(["fail", ...args]); },
    async releaseJob(...args) { calls.push(["release", ...args]); },
  };
}

function customerReport(overrides = {}) {
  return {
    reportId: customerPriorityReportId({ jobId: JOB_ID, sourceFingerprint: SOURCE_FINGERPRINT }),
    provider: "test-fixture",
    reportText: REPORT_TEXT,
    ...overrides,
  };
}

test("customer-owned repository audit invokes only an explicitly supplied executor after account verification", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: SOURCE_FINGERPRINT,
    weightedCredits: 4,
  });
  const order = [];
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive(accountId) { order.push(["account", accountId]); } },
    executeCustomerJob: async (input) => {
      order.push(["execute", input]);
      return customerReport();
    },
    workerId: "worker",
    now: () => 1000,
  });
  const result = await worker({ Records: [record()] }, { awsRequestId: "request-1" });
  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(order[0][0], "account");
  assert.equal(order[1][0], "execute");
  assert.equal(order[1][1].accountId, ACCOUNT_ID);
  assert.equal(order[1][1].sourceFingerprint, SOURCE_FINGERPRINT);
  const completed = store.calls.find((call) => call[0] === "complete");
  assert.equal(completed[1], JOB_ID);
  assert.deepEqual(completed[3], {
    schemaVersion: 1,
    jobType: "repository_audit",
    priority: "express",
    capacityWeight: 2,
    sourceFingerprint: SOURCE_FINGERPRINT,
    processedBy: "worker:request-1",
    ...customerReport(),
  });
});

test("worker rejects a provider-controlled or mismatched report ID", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: SOURCE_FINGERPRINT,
  });
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() {} },
    executeCustomerJob: async () => customerReport({ reportId: "report_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    workerId: "worker",
    now: () => 1_000,
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), {
    batchItemFailures: [{ itemIdentifier: "message-1" }],
  });
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);
  assert.equal(store.calls.some((call) => call[0] === "release"), true);
});

test("customer execution renews its lease while running and fails closed if renewal is lost", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: SOURCE_FINGERPRINT,
  });
  let tick = 1_000;
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() {} },
    executeCustomerJob: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return customerReport();
    },
    workerId: "worker",
    now: () => (tick += 1),
    leaseMs: 1_000,
    heartbeatMs: 10,
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), { batchItemFailures: [] });
  assert.equal(store.calls.some((call) => call[0] === "renew"), true);
});

test("customer execution is retried when its lease heartbeat fails", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: SOURCE_FINGERPRINT,
  });
  store.renewLease = async () => { throw new Error("lease lost"); };
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() {} },
    executeCustomerJob: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return customerReport();
    },
    workerId: "worker",
    now: () => 1_000,
    leaseMs: 1_000,
    heartbeatMs: 10,
    logger: { error() {} },
  });
  assert.deepEqual(await worker({ Records: [record()] }), { batchItemFailures: [{ itemIdentifier: "message-1" }] });
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);
  assert.equal(store.calls.some((call) => call[0] === "release"), true);
});

test("customer execution waits for an in-flight heartbeat before completing", async () => {
  const store = storeWith({
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    jobType: "repository_audit",
    priority: "express",
    sourceFingerprint: SOURCE_FINGERPRINT,
  });
  let finishExecution;
  const execution = new Promise((resolve) => { finishExecution = resolve; });
  let rejectRenewal;
  let markRenewalStarted;
  const renewalStarted = new Promise((resolve) => { markRenewalStarted = resolve; });
  store.renewLease = (...args) => {
    store.calls.push(["renew", ...args]);
    markRenewalStarted();
    return new Promise((resolve, reject) => { rejectRenewal = reject; });
  };
  const worker = createPriorityWorker({
    laneName: "express",
    jobStore: store,
    accountAccess: { async assertActive() {} },
    executeCustomerJob: async () => execution,
    workerId: "worker",
    now: () => 1_000,
    leaseMs: 1_000,
    heartbeatMs: 10,
    logger: { error() {} },
  });

  const work = worker({ Records: [record()] });
  await renewalStarted;
  finishExecution(customerReport());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);

  rejectRenewal(new Error("lease lost after execution"));
  assert.deepEqual(await work, { batchItemFailures: [{ itemIdentifier: "message-1" }] });
  assert.equal(store.calls.some((call) => call[0] === "complete"), false);
  assert.equal(store.calls.some((call) => call[0] === "release"), true);
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
