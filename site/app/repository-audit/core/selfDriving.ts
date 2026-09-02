import type { RepositorySeverity } from "./inventory";

export const SELF_DRIVING_MODES = ["observe", "suggest", "pr", "auto"] as const;
export type SelfDrivingMode = (typeof SELF_DRIVING_MODES)[number];

export const SOLVE_SCOUT_KINDS = [
  "code",
  "security",
  "ci",
  "experience",
  "incident",
  "rollout",
  "ai",
  "cost",
] as const;
export type SolveScoutKind = (typeof SOLVE_SCOUT_KINDS)[number];

export const SCOUT_SIGNAL_KINDS = [
  "repository",
  "runtime-event",
  "error",
  "log",
  "trace",
  "support",
  "deployment",
  "feature-flag",
  "experiment",
  "warehouse",
  "ai-trace",
  "mcp-tool-call",
] as const;
export type ScoutSignalKind = (typeof SCOUT_SIGNAL_KINDS)[number];

export const SCOUT_ACTION_KINDS = [
  "inspect",
  "propose-patch",
  "open-pr",
  "auto-merge",
  "change-rollout",
  "rollback",
] as const;
export type ScoutActionKind = (typeof SCOUT_ACTION_KINDS)[number];

export type ScoutProvenance = {
  kind: ScoutSignalKind;
  locator: string;
  revision?: string;
  note?: string;
};

export type ScoutConfidence = {
  score: number;
  basis: string;
};

export type ScoutRecommendedAction = {
  kind: ScoutActionKind;
  label: string;
};

export type ScoutFindingInput = {
  scout: SolveScoutKind;
  severity: RepositorySeverity;
  title: string;
  summary: string;
  impact: string;
  confidence: ScoutConfidence;
  provenance: ScoutProvenance[];
  recommendedAction: ScoutRecommendedAction;
};

export type SolveInboxItem = ScoutFindingInput & {
  id: string;
  provenance: ScoutProvenance[];
  recommendedAction: ScoutRecommendedAction & { kind: "inspect" };
};

export type SolveInbox = {
  schema: "solvelang.self-driving.inbox.v0";
  mode: "analyze-only";
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    allowedActions: readonly ["inspect"];
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  limits: {
    maxFindings: number;
    maxInputFindings: number;
    maxProvenancePerFinding: number;
  };
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: Array<"finding-count">;
    inputFindings: number;
    uniqueFindings: number;
    duplicateFindings: number;
    emittedFindings: number;
  };
  items: SolveInboxItem[];
};

export type SolveInboxOptions = {
  requestedMode?: SelfDrivingMode;
  maxFindings?: number;
};

export const defaultSolveInboxLimits = Object.freeze({
  maxFindings: 200,
  maxInputFindings: 5_000,
  maxProvenancePerFinding: 16,
  maxTextLength: 4_096,
});

const severityRank: Record<RepositorySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertEnum<T extends string>(value: string, allowed: readonly T[], name: string): asserts value is T {
  if (!allowed.includes(value as T)) throw new Error(`${name} is not supported: ${value}`);
}

function normalizeText(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty.`);
  if (normalized.length > defaultSolveInboxLimits.maxTextLength) {
    throw new Error(`${name} exceeds the ${defaultSolveInboxLimits.maxTextLength}-character bound.`);
  }
  return normalized;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function normalizeConfidence(value: ScoutConfidence): ScoutConfidence {
  if (!value || typeof value !== "object") throw new Error("confidence is required.");
  if (!Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    throw new Error("confidence.score must be between 0 and 1.");
  }
  return {
    score: value.score,
    basis: normalizeText(value.basis, "confidence.basis"),
  };
}

function normalizeProvenance(items: ScoutProvenance[]): ScoutProvenance[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Each scout finding requires provenance.");
  if (items.length > defaultSolveInboxLimits.maxProvenancePerFinding) {
    throw new Error(`A scout finding may include at most ${defaultSolveInboxLimits.maxProvenancePerFinding} provenance records.`);
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`provenance[${index}] must be an object.`);
    assertEnum(item.kind, SCOUT_SIGNAL_KINDS, `provenance[${index}].kind`);
    return {
      kind: item.kind,
      locator: normalizeText(item.locator, `provenance[${index}].locator`),
      ...(item.revision === undefined ? {} : { revision: normalizeText(item.revision, `provenance[${index}].revision`) }),
      ...(item.note === undefined ? {} : { note: normalizeText(item.note, `provenance[${index}].note`) }),
    };
  }).sort((left, right) =>
    compareText(left.kind, right.kind)
    || compareText(left.locator, right.locator)
    || compareText(left.revision ?? "", right.revision ?? "")
    || compareText(left.note ?? "", right.note ?? ""));
}

function normalizeAction(action: ScoutRecommendedAction): ScoutRecommendedAction & { kind: "inspect" } {
  if (!action || typeof action !== "object") throw new Error("recommendedAction is required.");
  assertEnum(action.kind, SCOUT_ACTION_KINDS, "recommendedAction.kind");
  if (action.kind !== "inspect") {
    throw new Error(`Observe-only Self-Driving does not permit the '${action.kind}' action.`);
  }
  return {
    kind: "inspect",
    label: normalizeText(action.label, "recommendedAction.label"),
  };
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

function canonicalFindingKey(finding: Omit<SolveInboxItem, "id">): string {
  return JSON.stringify({
    scout: finding.scout,
    severity: finding.severity,
    title: finding.title,
    summary: finding.summary,
    impact: finding.impact,
    confidence: finding.confidence,
    provenance: finding.provenance,
    recommendedAction: finding.recommendedAction,
  });
}

function normalizeFinding(input: ScoutFindingInput): Omit<SolveInboxItem, "id"> {
  if (!input || typeof input !== "object") throw new Error("Scout findings must be objects.");
  assertEnum(input.scout, SOLVE_SCOUT_KINDS, "scout");
  assertEnum(input.severity, ["critical", "high", "medium", "low", "info"] as const, "severity");
  return {
    scout: input.scout,
    severity: input.severity,
    title: normalizeText(input.title, "title"),
    summary: normalizeText(input.summary, "summary"),
    impact: normalizeText(input.impact, "impact"),
    confidence: normalizeConfidence(input.confidence),
    provenance: normalizeProvenance(input.provenance),
    recommendedAction: normalizeAction(input.recommendedAction),
  };
}

function compareInboxItems(left: SolveInboxItem, right: SolveInboxItem): number {
  return severityRank[left.severity] - severityRank[right.severity]
    || compareText(left.scout, right.scout)
    || compareText(left.title, right.title)
    || compareText(left.id, right.id);
}

export function createSolveInbox(inputs: ScoutFindingInput[], options: SolveInboxOptions = {}): SolveInbox {
  if (!Array.isArray(inputs)) throw new Error("Scout findings must be an array.");
  if (inputs.length > defaultSolveInboxLimits.maxInputFindings) {
    throw new Error(`Scout input exceeds the ${defaultSolveInboxLimits.maxInputFindings}-finding safety bound.`);
  }

  const requestedMode = options.requestedMode ?? "observe";
  assertEnum(requestedMode, SELF_DRIVING_MODES, "requestedMode");
  if (requestedMode !== "observe") {
    throw new Error(`Self-Driving mode '${requestedMode}' is not enabled. The current implementation is observe-only.`);
  }

  const maxFindings = options.maxFindings ?? defaultSolveInboxLimits.maxFindings;
  assertPositiveSafeInteger(maxFindings, "maxFindings");
  if (maxFindings > defaultSolveInboxLimits.maxInputFindings) {
    throw new Error(`maxFindings cannot exceed ${defaultSolveInboxLimits.maxInputFindings}.`);
  }

  const uniqueByKey = new Map<string, SolveInboxItem>();
  for (const input of inputs) {
    const normalized = normalizeFinding(input);
    const key = canonicalFindingKey(normalized);
    if (!uniqueByKey.has(key)) uniqueByKey.set(key, { ...normalized, id: `scout_${stableHash(key)}` });
  }

  const sorted = [...uniqueByKey.values()].sort(compareInboxItems);
  const items = sorted.slice(0, maxFindings);
  const truncated = sorted.length > items.length;

  return {
    schema: "solvelang.self-driving.inbox.v0",
    mode: "analyze-only",
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      allowedActions: ["inspect"],
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    limits: {
      maxFindings,
      maxInputFindings: defaultSolveInboxLimits.maxInputFindings,
      maxProvenancePerFinding: defaultSolveInboxLimits.maxProvenancePerFinding,
    },
    execution: {
      status: truncated ? "partial" : "complete",
      truncated,
      truncationReasons: truncated ? ["finding-count"] : [],
      inputFindings: inputs.length,
      uniqueFindings: sorted.length,
      duplicateFindings: inputs.length - sorted.length,
      emittedFindings: items.length,
    },
    items,
  };
}
