import {
  SCOUT_SIGNAL_KINDS,
  type ScoutSignalKind,
  type SelfDrivingMode,
  type SolveScoutKind,
} from "./selfDriving";

export type SolveContextScalar = string | number | boolean | null;

export type SolveContextSignalInput = {
  kind: ScoutSignalKind;
  source: string;
  locator: string;
  observedAt: string;
  summary: string;
  revision?: string;
  dimensions?: Record<string, SolveContextScalar>;
  metrics?: Record<string, number>;
  sanitized: true;
};

export type SolveContextSignal = Omit<SolveContextSignalInput, "sanitized"> & {
  id: string;
  sanitized: true;
  candidateScouts: SolveScoutKind[];
  dimensions: Record<string, SolveContextScalar>;
  metrics: Record<string, number>;
};

export type SolveContextSnapshot = {
  schema: "solvelang.self-driving.context.v0";
  mode: "analyze-only";
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    sanitizedOnly: true;
    networkAccess: false;
    credentialAccess: false;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  limits: {
    maxSignals: number;
    maxInputSignals: number;
    maxDimensionsPerSignal: number;
    maxMetricsPerSignal: number;
    maxSummaryLength: number;
  };
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: Array<"signal-count">;
    inputSignals: number;
    uniqueSignals: number;
    duplicateSignals: number;
    emittedSignals: number;
  };
  signals: SolveContextSignal[];
};

export type SolveContextOptions = {
  requestedMode?: SelfDrivingMode;
  maxSignals?: number;
};

export const defaultSolveContextLimits = Object.freeze({
  maxSignals: 500,
  maxInputSignals: 5_000,
  maxDimensionsPerSignal: 32,
  maxMetricsPerSignal: 32,
  maxSummaryLength: 1_024,
  maxLocatorLength: 512,
  maxSourceLength: 128,
  maxRevisionLength: 256,
  maxKeyLength: 64,
  maxDimensionStringLength: 256,
});

const sensitiveKeyPattern = /(?:^|[_-])(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)(?:$|[_-])/i;
const sensitiveValuePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
];

const candidateScoutsBySignal: Record<ScoutSignalKind, SolveScoutKind[]> = {
  repository: ["code", "security", "ci"],
  "runtime-event": ["experience"],
  error: ["incident"],
  log: ["incident"],
  trace: ["incident"],
  support: ["experience", "incident"],
  deployment: ["incident", "rollout"],
  "feature-flag": ["experience", "rollout"],
  experiment: ["experience", "rollout"],
  warehouse: ["experience", "cost"],
  "ai-trace": ["ai", "cost"],
  "mcp-tool-call": ["ai", "cost"],
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function assertSignalKind(value: string): asserts value is ScoutSignalKind {
  if (!SCOUT_SIGNAL_KINDS.includes(value as ScoutSignalKind)) {
    throw new Error(`Unsupported Solve Context signal kind: ${value}`);
  }
}

function rejectSensitiveValue(value: string, name: string): void {
  if (sensitiveValuePatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`${name} appears to contain credential or secret material; Solve Context accepts sanitized evidence only.`);
  }
}

function normalizeSingleLineText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) {
    throw new Error(`${name} must be a sanitized single-line value.`);
  }
  rejectSensitiveValue(normalized, name);
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const normalized = normalizeSingleLineText(value, "observedAt", 64);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error("observedAt must be a valid timestamp.");
  return parsed.toISOString();
}

function normalizeMetadataKey(value: string, name: string): string {
  const normalized = normalizeSingleLineText(value, name, defaultSolveContextLimits.maxKeyLength);
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(normalized)) {
    throw new Error(`${name} must use bounded alphanumeric metadata-key syntax.`);
  }
  if (sensitiveKeyPattern.test(normalized.replaceAll(".", "_"))) {
    throw new Error(`${name} is credential-shaped metadata and is not allowed in sanitized Solve Context evidence.`);
  }
  return normalized;
}

function normalizeDimensions(input: Record<string, SolveContextScalar> | undefined): Record<string, SolveContextScalar> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("dimensions must be an object.");
  const entries = Object.entries(input);
  if (entries.length > defaultSolveContextLimits.maxDimensionsPerSignal) {
    throw new Error(`dimensions exceed the ${defaultSolveContextLimits.maxDimensionsPerSignal}-entry bound.`);
  }

  const normalized = entries.map(([rawKey, rawValue]) => {
    const key = normalizeMetadataKey(rawKey, `dimension key '${rawKey}'`);
    if (rawValue === null || typeof rawValue === "boolean") return [key, rawValue] as const;
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) throw new Error(`dimension '${key}' must be finite.`);
      return [key, rawValue] as const;
    }
    if (typeof rawValue === "string") {
      return [key, normalizeSingleLineText(rawValue, `dimension '${key}'`, defaultSolveContextLimits.maxDimensionStringLength)] as const;
    }
    throw new Error(`dimension '${key}' must be a scalar value.`);
  });

  normalized.sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(normalized);
}

function normalizeMetrics(input: Record<string, number> | undefined): Record<string, number> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("metrics must be an object.");
  const entries = Object.entries(input);
  if (entries.length > defaultSolveContextLimits.maxMetricsPerSignal) {
    throw new Error(`metrics exceed the ${defaultSolveContextLimits.maxMetricsPerSignal}-entry bound.`);
  }

  const normalized = entries.map(([rawKey, value]) => {
    const key = normalizeMetadataKey(rawKey, `metric key '${rawKey}'`);
    if (!Number.isFinite(value)) throw new Error(`metric '${key}' must be finite.`);
    return [key, value] as const;
  });
  normalized.sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(normalized);
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul((left ^ code) >>> 0, 0x01000193) >>> 0;
    right = Math.imul((right ^ ((code + index) >>> 0)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

function normalizeSignal(input: SolveContextSignalInput): SolveContextSignal {
  if (!input || typeof input !== "object") throw new Error("Solve Context signals must be objects.");
  assertSignalKind(input.kind);
  if (input.sanitized !== true) throw new Error("Solve Context accepts sanitized signals only.");

  const normalized = {
    kind: input.kind,
    source: normalizeSingleLineText(input.source, "source", defaultSolveContextLimits.maxSourceLength),
    locator: normalizeSingleLineText(input.locator, "locator", defaultSolveContextLimits.maxLocatorLength),
    observedAt: normalizeTimestamp(input.observedAt),
    summary: normalizeSingleLineText(input.summary, "summary", defaultSolveContextLimits.maxSummaryLength),
    ...(input.revision === undefined
      ? {}
      : { revision: normalizeSingleLineText(input.revision, "revision", defaultSolveContextLimits.maxRevisionLength) }),
    dimensions: normalizeDimensions(input.dimensions),
    metrics: normalizeMetrics(input.metrics),
    sanitized: true as const,
    candidateScouts: [...candidateScoutsBySignal[input.kind]].sort(compareText),
  };
  const identity = JSON.stringify(normalized);
  return { id: `ctx_${stableHash(identity)}`, ...normalized };
}

function canonicalSignalKey(signal: SolveContextSignal): string {
  const { id: _id, ...identity } = signal;
  return JSON.stringify(identity);
}

function compareSignals(left: SolveContextSignal, right: SolveContextSignal): number {
  return compareText(right.observedAt, left.observedAt)
    || compareText(left.kind, right.kind)
    || compareText(left.source, right.source)
    || compareText(left.locator, right.locator)
    || compareText(left.id, right.id);
}

export function createSolveContextSnapshot(
  inputs: SolveContextSignalInput[],
  options: SolveContextOptions = {},
): SolveContextSnapshot {
  if (!Array.isArray(inputs)) throw new Error("Solve Context signals must be an array.");
  if (inputs.length > defaultSolveContextLimits.maxInputSignals) {
    throw new Error(`Solve Context input exceeds the ${defaultSolveContextLimits.maxInputSignals}-signal safety bound.`);
  }

  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`Solve Context mode '${requestedMode}' is not enabled. Context normalization is observe-only.`);
  }

  const maxSignals = options.maxSignals ?? defaultSolveContextLimits.maxSignals;
  assertPositiveSafeInteger(maxSignals, "maxSignals");
  if (maxSignals > defaultSolveContextLimits.maxInputSignals) {
    throw new Error(`maxSignals cannot exceed ${defaultSolveContextLimits.maxInputSignals}.`);
  }

  const uniqueByKey = new Map<string, SolveContextSignal>();
  for (const input of inputs) {
    const signal = normalizeSignal(input);
    const key = canonicalSignalKey(signal);
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, signal);
  }

  const sorted = [...uniqueByKey.values()].sort(compareSignals);
  const signals = sorted.slice(0, maxSignals);
  const truncated = signals.length < sorted.length;

  return {
    schema: "solvelang.self-driving.context.v0",
    mode: "analyze-only",
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      sanitizedOnly: true,
      networkAccess: false,
      credentialAccess: false,
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    limits: {
      maxSignals,
      maxInputSignals: defaultSolveContextLimits.maxInputSignals,
      maxDimensionsPerSignal: defaultSolveContextLimits.maxDimensionsPerSignal,
      maxMetricsPerSignal: defaultSolveContextLimits.maxMetricsPerSignal,
      maxSummaryLength: defaultSolveContextLimits.maxSummaryLength,
    },
    execution: {
      status: truncated ? "partial" : "complete",
      truncated,
      truncationReasons: truncated ? ["signal-count"] : [],
      inputSignals: inputs.length,
      uniqueSignals: sorted.length,
      duplicateSignals: inputs.length - sorted.length,
      emittedSignals: signals.length,
    },
    signals,
  };
}
