import { cleanCustomerPriorityReportText } from "./customer-priority-report.js";

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function validAbortSignal(signal) {
  return signal
    && typeof signal === "object"
    && typeof signal.aborted === "boolean"
    && typeof signal.addEventListener === "function";
}

export function createCustomerPriorityProviderAdapter({ provider, execute }) {
  if (typeof provider !== "string" || !PROVIDER_ID.test(provider)) {
    throw new Error("Priority provider ID is invalid.");
  }
  if (typeof execute !== "function") {
    throw new Error("Priority provider executor is required.");
  }

  return async function executeAudit(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Priority provider input is invalid.");
    }
    if (!validAbortSignal(input.signal)) {
      throw new Error("Priority provider abort signal is required.");
    }

    const result = await execute({
      source: input.source,
      accountId: input.accountId,
      jobId: input.jobId,
      priority: input.priority,
      weightedCredits: input.weightedCredits,
      sourceFingerprint: input.sourceFingerprint,
      signal: input.signal,
    });

    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Priority provider returned an invalid report.");
    }

    return {
      provider,
      reportText: cleanCustomerPriorityReportText(result.reportText),
    };
  };
}
