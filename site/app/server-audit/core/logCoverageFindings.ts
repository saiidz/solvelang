import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditLogCoverageOptions = {
  maxFindings?: number;
};

const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
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

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

export function createServerAuditLogCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditLogCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit log-coverage maxFindings");
  const logs = snapshot.logs;
  if (logs === undefined) return [];

  const candidates: ServerAuditFinding[] = [];
  if (logs.length === 0) {
    candidates.push({
      id: stableId(["log-coverage", "empty-inventory"]),
      severity: "info",
      category: "coverage",
      title: "No log records supplied",
      summary: "The snapshot contains an explicit empty log inventory, so log size and activity posture cannot be evaluated from this evidence.",
      recommendation: "Re-collect a bounded log inventory with the reviewed read-only collector before relying on log posture conclusions.",
      evidence: [{ source: "logs", summary: "0 log records" }],
    });
  }

  logs.forEach((log, index) => {
    if (log.modifiedAt === undefined) {
      candidates.push({
        id: stableId(["log-coverage", "missing-modified-at", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Log record lacks activity timestamp evidence",
        summary: "A supplied log record has no modifiedAt value, so stale-log activity posture for that entry cannot be established from this snapshot.",
        recommendation: "Re-collect bounded log metadata with a modification timestamp before relying on stale-log activity posture.",
        evidence: [{ source: `logs[${index}].modifiedAt`, summary: "activity timestamp evidence is absent" }],
      });
    }
    if (log.sizeBytes === undefined) {
      candidates.push({
        id: stableId(["log-coverage", "missing-size", String(index)]),
        severity: "info",
        category: "coverage",
        title: "Log record lacks size evidence",
        summary: "A supplied log record has no sizeBytes value, so large-log size posture for that entry cannot be established from this snapshot.",
        recommendation: "Re-collect bounded log metadata with size evidence before relying on large-log posture.",
        evidence: [{ source: `logs[${index}].sizeBytes`, summary: "size evidence is absent" }],
      });
    }
  });

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["log-coverage", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Log evidence coverage findings were truncated",
    summary: `The log-coverage stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from log activity or size evidence.",
    evidence: [{ source: "logs", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
