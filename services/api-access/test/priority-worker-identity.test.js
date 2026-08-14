import assert from "node:assert/strict";
import test from "node:test";
import { parsePriorityWorkerEnvironment } from "../src/priority-config.js";
import { createPriorityWorker } from "../src/priority-worker.js";

function environment(logStream) {
  return {
    API_PRIORITY_JOBS_TABLE: "priority-jobs",
    API_PRIORITY_LANE: "priority",
    AWS_LAMBDA_FUNCTION_NAME: "priority-worker-function",
    ...(logStream ? { AWS_LAMBDA_LOG_STREAM_NAME: logStream } : {}),
  };
}

test("Lambda execution environments use distinct stable lease owner identities", () => {
  const first = parsePriorityWorkerEnvironment(environment("2026/08/13/[$LATEST]stream-a"));
  const same = parsePriorityWorkerEnvironment(environment("2026/08/13/[$LATEST]stream-a"));
  const second = parsePriorityWorkerEnvironment(environment("2026/08/13/[$LATEST]stream-b"));

  assert.equal(first.workerId, same.workerId);
  assert.notEqual(first.workerId, second.workerId);
  assert.match(first.workerId, /^priority-worker-function:/);
});

test("non-Lambda execution keeps the deterministic function fallback", () => {
  const parsed = parsePriorityWorkerEnvironment(environment(undefined));
  assert.equal(parsed.workerId, "priority-worker-function");
});

test("Lambda request id is appended to every lease mutation owner", async () => {
  const owners = [];
  const worker = createPriorityWorker({
    laneName: "priority",
    workerId: "priority-worker-function:stream-a",
    jobStore: {
      claimJob: async (_jobId, _lane, owner) => {
        owners.push(owner);
        return { status: "claimed", job: { jobType: "queue_canary", sourceFingerprint: "a".repeat(64) } };
      },
      completeJob: async (_jobId, owner) => { owners.push(owner); },
      releaseJob: async () => {},
      failJob: async () => {},
    },
    logger: { error() {} },
  });

  const result = await worker({
    Records: [{
      messageId: "message-1",
      attributes: { ApproximateReceiveCount: "1" },
      body: JSON.stringify({ schemaVersion: 1, jobId: `job_${"b".repeat(32)}`, priority: "priority" }),
    }],
  }, { awsRequestId: "request-12345678" });

  assert.deepEqual(result, { batchItemFailures: [] });
  assert.deepEqual(owners, [
    "priority-worker-function:stream-a:request-12345678",
    "priority-worker-function:stream-a:request-12345678",
  ]);
});
