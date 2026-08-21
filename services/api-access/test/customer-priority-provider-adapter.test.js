import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerPriorityProviderAdapter } from "../src/customer-priority-provider-adapter.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const JOB_ID = `job_${"b".repeat(32)}`;
const FINGERPRINT = "c".repeat(64);

function executionInput(overrides = {}) {
  const controller = new AbortController();
  return {
    source: Buffer.from("PK\u0003\u0004fixture"),
    accountId: ACCOUNT_ID,
    jobId: JOB_ID,
    priority: "express",
    weightedCredits: 4,
    sourceFingerprint: FINGERPRINT,
    signal: controller.signal,
    ...overrides,
  };
}

test("provider adapter stamps the server-owned provider and forwards only the audit contract", async () => {
  let received;
  const adapter = createCustomerPriorityProviderAdapter({
    provider: "fixture-provider",
    execute: async (input) => {
      received = input;
      return {
        reportId: "report-123",
        provider: "spoofed-provider",
        credentials: "must-not-escape",
      };
    },
  });

  const input = executionInput({
    provider: "browser-controlled",
    credentials: "must-not-forward",
    arbitrary: "must-not-forward",
  });
  const result = await adapter(input);

  assert.deepEqual(result, {
    reportId: "report-123",
    provider: "fixture-provider",
  });
  assert.deepEqual(Object.keys(received).sort(), [
    "accountId",
    "jobId",
    "priority",
    "signal",
    "source",
    "sourceFingerprint",
    "weightedCredits",
  ]);
  assert.equal(received.source, input.source);
  assert.equal(received.accountId, ACCOUNT_ID);
  assert.equal(received.jobId, JOB_ID);
  assert.equal(received.priority, "express");
  assert.equal(received.weightedCredits, 4);
  assert.equal(received.sourceFingerprint, FINGERPRINT);
  assert.equal(received.signal, input.signal);
  assert.equal("credentials" in received, false);
  assert.equal("provider" in received, false);
});

test("provider adapter rejects invalid provider identities before an executor can run", async () => {
  let called = false;
  assert.throws(
    () => createCustomerPriorityProviderAdapter({
      provider: "provider with spaces",
      execute: async () => { called = true; },
    }),
    /provider ID is invalid/,
  );
  assert.equal(called, false);
  assert.throws(
    () => createCustomerPriorityProviderAdapter({ provider: "fixture-provider" }),
    /executor is required/,
  );
});

test("provider adapter requires the worker timeout abort signal", async () => {
  const adapter = createCustomerPriorityProviderAdapter({
    provider: "fixture-provider",
    execute: async () => ({ reportId: "report-123" }),
  });

  await assert.rejects(
    adapter(executionInput({ signal: undefined })),
    /abort signal is required/,
  );
});

test("provider adapter rejects malformed provider results and never trusts provider metadata", async () => {
  const adapter = createCustomerPriorityProviderAdapter({
    provider: "fixture-provider",
    execute: async () => ({ reportId: "bad", provider: "spoofed-provider" }),
  });

  await assert.rejects(
    adapter(executionInput()),
    /invalid report ID/,
  );
});

test("provider adapter propagates executor failures for queue retry handling", async () => {
  const expected = new Error("provider unavailable");
  const adapter = createCustomerPriorityProviderAdapter({
    provider: "fixture-provider",
    execute: async () => { throw expected; },
  });

  await assert.rejects(adapter(executionInput()), (error) => error === expected);
});
