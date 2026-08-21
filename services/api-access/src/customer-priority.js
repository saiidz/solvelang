import { createHash } from "node:crypto";
import { calculateCreditCharge } from "./credits.js";
import { getPriorityLane } from "./priority-lanes.js";
import { PriorityJobError } from "./priority-jobs.js";
import { publicCustomerPriorityReport } from "./customer-priority-report.js";

const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const JOB_ID = /^job_[a-f0-9]{32}$/;
const JOB_RETENTION_SECONDS = 60 * 60 * 24 * 7;
const REQUEST_RETENTION_SECONDS = 60 * 60 * 24 * 400;

function cleanAccountId(value) {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new PriorityJobError(400, "invalid_account_id", "Account ID is invalid.");
  return value;
}

function cleanRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) throw new PriorityJobError(400, "invalid_request", "Job request ID is invalid.");
  return value;
}

function cleanFingerprint(value) {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
  return value;
}

function cleanJobId(value) {
  if (typeof value !== "string" || !JOB_ID.test(value)) throw new PriorityJobError(400, "invalid_job_id", "Priority job ID is invalid.");
  return value;
}

function quoteWorkload(input = {}) {
  try {
    const base = calculateCreditCharge({
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      minimumCredits: input.minimumCredits ?? 1,
      priority: "standard",
    });
    const lane = getPriorityLane(input.priority ?? "standard");
    const weightedCredits = base.chargedCredits * lane.creditMultiplier;
    if (!Number.isSafeInteger(weightedCredits) || weightedCredits < 1 || weightedCredits > 1_000_000) throw new Error("weighted credit overflow");
    return {
      priority: lane.name,
      label: lane.label,
      capacityWeight: lane.capacityWeight,
      creditMultiplier: lane.creditMultiplier,
      baseCredits: base.chargedCredits,
      weightedCredits,
      inputTokens: base.inputTokens,
      outputTokens: base.outputTokens,
    };
  } catch {
    throw new PriorityJobError(400, "invalid_priority_workload", "Priority workload is invalid.");
  }
}

function customerJobId(accountId, requestId) {
  return `job_${createHash("sha256").update(`${accountId}\u001f${requestId}`).digest("hex").slice(0, 32)}`;
}

function customerRequestMarkerId(accountId, requestId) {
  return `request_${createHash("sha256").update(`${accountId}\u001f${requestId}`).digest("hex").slice(0, 32)}`;
}

function idempotencyConflict() {
  return new PriorityJobError(409, "job_idempotency_conflict", "The job request ID was already used with different inputs.");
}

function expiredRequest() {
  return new PriorityJobError(409, "job_request_expired", "The job request ID belongs to a prior job that is no longer retained. Submit a new request ID.");
}

function assertMatchingJob(job, { accountId, requestFingerprint }) {
  if (!job || job.requestFingerprint !== requestFingerprint || job.accountId !== accountId) throw idempotencyConflict();
  return job;
}

function assertMatchingMarker(marker, { accountId, jobId, requestFingerprint }) {
  if (
    !marker
    || marker.recordType !== "customer_priority_request"
    || marker.accountId !== accountId
    || marker.targetJobId !== jobId
    || marker.requestFingerprint !== requestFingerprint
    || (marker.state !== "reserved" && marker.state !== "job_reserved")
  ) {
    throw idempotencyConflict();
  }
  return marker;
}

function publicCustomerJob(record) {
  return {
    jobId: record.jobId,
    accountId: record.accountId,
    jobType: record.jobType,
    priority: record.priority,
    capacityWeight: record.capacityWeight,
    weightedCredits: record.weightedCredits,
    sourceFingerprint: record.sourceFingerprint,
    status: record.status,
    createdAt: record.createdAt,
    dispatchedAt: record.dispatchedAt ?? null,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    failedAt: record.failedAt ?? null,
    result: publicCustomerPriorityReport(record.result, {
      jobId: record.jobId,
      sourceFingerprint: record.sourceFingerprint,
    }),
    errorCode: record.errorCode ?? null,
  };
}

export function createCustomerPriorityService({
  accountAccess,
  apiAccessService,
  jobStore,
  sourceStore,
  queueEnabled = false,
  customerPriorityEnabled = false,
  providerExecutionEnabled = false,
  now = Date.now,
}) {
  if (!accountAccess || typeof accountAccess.assertActive !== "function") throw new Error("Customer account access verifier is required.");
  if (!apiAccessService || typeof apiAccessService.consumeUsage !== "function") throw new Error("API access service is required.");
  if (
    !jobStore
    || typeof jobStore.putJob !== "function"
    || typeof jobStore.getJob !== "function"
    || typeof jobStore.putRequestMarker !== "function"
    || typeof jobStore.getRequestMarker !== "function"
    || typeof jobStore.markRequestJobReserved !== "function"
    || typeof jobStore.activatePendingJob !== "function"
  ) {
    throw new Error("Priority job store is required.");
  }
  if (providerExecutionEnabled && (!sourceStore || typeof sourceStore.assertSource !== "function")) {
    throw new Error("Priority source verifier is required when provider execution is enabled.");
  }

  function assertCustomerFeature() {
    if (!queueEnabled || !customerPriorityEnabled) throw new PriorityJobError(503, "customer_priority_disabled", "Customer priority processing is not enabled.");
  }

  function assertLaunchEnabled() {
    assertCustomerFeature();
    if (!providerExecutionEnabled) throw new PriorityJobError(503, "priority_provider_disabled", "Priority provider execution is not enabled.");
  }

  async function quote(input = {}) {
    assertCustomerFeature();
    const accountId = cleanAccountId(input.accountId);
    await accountAccess.assertActive(accountId);
    return { accountId, ...quoteWorkload(input.workload ?? input) };
  }

  async function submit(input = {}) {
    assertLaunchEnabled();
    const accountId = cleanAccountId(input.accountId);
    const requestId = cleanRequestId(input.requestId);
    const sourceFingerprint = cleanFingerprint(input.sourceFingerprint);
    await accountAccess.assertActive(accountId);
    const quote = quoteWorkload(input.workload ?? input);
    const jobId = customerJobId(accountId, requestId);
    const markerId = customerRequestMarkerId(accountId, requestId);
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ accountId, requestId, sourceFingerprint, priority: quote.priority, weightedCredits: quote.weightedCredits }))
      .digest("hex");
    const timestamp = now();
    const createdAt = new Date(timestamp).toISOString();

    let job = await jobStore.getJob(jobId);
    if (job) assertMatchingJob(job, { accountId, requestFingerprint });

    let marker = await jobStore.getRequestMarker(markerId);
    if (marker) assertMatchingMarker(marker, { accountId, jobId, requestFingerprint });

    if (job && !marker) {
      const outcome = await jobStore.putRequestMarker({
        jobId: markerId,
        recordType: "customer_priority_request",
        accountId,
        targetJobId: jobId,
        requestFingerprint,
        state: "job_reserved",
        createdAt,
        expiresAt: Math.floor(timestamp / 1_000) + REQUEST_RETENTION_SECONDS,
      });
      if (outcome !== "created") {
        marker = assertMatchingMarker(await jobStore.getRequestMarker(markerId), { accountId, jobId, requestFingerprint });
      } else {
        marker = { state: "job_reserved" };
      }
    }

    if (job && marker?.state === "reserved") {
      const outcome = await jobStore.markRequestJobReserved(markerId, requestFingerprint, jobId);
      if (outcome !== "updated") throw idempotencyConflict();
      marker = { ...marker, state: "job_reserved" };
    }

    if (job && job.status !== "pending_usage") {
      return { ...publicCustomerJob(job), duplicate: true };
    }

    if (!job && marker?.state === "job_reserved") throw expiredRequest();

    await sourceStore.assertSource({ accountId, fingerprint: sourceFingerprint });

    if (!marker) {
      const markerRecord = {
        jobId: markerId,
        recordType: "customer_priority_request",
        accountId,
        targetJobId: jobId,
        requestFingerprint,
        state: "reserved",
        createdAt,
        expiresAt: Math.floor(timestamp / 1_000) + REQUEST_RETENTION_SECONDS,
      };
      const markerOutcome = await jobStore.putRequestMarker(markerRecord);
      if (markerOutcome === "created") {
        marker = markerRecord;
      } else {
        marker = assertMatchingMarker(await jobStore.getRequestMarker(markerId), { accountId, jobId, requestFingerprint });
        if (marker.state === "job_reserved") {
          job = await jobStore.getJob(jobId);
          if (!job) throw expiredRequest();
          assertMatchingJob(job, { accountId, requestFingerprint });
          if (job.status !== "pending_usage") return { ...publicCustomerJob(job), duplicate: true };
        }
      }
    }

    let createdJob = false;
    if (!job) {
      const pendingJob = {
        jobId,
        accountId,
        requestId,
        requestFingerprint,
        jobType: "repository_audit",
        priority: quote.priority,
        capacityWeight: quote.capacityWeight,
        weightedCredits: quote.weightedCredits,
        sourceFingerprint,
        status: "pending_usage",
        createdAt,
        expiresAt: Math.floor(timestamp / 1_000) + JOB_RETENTION_SECONDS,
      };
      const jobOutcome = await jobStore.putJob(pendingJob);
      if (jobOutcome === "created") {
        job = pendingJob;
        createdJob = true;
      } else {
        job = assertMatchingJob(await jobStore.getJob(jobId), { accountId, requestFingerprint });
        if (job.status !== "pending_usage") return { ...publicCustomerJob(job), duplicate: true };
      }
    }

    if (marker.state !== "job_reserved") {
      const markerOutcome = await jobStore.markRequestJobReserved(markerId, requestFingerprint, jobId);
      if (markerOutcome !== "updated") throw idempotencyConflict();
      marker = { ...marker, state: "job_reserved" };
    }

    const usage = await apiAccessService.consumeUsage({
      accountId,
      credits: quote.weightedCredits,
      idempotencyKey: `priority:${requestId}`,
    });
    const usageCommittedAt = new Date(now()).toISOString();
    const activation = await jobStore.activatePendingJob(jobId, requestFingerprint, usageCommittedAt);
    if (activation === "conflict") throw idempotencyConflict();
    if (activation !== "updated" && activation !== "already_progressed") {
      throw new Error("Priority job activation returned an invalid result.");
    }

    const queued = activation === "updated"
      ? { ...job, status: "queued", usageCommittedAt }
      : assertMatchingJob(await jobStore.getJob(jobId), { accountId, requestFingerprint });
    return {
      ...publicCustomerJob(queued),
      usage,
      duplicate: !createdJob || usage?.duplicate === true || activation === "already_progressed",
    };
  }

  async function getJob(input = {}) {
    assertCustomerFeature();
    const accountId = cleanAccountId(input.accountId);
    const jobId = cleanJobId(input.jobId);
    await accountAccess.assertActive(accountId);
    const job = await jobStore.getJob(jobId);
    if (!job || job.accountId !== accountId) throw new PriorityJobError(404, "job_not_found", "Priority job was not found.");
    return publicCustomerJob(job);
  }

  return { quote, submit, getJob, quoteWorkload };
}
