import assert from "node:assert/strict";
import test from "node:test";
import { createPriorityJobService, PriorityJobError } from "../src/priority-jobs.js";

class MemoryStore {
  jobs = new Map();
  async putJob(job) {
    if (this.jobs.has(job.jobId)) return "exists";
    this.jobs.set(job.jobId, structuredClone(job));
    return "created";
  }
  async getJob(jobId) { return structuredClone(this.jobs.get(jobId)); }
}

const fixedNow = Date.UTC(2026, 6, 29, 20, 0, 0);
const fingerprint = "a".repeat(64);

test("creates deterministic duplicate-safe canary jobs for every lane", async () => {
  const store = new MemoryStore();
  const service = createPriorityJobService({ store, enabled: true, now: () => fixedNow });
  for (const [priority, capacityWeight] of Object.entries({ standard: 1, express: 2, priority: 5, critical: 10 })) {
    const requestId = `canary_request_${priority}`;
    const first = await service.submitCanary({ requestId, priority, sourceFingerprint: fingerprint });
    assert.equal(first.capacityWeight, capacityWeight);
    assert.equal(first.status, "queued");
    assert.equal(first.duplicate, false);
    const duplicate = await service.submitCanary({ requestId, priority, sourceFingerprint: fingerprint });
    assert.equal(duplicate.jobId, first.jobId);
    assert.equal(duplicate.duplicate, true);
  }
});

test("fails closed while disabled and rejects idempotency conflicts", async () => {
  const disabled = createPriorityJobService({ enabled: false });
  await assert.rejects(() => disabled.submitCanary({}), (error) => error instanceof PriorityJobError && error.code === "priority_queue_disabled");

  const store = new MemoryStore();
  const service = createPriorityJobService({ store, enabled: true, now: () => fixedNow });
  await service.submitCanary({ requestId: "same_request_123", priority: "standard", sourceFingerprint: fingerprint });
  await assert.rejects(
    () => service.submitCanary({ requestId: "same_request_123", priority: "critical", sourceFingerprint: fingerprint }),
    (error) => error instanceof PriorityJobError && error.code === "job_idempotency_conflict",
  );
});
