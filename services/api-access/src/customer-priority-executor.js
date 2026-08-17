import { PriorityJobError } from "./priority-jobs.js";

const REPORT_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const PROVIDER = /^[A-Za-z0-9_.:-]{1,64}$/;

function validResult(result) {
  return result
    && typeof result === "object"
    && !Array.isArray(result)
    && typeof result.reportId === "string"
    && REPORT_ID.test(result.reportId)
    && typeof result.provider === "string"
    && PROVIDER.test(result.provider);
}

export function createCustomerPriorityExecutor({
  sourceStore,
  executeAudit,
  timeoutMs = 60_000,
  deleteSourceOnSuccess = true,
}) {
  if (!sourceStore || typeof sourceStore.getSource !== "function" || typeof sourceStore.deleteSource !== "function") {
    throw new Error("Priority source store is required.");
  }
  if (typeof executeAudit !== "function") throw new Error("Priority audit executor is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60_000) {
    throw new Error("Priority executor timeout is invalid.");
  }

  return async function executeCustomerJob(input = {}) {
    const controller = new AbortController();
    let timer;
    try {
      const source = await sourceStore.getSource({
        accountId: input.accountId,
        fingerprint: input.sourceFingerprint,
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new PriorityJobError(503, "priority_executor_timeout", "Priority processing timed out."));
        }, timeoutMs);
      });
      const execution = Promise.resolve(executeAudit({
        source,
        accountId: input.accountId,
        jobId: input.jobId,
        priority: input.priority,
        weightedCredits: input.weightedCredits,
        sourceFingerprint: input.sourceFingerprint,
        signal: controller.signal,
      }));
      const result = await Promise.race([execution, timeout]);
      if (!validResult(result)) throw new Error("Priority audit executor returned an invalid result.");
      if (deleteSourceOnSuccess) {
        await sourceStore.deleteSource({ accountId: input.accountId, fingerprint: input.sourceFingerprint });
      }
      return { reportId: result.reportId, provider: result.provider };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
