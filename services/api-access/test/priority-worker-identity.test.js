import assert from "node:assert/strict";
import test from "node:test";
import { parsePriorityWorkerEnvironment } from "../src/priority-config.js";

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
