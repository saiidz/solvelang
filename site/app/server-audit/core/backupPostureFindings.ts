import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditBackupPostureOptions = {
  maxFindings?: number;
  staleAfterHours?: number;
};

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

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

function youngestBackupWithAge(backups: NonNullable<ServerAuditSnapshot["backups"]>) {
  let youngest: { index: number; ageHours: number } | undefined;
  backups.forEach((backup, index) => {
    if (backup.ageHours === undefined || !Number.isFinite(backup.ageHours)) return;
    if (youngest === undefined || backup.ageHours < youngest.ageHours) {
      youngest = { index, ageHours: backup.ageHours };
    }
  });
  return youngest;
}

export function createServerAuditBackupPostureFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditBackupPostureOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit backup-posture maxFindings");
  const staleAfterHours = boundedNumber(options.staleAfterHours, 72, 1, 24 * 365 * 10, "Server Audit backup-posture staleAfterHours");
  const backups = snapshot.backups;
  if (backups === undefined) return [];

  const findings: ServerAuditFinding[] = [];
  const youngest = youngestBackupWithAge(backups);
  if (youngest !== undefined && youngest.ageHours > staleAfterHours) {
    findings.push({
      id: stableId(["backup-posture", "stale", String(youngest.index), String(youngest.ageHours), String(staleAfterHours)]),
      severity: "medium",
      category: "backup",
      title: "Backup evidence is older than the configured freshness threshold",
      summary: `The youngest collected backup entry with age evidence is entry ${youngest.index} at ${youngest.ageHours} hours old, exceeding the ${staleAfterHours}-hour review threshold. The finding intentionally withholds backup names and paths.`,
      recommendation: "Verify that a newer successful backup exists and that restore testing, retention, and off-host/offsite protection match the workload's recovery objectives before relying on this backup posture.",
      evidence: [{ source: `backups[${youngest.index}].ageHours`, summary: `${youngest.ageHours} hours` }],
    });
  }

  backups.forEach((backup, index) => {
    if (backup.sizeBytes === 0) {
      findings.push({
        id: stableId(["backup-posture", "zero-size", String(index)]),
        severity: "low",
        category: "backup",
        title: "Backup evidence reports a zero-byte file",
        summary: `Collected backup entry ${index} reports zero bytes. A zero-byte file may be an incomplete placeholder, but this snapshot alone does not prove backup failure.`,
        recommendation: "Verify backup job completion and restoreability using reviewed operational evidence before counting the entry toward recovery coverage.",
        evidence: [{ source: `backups[${index}].sizeBytes`, summary: "0 bytes" }],
      });
    }
  });

  findings.sort(compareFinding);
  if (findings.length <= maxFindings) return findings;

  const bounded = findings.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["backup-posture", "findings-truncated", String(maxFindings), String(findings.length)]),
    severity: "info",
    category: "coverage",
    title: "Backup posture findings were truncated",
    summary: `The backup-posture stage produced ${findings.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from backup posture evidence.",
    evidence: [{ source: "backups", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
