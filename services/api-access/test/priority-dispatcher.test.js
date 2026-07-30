import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityDispatcher } from "../src/priority-dispatcher.js";

function record(jobId, priority, eventID = "event-1") {
  return {
    eventID,
    eventName: "INSERT",
    dynamodb: { NewImage: { jobId: { S: jobId }, priority: { S: priority }, status: { S: "queued" } } },
  };
}

test("routes each inserted job to its dedicated lane using a sanitized message", async () => {
  const sent = [];
  const marked = [];
  const dispatcher = createPriorityDispatcher({
    queueGateway: { send: async (input) => { sent.push(input); return { messageId: `msg-${sent.length}` }; } },
    jobStore: { markDispatched: async (...args) => marked.push(args) },
    queueUrls: { standard: "q-standard", express: "q-express", priority: "q-priority", critical: "q-critical" },
    now: () => Date.UTC(2026, 6, 29, 20, 0, 0),
    logger: { error() {} },
  });
  const result = await dispatcher({ Records: [record("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "critical")] });
  assert.deepEqual(result, { batchItemFailures: [] });
  assert.equal(sent[0].queueUrl, "q-critical");
  assert.deepEqual(JSON.parse(sent[0].messageBody), {
    schemaVersion: 1,
    jobId: "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    priority: "critical",
  });
  assert.equal(Object.keys(JSON.parse(sent[0].messageBody)).length, 3);
  assert.equal(marked[0][1], "msg-1");
});

test("reports only failed stream records for retry", async () => {
  const dispatcher = createPriorityDispatcher({
    queueGateway: { send: async () => { throw new Error("temporary"); } },
    jobStore: { markDispatched: async () => {} },
    queueUrls: { standard: "a", express: "b", priority: "c", critical: "d" },
    logger: { error() {} },
  });
  const result = await dispatcher({ Records: [record("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "standard", "event-fail")] });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "event-fail" }] });
});
