import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerPriorityService } from "../src/customer-priority.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const SOURCE = "b".repeat(64);

function fixture(overrides = {}) {
  const jobs = new Map();
  const usageCalls = [];
  const activeCalls = [];
  const sourceCalls = [];
  const service = createCustomerPriorityService({
    accountAccess: { async assertActive(accountId) { activeCalls.push(accountId); } },
    apiAccessService: {
      async consumeUsage(input) {
        usageCalls.push(input);
        return { accountId: input.accountId, used: input.credits, remaining: 1000 - input.credits };
      },
    },
    jobStore: {
      async getJob(jobId) { return jobs.get(jobId); },
      async putJob(job) {
        if (jobs.has(job.jobId)) return "exists";
        jobs.set(job.jobId, job);
        return "created";
      },
    },
    sourceStore: {
      async assertSource(input) { sourceCalls.push(input); return { fingerprint: input.fingerprint, bytes: 123 }; },
    },
    queueEnabled: true,
    customerPriorityEnabled: true,
    providerExecutionEnabled: true,
    now: () => Date.parse("2026-08-15T06:00:00.000Z"),
    ...overrides,
  });
  return { service, jobs, usageCalls, activeCalls, sourceCalls };
}

test("priority quote applies lane multiplier only after active-account verification", async () => {
  const { service, activeCalls } = fixture();
  const quote = await service.quote({
    accountId: ACCOUNT_ID,
    priority: "express",
    inputTokens: 6_000,
    outputTokens: 500,
  });
  assert.deepEqual(activeCalls, [ACCOUNT_ID]);
  assert.equal(quote.baseCredits, 2);
  assert.equal(quote.creditMultiplier, 2);
  assert.equal(quote.weightedCredits, 4);
  assert.equal(quote.priority, "express");
});

test("customer priority remains fail-closed behind queue, customer, and provider gates", async () => {
  for (const override of [
    { queueEnabled: false },
    { customerPriorityEnabled: false },
    { providerExecutionEnabled: false },
  ]) {
    const { service } = fixture(override);
    await assert.rejects(
      () => service.submit({ accountId: ACCOUNT_ID, requestId: "req-12345678", sourceFingerprint: SOURCE, priority: "express" }),
      (error) => error?.statusCode === 503,
    );
  }
});

test("provider execution cannot be configured without a source verifier", () => {
  assert.throws(
    () => fixture({ sourceStore: undefined }),
    /source verifier is required/i,
  );
});

test("submission proves the account-bound source exists before consuming credits", async () => {
  const sourceError = Object.assign(new Error("missing source"), { statusCode: 404, code: "priority_source_not_found" });
  const { service, jobs, usageCalls } = fixture({
    sourceStore: { async assertSource() { throw sourceError; } },
  });
  await assert.rejects(
    () => service.submit({ accountId: ACCOUNT_ID, requestId: "req-12345678", sourceFingerprint: SOURCE, priority: "express" }),
    (error) => error === sourceError,
  );
  assert.equal(usageCalls.length, 0);
  assert.equal(jobs.size, 0);
});

test("submission charges weighted credits idempotently and writes a customer-owned job", async () => {
  const { service, jobs, usageCalls, sourceCalls } = fixture();
  const input = {
    accountId: ACCOUNT_ID,
    requestId: "req-12345678",
    sourceFingerprint: SOURCE,
    priority: "priority",
    inputTokens: 5_001,
    outputTokens: 200,
  };
  const first = await service.submit(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.priority, "priority");
  assert.equal(first.weightedCredits, 10);
  assert.equal(first.status, "queued");
  assert.equal(jobs.size, 1);
  assert.deepEqual(sourceCalls, [{ accountId: ACCOUNT_ID, fingerprint: SOURCE }]);
  assert.deepEqual(usageCalls[0], {
    accountId: ACCOUNT_ID,
    credits: 10,
    idempotencyKey: "priority:req-12345678",
  });

  const second = await service.submit(input);
  assert.equal(second.duplicate, true);
  assert.equal(usageCalls.length, 1);
  assert.equal(sourceCalls.length, 1);
});

test("same request id with different workload fingerprint fails closed", async () => {
  const { service } = fixture();
  const input = { accountId: ACCOUNT_ID, requestId: "req-12345678", sourceFingerprint: SOURCE, priority: "express" };
  await service.submit(input);
  await assert.rejects(
    () => service.submit({ ...input, sourceFingerprint: "c".repeat(64) }),
    (error) => error?.code === "job_idempotency_conflict" && error?.statusCode === 409,
  );
});

test("invalid account, request id, fingerprint, or workload is rejected before storage", async () => {
  const { service, jobs, usageCalls, sourceCalls } = fixture();
  await assert.rejects(() => service.submit({ accountId: "bad", requestId: "req-12345678", sourceFingerprint: SOURCE }), /Account ID is invalid/);
  await assert.rejects(() => service.submit({ accountId: ACCOUNT_ID, requestId: "short", sourceFingerprint: SOURCE }), /request ID is invalid/i);
  await assert.rejects(() => service.submit({ accountId: ACCOUNT_ID, requestId: "req-12345678", sourceFingerprint: "bad" }), /fingerprint is invalid/i);
  await assert.rejects(() => service.submit({ accountId: ACCOUNT_ID, requestId: "req-12345678", sourceFingerprint: SOURCE, outputTokens: 9_999 }), /workload is invalid/i);
  assert.equal(jobs.size, 0);
  assert.equal(usageCalls.length, 0);
  assert.equal(sourceCalls.length, 0);
});
