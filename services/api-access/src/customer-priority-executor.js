import { PriorityJobError } from "./priority-jobs.js";
import { createCustomerPriorityReport } from "./customer-priority-report.js";

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
      const report = createCustomerPriorityReport({
        jobId: input.jobId,
        sourceFingerprint: input.sourceFingerprint,
        provider: result?.provider,
        reportText: result?.reportText,
      });
      if (deleteSourceOnSuccess) {
        await sourceStore.deleteSource({ accountId: input.accountId, fingerprint: input.sourceFingerprint });
      }
      return report;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
