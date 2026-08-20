import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditBackupCoverageOptions = {
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

export function createServerAuditBackupCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditBackupCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit backup-coverage maxFindings");
  const backups = snapshot.backups;
  if (backups === undefined || backups.length === 0) return [];

  const candidates = backups.flatMap((backup, index): ServerAuditFinding[] => {
    if (backup.ageHours !== undefined) return [];
    return [{
      id: stableId(["backup-coverage", "missing-age", String(index)]),
      severity: "info",
      category: "coverage",
      title: "Backup record lacks freshness evidence",
      summary: "A supplied backup record has no ageHours value, so freshness posture for that artifact cannot be established from this snapshot.",
      recommendation: "Re-collect backup inventory with the reviewed read-only collector before relying on backup freshness; verify restoreability separately against the workload's recovery objectives.",
      evidence: [{ source: `backups[${index}].ageHours`, summary: "freshness evidence is absent" }],
    }];
  }).sort(compareFinding);

  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["backup-coverage", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Backup freshness coverage findings were truncated",
    summary: `The backup-coverage stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from backup freshness evidence.",
    evidence: [{ source: "backups", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
