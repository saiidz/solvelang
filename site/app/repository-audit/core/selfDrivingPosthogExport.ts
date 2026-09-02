import {
  createSolveContextSnapshot,
  defaultSolveContextLimits,
  type SolveContextScalar,
  type SolveContextSignalInput,
  type SolveContextSnapshot,
} from "./selfDrivingContext";
import type { SelfDrivingMode } from "./selfDriving";

export const POSTHOG_SANITIZED_EXPORT_SCHEMA = "solvelang.posthog.sanitized-export.v0" as const;

export const POSTHOG_EXPORT_RECORD_KINDS = [
  "event",
  "error",
  "deployment",
  "feature-flag",
  "experiment",
  "ai-trace",
  "mcp-tool-call",
] as const;
export type PostHogExportRecordKind = (typeof POSTHOG_EXPORT_RECORD_KINDS)[number];

export const POSTHOG_EXPORT_SKIP_REASONS = [
  "provider-redacted",
  "unsupported-record",
  "outside-window",
  "export-truncated",
] as const;
export type PostHogExportSkipReason = (typeof POSTHOG_EXPORT_SKIP_REASONS)[number];

export type PostHogSanitizedExportRecord = {
  kind: PostHogExportRecordKind;
  locator: string;
  observedAt: string;
  summary: string;
  revision?: string;
  dimensions?: Record<string, SolveContextScalar>;
  metrics?: Record<string, number>;
  sanitized: true;
};

export type PostHogSanitizedExportV0 = {
  schema: typeof POSTHOG_SANITIZED_EXPORT_SCHEMA;
  sanitized: true;
  source: {
    projectLocator: string;
    exportLocator: string;
    coverage: "complete" | "partial";
    skipped?: Array<{
      reason: PostHogExportSkipReason;
      count: number;
    }>;
  };
  records: PostHogSanitizedExportRecord[];
};

export type PostHogOfflineAdapterOptions = {
  requestedMode?: SelfDrivingMode;
  maxSignals?: number;
};

export type PostHogOfflineAdapterResult = {
  schema: "solvelang.self-driving.posthog-offline-adapter.v0";
  mode: "analyze-only";
  source: {
    provider: "posthog";
    projectLocator: string;
    exportLocator: string;
    coverage: "complete" | "partial";
    skipped: Array<{
      reason: PostHogExportSkipReason;
      count: number;
    }>;
  };
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    offlineExportOnly: true;
    sanitizedOnly: true;
    personIdentityAccess: false;
    sessionReplayAccess: false;
    rawBodyAccess: false;
    rawPromptAccess: false;
    networkAccess: false;
    credentialAccess: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"source-partial" | "context-truncated">;
    inputRecords: number;
    emittedSignals: number;
    duplicateSignals: number;
  };
  context: SolveContextSnapshot;
};

const maxInputRecords = defaultSolveContextLimits.maxInputSignals;
const maxSourceTextLength = 160;

const recordKindToContextKind: Record<PostHogExportRecordKind, SolveContextSignalInput["kind"]> = {
  event: "runtime-event",
  error: "error",
  deployment: "deployment",
  "feature-flag": "feature-flag",
  experiment: "experiment",
  "ai-trace": "ai-trace",
  "mcp-tool-call": "mcp-tool-call",
};

const forbiddenIdentityOrRawKeyPattern = /(?:^|[_.-])(?:distinct[_-]?id|person[_-]?id|user[_-]?id|email|phone|ip(?:[_-]?address)?|session[_-]?id|recording[_-]?id|person|profile|prompt|completion|request[_-]?body|response[_-]?body|raw[_-]?body|session[_-]?recording|replay|headers?|cookies?)(?:$|[_.-])/i;
const emailValuePattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ipv4ValuePattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort(compareText);
  if (unknown.length > 0) {
    throw new Error(`${name} contains unsupported or unsafe fields: ${unknown.join(", ")}.`);
  }
}

function normalizeText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) {
    throw new Error(`${name} must be sanitized single-line text.`);
  }
  return normalized;
}

function normalizeProjectLocator(value: unknown, name: string): string {
  const normalized = normalizeText(value, name, maxSourceTextLength);
  if (emailValuePattern.test(normalized) || ipv4ValuePattern.test(normalized)) {
    throw new Error(`${name} must be a non-personal project/export locator.`);
  }
  return normalized;
}

function assertNoIdentityOrRawMetadata(input: unknown, name: string): void {
  if (input === undefined) return;
  assertObject(input, name);
  for (const [key, rawValue] of Object.entries(input)) {
    if (forbiddenIdentityOrRawKeyPattern.test(key)) {
      throw new Error(`${name}.${key} is identity/raw-content shaped and is not allowed in the sanitized PostHog export contract.`);
    }
    if (typeof rawValue === "string") {
      const value = rawValue.trim();
      if (emailValuePattern.test(value) || ipv4ValuePattern.test(value)) {
        throw new Error(`${name}.${key} appears to contain person/network identity and is not allowed.`);
      }
    }
  }
}

function normalizeSkipped(input: unknown, coverage: "complete" | "partial"): PostHogOfflineAdapterResult["source"]["skipped"] {
  if (input === undefined) {
    if (coverage === "partial") throw new Error("source.skipped is required when source.coverage=partial.");
    return [];
  }
  if (!Array.isArray(input)) throw new Error("source.skipped must be an array.");
  if (input.length > 16) throw new Error("source.skipped exceeds the 16-entry bound.");

  const normalized = input.map((item, index) => {
    assertObject(item, `source.skipped[${index}]`);
    assertExactKeys(item, ["reason", "count"], `source.skipped[${index}]`);
    const reason = item.reason;
    if (typeof reason !== "string" || !POSTHOG_EXPORT_SKIP_REASONS.includes(reason as PostHogExportSkipReason)) {
      throw new Error(`source.skipped[${index}].reason is not supported.`);
    }
    const count = item.count;
    if (!Number.isSafeInteger(count) || (count as number) < 1) {
      throw new Error(`source.skipped[${index}].count must be a positive safe integer.`);
    }
    return { reason: reason as PostHogExportSkipReason, count: count as number };
  }).sort((left, right) => compareText(left.reason, right.reason) || left.count - right.count);

  if (coverage === "complete" && normalized.length > 0) {
    throw new Error("source.coverage=complete cannot declare skipped records.");
  }
  if (coverage === "partial" && normalized.length === 0) {
    throw new Error("source.coverage=partial requires at least one skipped-record declaration.");
  }
  return normalized;
}

function normalizeRecordKind(value: unknown, index: number): PostHogExportRecordKind {
  if (typeof value !== "string" || !POSTHOG_EXPORT_RECORD_KINDS.includes(value as PostHogExportRecordKind)) {
    throw new Error(`records[${index}].kind is unsupported. Session replay and arbitrary PostHog payload kinds are intentionally not accepted.`);
  }
  return value as PostHogExportRecordKind;
}

function normalizeRecord(record: unknown, index: number, projectLocator: string): SolveContextSignalInput {
  assertObject(record, `records[${index}]`);
  assertExactKeys(
    record,
    ["kind", "locator", "observedAt", "summary", "revision", "dimensions", "metrics", "sanitized"],
    `records[${index}]`,
  );
  if (record.sanitized !== true) throw new Error(`records[${index}] must be explicitly sanitized.`);
  assertNoIdentityOrRawMetadata(record.dimensions, `records[${index}].dimensions`);
  assertNoIdentityOrRawMetadata(record.metrics, `records[${index}].metrics`);

  const kind = normalizeRecordKind(record.kind, index);
  const locator = normalizeProjectLocator(record.locator, `records[${index}].locator`);
  const sourceLocator = `posthog:${projectLocator}:${locator}`;
  if (sourceLocator.length > defaultSolveContextLimits.maxLocatorLength) {
    throw new Error(`records[${index}] locator exceeds the downstream Solve Context bound after provider qualification.`);
  }

  return {
    kind: recordKindToContextKind[kind],
    source: "posthog-offline-export",
    locator: sourceLocator,
    observedAt: normalizeText(record.observedAt, `records[${index}].observedAt`, 64),
    summary: normalizeText(record.summary, `records[${index}].summary`, defaultSolveContextLimits.maxSummaryLength),
    ...(record.revision === undefined
      ? {}
      : { revision: normalizeText(record.revision, `records[${index}].revision`, defaultSolveContextLimits.maxRevisionLength) }),
    ...(record.dimensions === undefined ? {} : { dimensions: record.dimensions as Record<string, SolveContextScalar> }),
    ...(record.metrics === undefined ? {} : { metrics: record.metrics as Record<string, number> }),
    sanitized: true,
  };
}

export function adaptSanitizedPostHogExport(
  input: unknown,
  options: PostHogOfflineAdapterOptions = {},
): PostHogOfflineAdapterResult {
  const requestedMode = options.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`PostHog offline adapter mode '${requestedMode}' is not enabled. The adapter is observe-only.`);
  }

  assertObject(input, "PostHog export");
  assertExactKeys(input, ["schema", "sanitized", "source", "records"], "PostHog export");
  if (input.schema !== POSTHOG_SANITIZED_EXPORT_SCHEMA) {
    throw new Error(`Unsupported PostHog export schema: ${String(input.schema)}.`);
  }
  if (input.sanitized !== true) throw new Error("PostHog offline adapter accepts sanitized exports only.");

  assertObject(input.source, "source");
  assertExactKeys(input.source, ["projectLocator", "exportLocator", "coverage", "skipped"], "source");
  const projectLocator = normalizeProjectLocator(input.source.projectLocator, "source.projectLocator");
  const exportLocator = normalizeProjectLocator(input.source.exportLocator, "source.exportLocator");
  const coverage = input.source.coverage;
  if (coverage !== "complete" && coverage !== "partial") {
    throw new Error("source.coverage must be complete or partial.");
  }
  const skipped = normalizeSkipped(input.source.skipped, coverage);

  if (!Array.isArray(input.records)) throw new Error("records must be an array.");
  if (input.records.length > maxInputRecords) {
    throw new Error(`PostHog export exceeds the ${maxInputRecords}-record safety bound.`);
  }

  const maxSignals = options.maxSignals ?? defaultSolveContextLimits.maxSignals;
  if (!Number.isSafeInteger(maxSignals) || maxSignals < 1 || maxSignals > maxInputRecords) {
    throw new Error(`maxSignals must be a positive safe integer no greater than ${maxInputRecords}.`);
  }

  const signals = input.records.map((record, index) => normalizeRecord(record, index, projectLocator));
  const context = createSolveContextSnapshot(signals, { requestedMode: "observe", maxSignals });
  const partialReasons: PostHogOfflineAdapterResult["execution"]["partialReasons"] = [];
  if (coverage === "partial") partialReasons.push("source-partial");
  if (context.execution.truncated) partialReasons.push("context-truncated");

  return {
    schema: "solvelang.self-driving.posthog-offline-adapter.v0",
    mode: "analyze-only",
    source: {
      provider: "posthog",
      projectLocator,
      exportLocator,
      coverage,
      skipped,
    },
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      offlineExportOnly: true,
      sanitizedOnly: true,
      personIdentityAccess: false,
      sessionReplayAccess: false,
      rawBodyAccess: false,
      rawPromptAccess: false,
      networkAccess: false,
      credentialAccess: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    execution: {
      status: partialReasons.length === 0 ? "complete" : "partial",
      partialReasons,
      inputRecords: input.records.length,
      emittedSignals: context.execution.emittedSignals,
      duplicateSignals: context.execution.duplicateSignals,
    },
    context,
  };
}
