import { getPriorityLane } from "./priority-lanes.js";

function parseMessage(record) {
  const payload = JSON.parse(record?.body ?? "");
  if (payload?.schemaVersion !== 1 || typeof payload.jobId !== "string" || typeof payload.priority !== "string") {
    throw new Error("Priority queue message is invalid.");
  }
  return payload;
}

export function createPriorityWorker({ laneName, jobStore, now = Date.now, workerId = "priority-worker", logger = console }) {
  const lane = getPriorityLane(laneName);
  if (!jobStore || typeof jobStore.claimJob !== "function" || typeof jobStore.completeJob !== "function" || typeof jobStore.releaseJob !== "function" || typeof jobStore.failJob !== "function") {
    throw new Error("Priority job store is required.");
  }

  return async function work(event = {}) {
    const failures = [];
    for (const record of event.Records ?? []) {
      try {
        const message = parseMessage(record);
        if (message.priority !== lane.name) throw new Error("Priority queue message was sent to the wrong lane.");
        const startedAt = new Date(now()).toISOString();
        const claim = await jobStore.claimJob(message.jobId, lane.name, workerId, startedAt);
        if (claim.status === "unavailable") continue;
        const job = claim.job;
        if (job.jobType !== "queue_canary") throw new Error("Unsupported priority job type.");
        const completedAt = new Date(now()).toISOString();
        await jobStore.completeJob(message.jobId, workerId, {
          schemaVersion: 1,
          jobType: job.jobType,
          priority: lane.name,
          capacityWeight: lane.capacityWeight,
          sourceFingerprint: job.sourceFingerprint,
          processedBy: workerId,
        }, completedAt);
      } catch {
        const messageId = record?.messageId ?? "unknown";
        const receiveCount = Number.parseInt(record?.attributes?.ApproximateReceiveCount ?? "1", 10);
        const payload = (() => { try { return parseMessage(record); } catch { return undefined; } })();
        if (payload?.jobId) {
          const failedAt = new Date(now()).toISOString();
          try {
            if (receiveCount >= 3) await jobStore.failJob(payload.jobId, workerId, "worker_failed", failedAt);
            else await jobStore.releaseJob(payload.jobId, workerId, "worker_retry", failedAt);
          } catch {
            // The queue retry remains authoritative when state cleanup also fails.
          }
        }
        logger.error({ type: "priority_worker_failed", lane: lane.name, messageId });
        failures.push({ itemIdentifier: messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
