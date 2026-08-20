import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditStaleLogFindingOptions = {
  maxFindings?: number;
  staleAfterHours?: number;
};

const DEFAULT_STALE_AFTER_HOURS = 168;
const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = boundedNumber(value, fallback, minimum, maximum, label);
  if (!Number.isSafeInteger(resolved)) throw new Error(`${label} must be an integer.`);
  return resolved;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

export function createServerAuditStaleLogFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditStaleLogFindingOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit stale-log maxFindings");
  const staleAfterHours = boundedNumber(
    options.staleAfterHours,
    DEFAULT_STALE_AFTER_HOURS,
    1,
    24 * 365 * 10,
    "Server Audit stale-log staleAfterHours",
  );
  const collectedAt = timestamp(snapshot.collectedAt);
  if (collectedAt === undefined) return [];

  const thresholdMs = staleAfterHours * 60 * 60 * 1_000;
  const candidates: ServerAuditFinding[] = [];
  for (const [index, log] of (snapshot.logs ?? []).entries()) {
    const modifiedAt = timestamp(log.modifiedAt);
    if (modifiedAt === undefined || modifiedAt > collectedAt || collectedAt - modifiedAt <= thresholdMs) continue;
    candidates.push({
      id: stableId(["stale-log", String(index), String(modifiedAt), String(collectedAt), String(staleAfterHours)]),
      severity: "low",
      category: "logging",
      title: "Log activity appears stale relative to the snapshot",
      summary: `Collected log entry ${index} has no observed modification within the configured ${staleAfterHours}-hour window and is a review candidate. This metadata alone does not prove a rotation failure, inactive service, or missing logs.`,
      recommendation: "Confirm whether the workload normally emits this log, then review rotation and retention configuration with bounded operational evidence before taking action.",
      evidence: [{ source: `logs[${index}].modifiedAt`, summary: `older than ${staleAfterHours} hours` }],
    });
  }

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;
  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["stale-log", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Stale-log candidates were truncated",
    summary: `The stale-log stage produced ${candidates.length} candidates and emitted only the first ${maxFindings - 1} deterministic candidates plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from stale-log candidate evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
