import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityWorker } from "../src/priority-worker.js";

function sqsRecord(jobId, priority, messageId = "message-1") {
  return { messageId, attributes: { ApproximateReceiveCount: "1" }, body: JSON.stringify({ schemaVersion: 1, jobId, priority }) };
}

test("critical workers claim only critical jobs and persist real lane capacity", async () => {
  const completed = [];
  const worker = createPriorityWorker({
    laneName: "critical",
    workerId: "critical-worker-1",
    now: () => Date.UTC(2026, 6, 29, 20, 0, 0),
    jobStore: {
      claimJob: async () => ({ status: "claimed", job: { jobType: "queue_canary", sourceFingerprint: "a".repeat(64) } }),
      completeJob: async (...args) => completed.push(args),
      releaseJob: async () => {},
      failJob: async () => {},
    },
    logger: { error() {} },
  });
  const result = await worker({ Records: [sqsRecord("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "critical")] });
  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(completed[0][2].capacityWeight, 10);
  assert.equal(completed[0][2].processedBy, "critical-worker-1");
});

test("wrong-lane messages fail for retry and duplicate deliveries are skipped", async () => {
  const wrongLane = createPriorityWorker({
    laneName: "express",
    jobStore: {
      claimJob: async () => { throw new Error("must not claim"); },
      completeJob: async () => {},
      releaseJob: async () => {},
      failJob: async () => {},
    },
    logger: { error() {} },
  });
  assert.deepEqual(
    await wrongLane({ Records: [sqsRecord("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "critical", "wrong")] }),
    { batchItemFailures: [{ itemIdentifier: "wrong" }] },
  );

  let completed = false;
  const duplicate = createPriorityWorker({
    laneName: "standard",
    jobStore: {
      claimJob: async () => ({ status: "unavailable" }),
      completeJob: async () => { completed = true; },
      releaseJob: async () => {},
      failJob: async () => {},
    },
    logger: { error() {} },
  });
  assert.deepEqual(await duplicate({ Records: [sqsRecord("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "standard")] }), { batchItemFailures: [] });
  assert.equal(completed, false);
});

test("third receive marks the job failed before the message moves to its DLQ", async () => {
  const failed = [];
  const worker = createPriorityWorker({
    laneName: "priority",
    workerId: "priority-worker-1",
    jobStore: {
      claimJob: async () => ({ status: "claimed", job: { jobType: "unsupported" } }),
      completeJob: async () => {},
      releaseJob: async () => {},
      failJob: async (...args) => failed.push(args),
    },
    logger: { error() {} },
  });
  const record = sqsRecord("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "priority", "third");
  record.attributes.ApproximateReceiveCount = "3";
  assert.deepEqual(await worker({ Records: [record] }), { batchItemFailures: [{ itemIdentifier: "third" }] });
  assert.equal(failed[0][0], "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(failed[0][2], "worker_failed");
});
