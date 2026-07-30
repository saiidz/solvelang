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

test("routes each inserted job to a bounded FIFO group using a sanitized deduplicated message", async () => {
  const sent = [];
  const marked = [];
  const dispatcher = createPriorityDispatcher({
    queueGateway: { send: async (input) => { sent.push(input); return { messageId: `msg-${sent.length}` }; } },
    jobStore: { markDispatched: async (...args) => marked.push(args) },
    queueUrls: { standard: "q-standard", express: "q-express", priority: "q-priority", critical: "q-critical" },
    now: () => Date.UTC(2026, 6, 29, 20, 0, 0),
    logger: { error() {} },
  });
  const jobs = [
    ["job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "standard", 1],
    ["job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "express", 2],
    ["job_cccccccccccccccccccccccccccccccc", "priority", 5],
    ["job_dddddddddddddddddddddddddddddddd", "critical", 10],
  ];
  const result = await dispatcher({ Records: jobs.map(([jobId, priority], index) => record(jobId, priority, `event-${index}`)) });
  assert.deepEqual(result, { batchItemFailures: [] });
  for (let index = 0; index < jobs.length; index += 1) {
    const [jobId, priority, groupCount] = jobs[index];
    assert.equal(sent[index].queueUrl, `q-${priority}`);
    assert.deepEqual(JSON.parse(sent[index].messageBody), { schemaVersion: 1, jobId, priority });
    assert.equal(Object.keys(JSON.parse(sent[index].messageBody)).length, 3);
    assert.equal(sent[index].messageDeduplicationId, jobId);
    const groupIndex = Number.parseInt(sent[index].messageGroupId.replace(`${priority}-`, ""), 10);
    assert.ok(groupIndex >= 0 && groupIndex < groupCount);
    if (priority === "standard") assert.equal(sent[index].messageGroupId, "standard-0");
    assert.equal(marked[index][1], `msg-${index + 1}`);
  }
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
