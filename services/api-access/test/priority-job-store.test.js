import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoPriorityJobStore } from "../src/priority-job-store.js";

class ScriptedClient {
  constructor(steps) {
    this.steps = [...steps];
  }
  async send(command) {
    const step = this.steps.shift();
    if (!step) throw new Error(`Unexpected ${command.constructor.name}.`);
    if (step.command) assert.equal(command.constructor.name, step.command);
    if (step.inspect) step.inspect(command.input);
    if (step.error) throw step.error;
    return step.result ?? {};
  }
}

function conditional() {
  return Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
}

test("claim uses an expiring lease and can reclaim abandoned processing jobs", async () => {
  const claimedAt = Date.UTC(2026, 6, 29, 20, 0, 0);
  const client = new ScriptedClient([{
    command: "UpdateCommand",
    inspect(input) {
      assert.match(input.ConditionExpression, /leaseExpiresAt <= :claimedAt/);
      assert.equal(input.ExpressionAttributeValues[":claimedAt"], claimedAt);
      assert.equal(input.ExpressionAttributeValues[":leaseExpiresAt"], claimedAt + 60_000);
      assert.match(input.UpdateExpression, /attempts = if_not_exists\(attempts, :zero\) \+ :one/);
    },
    result: { Attributes: { jobId: "job_" + "a".repeat(32), status: "processing", jobType: "queue_canary" } },
  }]);
  const store = createDynamoPriorityJobStore(client, { jobsTable: "jobs" });
  const result = await store.claimJob("job_" + "a".repeat(32), "critical", "worker-1", claimedAt, claimedAt + 60_000);
  assert.equal(result.status, "claimed");
  assert.equal(client.steps.length, 0);
});

test("conditional claim distinguishes terminal duplicates from active leases", async () => {
  const jobId = "job_" + "a".repeat(32);
  const terminalClient = new ScriptedClient([
    { command: "UpdateCommand", error: conditional() },
    { command: "GetCommand", result: { Item: { jobId, priority: "standard", status: "complete" } } },
  ]);
  const terminalStore = createDynamoPriorityJobStore(terminalClient, { jobsTable: "jobs" });
  assert.equal((await terminalStore.claimJob(jobId, "standard", "worker", 100, 200)).status, "terminal");

  const busyClient = new ScriptedClient([
    { command: "UpdateCommand", error: conditional() },
    { command: "GetCommand", result: { Item: { jobId, priority: "standard", status: "processing", leaseExpiresAt: 500 } } },
  ]);
  const busyStore = createDynamoPriorityJobStore(busyClient, { jobsTable: "jobs" });
  assert.equal((await busyStore.claimJob(jobId, "standard", "worker", 100, 200)).status, "busy");
});

test("completion and retry cleanup remove worker leases", async () => {
  const client = new ScriptedClient([
    {
      command: "UpdateCommand",
      inspect(input) {
        assert.match(input.UpdateExpression, /REMOVE workerId, leaseExpiresAt, lastHeartbeatAt, lastErrorCode, lastFailedAt/);
        assert.match(input.ConditionExpression, /workerId = :workerId/);
      },
    },
    {
      command: "UpdateCommand",
      inspect(input) {
        assert.match(input.UpdateExpression, /REMOVE workerId, leaseExpiresAt/);
      },
    },
  ]);
  const store = createDynamoPriorityJobStore(client, { jobsTable: "jobs" });
  await store.completeJob("job_" + "a".repeat(32), "worker", { ok: true }, "2026-07-29T20:00:00.000Z");
  await store.releaseJob("job_" + "b".repeat(32), "worker", "retry", "2026-07-29T20:00:00.000Z");
  assert.equal(client.steps.length, 0);
});

test("heartbeat renews only the current unexpired worker lease", async () => {
  const client = new ScriptedClient([{
    command: "UpdateCommand",
    inspect(input) {
      assert.match(input.ConditionExpression, /#status = :processing AND workerId = :workerId AND leaseExpiresAt > :renewedAt/);
      assert.equal(input.ExpressionAttributeValues[":renewedAt"], "2026-07-29T20:00:00.000Z");
      assert.equal(input.ExpressionAttributeValues[":leaseExpiresAt"], Date.UTC(2026, 6, 29, 20, 1, 0));
    },
  }]);
  const store = createDynamoPriorityJobStore(client, { jobsTable: "jobs" });
  await store.renewLease("job_" + "a".repeat(32), "worker", Date.UTC(2026, 6, 29, 20, 0, 0), Date.UTC(2026, 6, 29, 20, 1, 0));
  assert.equal(client.steps.length, 0);
});
