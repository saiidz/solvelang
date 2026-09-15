export const CONTEXT_OBSERVABILITY_SCHEMA = "solvelang.context.observability.v0" as const;
export const MAX_CONTEXT_OBSERVABILITY_HANDLES = 4_096;

export const CONTEXT_RETRIEVAL_REJECT_CODES = [
  "sensitive_path",
  "malformed_handle",
  "invalid_hash",
  "invalid_range",
  "stale_source",
  "range_outside_source",
  "excerpt_hash_mismatch",
  "handle_identity_mismatch",
  "unknown",
] as const;

export type ContextRetrievalRejectCode = typeof CONTEXT_RETRIEVAL_REJECT_CODES[number];

type OperationName = "plan" | "pack" | "retrieve";

interface MutableLatency {
  measured: number;
  totalMs: number;
  maxMs: number | null;
}

interface MutableOperation {
  requests: number;
  successes: number;
  failures: number;
  latency: MutableLatency;
}

export interface ContextLatencySnapshot {
  measured: number;
  totalMs: number;
  meanMs: number | null;
  maxMs: number | null;
}

export interface ContextOperationSnapshot {
  requests: number;
  successes: number;
  failures: number;
  successRate: number | null;
  latency: ContextLatencySnapshot;
}

export interface ContextObservabilitySnapshot {
  schema: typeof CONTEXT_OBSERVABILITY_SCHEMA;
  scope: {
    mode: "process-session";
    persistence: "none";
    resetSupported: false;
    contentRetained: false;
    pathsRetained: false;
    providerUsageMeasured: false;
  };
  handles: {
    maxTracked: number;
    issuedEntryEvents: number;
    uniqueIssuedTracked: number;
    uniqueIssuedRetrieved: number;
    trackingTruncated: boolean;
    sessionIssuedHandleRetrievalRate: number | null;
  };
  plan: ContextOperationSnapshot & {
    issuedEntryEvents: number;
  };
  pack: ContextOperationSnapshot & {
    issuedEntryEvents: number;
  };
  retrieval: ContextOperationSnapshot & {
    retrievedBytes: number;
    staleHandleRejects: number;
    rejectCodes: Record<ContextRetrievalRejectCode, number>;
  };
}

const EMPTY_REJECT_COUNTS = (): Record<ContextRetrievalRejectCode, number> => ({
  sensitive_path: 0,
  malformed_handle: 0,
  invalid_hash: 0,
  invalid_range: 0,
  stale_source: 0,
  range_outside_source: 0,
  excerpt_hash_mismatch: 0,
  handle_identity_mismatch: 0,
  unknown: 0,
});

function operation(): MutableOperation {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    latency: { measured: 0, totalMs: 0, maxMs: null },
  };
}

function observeLatency(target: MutableLatency, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  target.measured += 1;
  target.totalMs += durationMs;
  target.maxMs = target.maxMs === null ? durationMs : Math.max(target.maxMs, durationMs);
}

function operationSnapshot(value: MutableOperation): ContextOperationSnapshot {
  return {
    requests: value.requests,
    successes: value.successes,
    failures: value.failures,
    successRate: value.requests === 0 ? null : value.successes / value.requests,
    latency: {
      measured: value.latency.measured,
      totalMs: value.latency.totalMs,
      meanMs: value.latency.measured === 0 ? null : value.latency.totalMs / value.latency.measured,
      maxMs: value.latency.maxMs,
    },
  };
}

export function classifyContextRetrievalFailure(error: unknown): ContextRetrievalRejectCode {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message;
  if (message.includes("sensitive path")) return "sensitive_path";
  if (message === "The context handle is malformed.") return "malformed_handle";
  if (message === "Context retrieval hashes must be lowercase SHA-256 values.") return "invalid_hash";
  if (message === "Context retrieval line bounds are invalid.") return "invalid_range";
  if (message.includes("source changed after the handle was created")) return "stale_source";
  if (message === "The context retrieval range is outside the current source.") return "range_outside_source";
  if (message === "The context excerpt hash does not match the current source range.") return "excerpt_hash_mismatch";
  if (message === "The context handle does not match the requested source identity.") return "handle_identity_mismatch";
  return "unknown";
}

export class ContextObservability {
  private readonly maxTrackedHandles: number;
  private readonly operations: Record<OperationName, MutableOperation> = {
    plan: operation(),
    pack: operation(),
    retrieve: operation(),
  };
  private readonly issuedHandles = new Set<string>();
  private readonly retrievedIssuedHandles = new Set<string>();
  private readonly rejectCodes = EMPTY_REJECT_COUNTS();
  private planIssuedEntryEvents = 0;
  private packIssuedEntryEvents = 0;
  private retrievedBytes = 0;
  private handleTrackingTruncated = false;

  constructor(maxTrackedHandles = MAX_CONTEXT_OBSERVABILITY_HANDLES) {
    if (!Number.isInteger(maxTrackedHandles) || maxTrackedHandles < 1 || maxTrackedHandles > MAX_CONTEXT_OBSERVABILITY_HANDLES) {
      throw new Error(`Context observability handle bound must be an integer between 1 and ${MAX_CONTEXT_OBSERVABILITY_HANDLES}.`);
    }
    this.maxTrackedHandles = maxTrackedHandles;
  }

  private recordSuccess(operationName: OperationName, durationMs: number): void {
    const target = this.operations[operationName];
    target.requests += 1;
    target.successes += 1;
    observeLatency(target.latency, durationMs);
  }

  private recordFailure(operationName: OperationName, durationMs: number): void {
    const target = this.operations[operationName];
    target.requests += 1;
    target.failures += 1;
    observeLatency(target.latency, durationMs);
  }

  private trackIssued(handles: readonly string[]): void {
    for (const handle of handles) {
      if (this.issuedHandles.has(handle)) continue;
      if (this.issuedHandles.size >= this.maxTrackedHandles) {
        this.handleTrackingTruncated = true;
        continue;
      }
      this.issuedHandles.add(handle);
    }
  }

  recordPlanSuccess(handles: readonly string[], durationMs: number): void {
    this.recordSuccess("plan", durationMs);
    this.planIssuedEntryEvents += handles.length;
    this.trackIssued(handles);
  }

  recordPlanFailure(durationMs: number): void {
    this.recordFailure("plan", durationMs);
  }

  recordPackSuccess(handles: readonly string[], durationMs: number): void {
    this.recordSuccess("pack", durationMs);
    this.packIssuedEntryEvents += handles.length;
    this.trackIssued(handles);
  }

  recordPackFailure(durationMs: number): void {
    this.recordFailure("pack", durationMs);
  }

  recordRetrievalSuccess(handle: string, bytes: number, durationMs: number): void {
    this.recordSuccess("retrieve", durationMs);
    if (Number.isSafeInteger(bytes) && bytes >= 0) this.retrievedBytes += bytes;
    if (this.issuedHandles.has(handle)) this.retrievedIssuedHandles.add(handle);
  }

  recordRetrievalFailure(code: ContextRetrievalRejectCode, durationMs: number): void {
    this.recordFailure("retrieve", durationMs);
    this.rejectCodes[CONTEXT_RETRIEVAL_REJECT_CODES.includes(code) ? code : "unknown"] += 1;
  }

  snapshot(): ContextObservabilitySnapshot {
    const uniqueIssuedTracked = this.issuedHandles.size;
    const uniqueIssuedRetrieved = this.retrievedIssuedHandles.size;
    const plan = operationSnapshot(this.operations.plan);
    const pack = operationSnapshot(this.operations.pack);
    const retrieval = operationSnapshot(this.operations.retrieve);
    return {
      schema: CONTEXT_OBSERVABILITY_SCHEMA,
      scope: {
        mode: "process-session",
        persistence: "none",
        resetSupported: false,
        contentRetained: false,
        pathsRetained: false,
        providerUsageMeasured: false,
      },
      handles: {
        maxTracked: this.maxTrackedHandles,
        issuedEntryEvents: this.planIssuedEntryEvents + this.packIssuedEntryEvents,
        uniqueIssuedTracked,
        uniqueIssuedRetrieved,
        trackingTruncated: this.handleTrackingTruncated,
        sessionIssuedHandleRetrievalRate: this.handleTrackingTruncated || uniqueIssuedTracked === 0
          ? null
          : uniqueIssuedRetrieved / uniqueIssuedTracked,
      },
      plan: {
        ...plan,
        issuedEntryEvents: this.planIssuedEntryEvents,
      },
      pack: {
        ...pack,
        issuedEntryEvents: this.packIssuedEntryEvents,
      },
      retrieval: {
        ...retrieval,
        retrievedBytes: this.retrievedBytes,
        staleHandleRejects: this.rejectCodes.stale_source,
        rejectCodes: { ...this.rejectCodes },
      },
    };
  }
}

export const contextObservability = new ContextObservability();
