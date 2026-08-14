import { getPriorityLane } from "./priority-lanes.js";

const WORKER_LEASE_MS = 60_000;

function parseMessage(record) {
  const payload = JSON.parse(record?.body ?? "");
  if (
    payload?.schemaVersion !== 1
    || typeof payload.jobId !== "string"
    || !/^job_[a-f0-9]{32}$/.test(payload.jobId)
    || typeof payload.priority !== "string"
  ) {
    throw new Error("Priority queue message is invalid.");
  }
  return payload;
}

function invocationWorkerId(baseWorkerId, context) {
  const requestId = context?.awsRequestId;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(requestId)) return baseWorkerId;
  return `${baseWorkerId}:${requestId}`;
}

function customerAccountId(job) {
  if (job?.accountId === undefined) return undefined;
  if (typeof job.accountId !== "string" || !/^acct_[a-f0-9]{32}$/.test(job.accountId)) {
    throw new Error("Priority job account is invalid.");
  }
  return job.accountId;
}

export function createPriorityWorker({
  laneName,
  jobStore,
  accountAccess,
  now = Date.now,
  workerId = "priority-worker",
  logger = console,
}) {
  const lane = getPriorityLane(laneName);
  if (!jobStore || typeof jobStore.claimJob !== "function" || typeof jobStore.completeJob !== "function" || typeof jobStore.releaseJob !== "function" || typeof jobStore.failJob !== "function") {
    throw new Error("Priority job store is required.");
  }
  if (accountAccess !== undefined && (!accountAccess || typeof accountAccess.assertActive !== "function")) {
    throw new Error("Priority account access verifier is invalid.");
  }
  if (typeof workerId !== "string" || !workerId || workerId.length > 256 || /[\u0000-\u001f\u007f]/.test(workerId)) {
    throw new Error("Priority worker ID is invalid.");
  }

  return async function work(event = {}, context = {}) {
    const failures = [];
    const leaseOwner = invocationWorkerId(workerId, context);
    for (const record of event.Records ?? []) {
      let message;
      let claimed = false;
      try {
        message = parseMessage(record);
        if (message.priority !== lane.name) throw new Error("Priority queue message was sent to the wrong lane.");
        const claimedAt = now();
        const claim = await jobStore.claimJob(message.jobId, lane.name, leaseOwner, claimedAt, claimedAt + WORKER_LEASE_MS);
        if (claim.status === "terminal") continue;
        if (claim.status === "busy") {
          logger.error({ type: "priority_worker_busy", lane: lane.name, messageId: record?.messageId });
          failures.push({ itemIdentifier: record?.messageId ?? "unknown" });
          continue;
        }
        if (claim.status !== "claimed") throw new Error("Priority job could not be claimed.");
        claimed = true;
        const job = claim.job;
        const accountId = customerAccountId(job);
        if (accountId) {
          if (!accountAccess) throw new Error("Customer priority job access verification is unavailable.");
          await accountAccess.assertActive(accountId);
        }
        if (job.jobType !== "queue_canary") throw new Error("Unsupported priority job type.");
        const completedAt = new Date(now()).toISOString();
        await jobStore.completeJob(message.jobId, leaseOwner, {
          schemaVersion: 1,
          jobType: job.jobType,
          priority: lane.name,
          capacityWeight: lane.capacityWeight,
          sourceFingerprint: job.sourceFingerprint,
          processedBy: leaseOwner,
        }, completedAt);
      } catch {
        const messageId = record?.messageId ?? "unknown";
        const receiveCount = Number.parseInt(record?.attributes?.ApproximateReceiveCount ?? "1", 10);
        if (claimed && message?.jobId) {
          const failedAt = new Date(now()).toISOString();
          try {
            if (receiveCount >= 3) await jobStore.failJob(message.jobId, leaseOwner, "worker_failed", failedAt);
            else await jobStore.releaseJob(message.jobId, leaseOwner, "worker_retry", failedAt);
          } catch {
            // The queue retry and expiring lease remain authoritative when cleanup also fails.
          }
        }
        logger.error({ type: "priority_worker_failed", lane: lane.name, messageId });
        failures.push({ itemIdentifier: messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
