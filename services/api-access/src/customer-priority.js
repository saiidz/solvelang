import { createHash } from "node:crypto";
import { calculateCreditCharge } from "./credits.js";
import { getPriorityLane } from "./priority-lanes.js";
import { PriorityJobError } from "./priority-jobs.js";

const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const JOB_ID = /^job_[a-f0-9]{32}$/;

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
    result: record.result ?? null,
    errorCode: record.errorCode ?? null,
  };
}

export function createCustomerPriorityService({
  accountAccess,
  apiAccessService,
  jobStore,
  queueEnabled = false,
  customerPriorityEnabled = false,
  providerExecutionEnabled = false,
  now = Date.now,
}) {
  if (!accountAccess || typeof accountAccess.assertActive !== "function") throw new Error("Customer account access verifier is required.");
  if (!apiAccessService || typeof apiAccessService.consumeUsage !== "function") throw new Error("API access service is required.");
  if (!jobStore || typeof jobStore.putJob !== "function" || typeof jobStore.getJob !== "function") throw new Error("Priority job store is required.");

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
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ accountId, requestId, sourceFingerprint, priority: quote.priority, weightedCredits: quote.weightedCredits }))
      .digest("hex");
    const existing = await jobStore.getJob(jobId);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint || existing.accountId !== accountId) throw new PriorityJobError(409, "job_idempotency_conflict", "The job request ID was already used with different inputs.");
      return { ...publicCustomerJob(existing), duplicate: true };
    }

    const usage = await apiAccessService.consumeUsage({
      accountId,
      credits: quote.weightedCredits,
      idempotencyKey: `priority:${requestId}`,
    });
    const timestamp = now();
    const job = {
      jobId,
      accountId,
      requestId,
      requestFingerprint,
      jobType: "repository_audit",
      priority: quote.priority,
      capacityWeight: quote.capacityWeight,
      weightedCredits: quote.weightedCredits,
      sourceFingerprint,
      status: "queued",
      createdAt: new Date(timestamp).toISOString(),
      expiresAt: Math.floor(timestamp / 1_000) + 60 * 60 * 24 * 7,
    };
    const outcome = await jobStore.putJob(job);
    if (outcome !== "created") {
      const raced = await jobStore.getJob(jobId);
      if (raced?.requestFingerprint === requestFingerprint && raced.accountId === accountId) return { ...publicCustomerJob(raced), usage, duplicate: true };
      throw new PriorityJobError(409, "job_idempotency_conflict", "The job request ID was already used with different inputs.");
    }
    return { ...publicCustomerJob(job), usage, duplicate: false };
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
