import { createHash } from "node:crypto";
import { getPriorityLane } from "./priority-lanes.js";

export class PriorityJobError extends Error {
  constructor(statusCode, code, publicMessage) {
    super(publicMessage);
    this.name = "PriorityJobError";
    this.statusCode = statusCode;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function cleanRequestId(value) {
  if (typeof value !== "string") throw new PriorityJobError(400, "invalid_request", "Job request ID is invalid.");
  const cleaned = value.trim();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(cleaned)) throw new PriorityJobError(400, "invalid_request", "Job request ID is invalid.");
  return cleaned;
}

function cleanFingerprint(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
  }
  return value;
}

function cleanJobId(value) {
  if (typeof value !== "string" || !/^job_[a-f0-9]{32}$/.test(value)) {
    throw new PriorityJobError(400, "invalid_job_id", "Job ID is invalid.");
  }
  return value;
}

function jobIdFor(requestId) {
  return `job_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}`;
}

function publicJob(record, duplicate = false) {
  return {
    jobId: record.jobId,
    jobType: record.jobType,
    priority: record.priority,
    capacityWeight: record.capacityWeight,
    status: record.status,
    sourceFingerprint: record.sourceFingerprint,
    createdAt: record.createdAt,
    dispatchedAt: record.dispatchedAt ?? null,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    failedAt: record.failedAt ?? null,
    result: record.result ?? null,
    errorCode: record.errorCode ?? null,
    duplicate,
  };
}

export function createPriorityJobService({ store, enabled = false, now = Date.now }) {
  if (enabled && (!store || typeof store.putJob !== "function" || typeof store.getJob !== "function")) {
    throw new Error("Priority job store is required when the queue is enabled.");
  }

  function assertEnabled() {
    if (!enabled) throw new PriorityJobError(503, "priority_queue_disabled", "Priority processing is not enabled.");
  }

  async function submitCanary(input = {}) {
    assertEnabled();
    const requestId = cleanRequestId(input.requestId);
    const sourceFingerprint = cleanFingerprint(input.sourceFingerprint);
    let lane;
    try {
      lane = getPriorityLane(input.priority ?? "standard");
    } catch {
      throw new PriorityJobError(400, "invalid_priority", "Processing priority is invalid.");
    }
    const timestamp = now();
    const job = {
      jobId: jobIdFor(requestId),
      requestFingerprint: createHash("sha256").update(requestId).digest("hex"),
      jobType: "queue_canary",
      priority: lane.name,
      capacityWeight: lane.capacityWeight,
      status: "queued",
      sourceFingerprint,
      createdAt: new Date(timestamp).toISOString(),
      expiresAt: Math.floor(timestamp / 1_000) + 60 * 60 * 24 * 7,
    };
    const outcome = await store.putJob(job);
    if (outcome === "created") return publicJob(job, false);
    const existing = await store.getJob(job.jobId);
    if (existing && existing.requestFingerprint === job.requestFingerprint && existing.priority === job.priority && existing.sourceFingerprint === sourceFingerprint) {
      return publicJob(existing, true);
    }
    throw new PriorityJobError(409, "job_idempotency_conflict", "The job request ID was already used with different inputs.");
  }

  async function getJob(input) {
    assertEnabled();
    const jobId = cleanJobId(typeof input === "string" ? input : input?.jobId);
    const job = await store.getJob(jobId);
    if (!job) throw new PriorityJobError(404, "job_not_found", "Priority job was not found.");
    return publicJob(job, false);
  }

  return { submitCanary, getJob };
}
