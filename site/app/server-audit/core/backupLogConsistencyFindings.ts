import {
  analyzeServerAuditBackupLogConsistency,
  type ServerAuditBackupLogConsistencyIssueKind,
} from "./backupLogConsistency";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const TITLES: Record<ServerAuditBackupLogConsistencyIssueKind, string> = {
  "conflicting-backup-record": "Backup inventory reports conflicting metadata",
  "conflicting-log-record": "Log inventory reports conflicting metadata",
};

const RECOMMENDATIONS: Record<ServerAuditBackupLogConsistencyIssueKind, string> = {
  "conflicting-backup-record": "Re-collect backup evidence with the reviewed collector and resolve duplicate metadata before relying on backup freshness, size, or location posture.",
  "conflicting-log-record": "Re-collect log evidence and resolve duplicate size/timestamp metadata before relying on log growth, freshness, or retention posture.",
};

const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

export function createServerAuditBackupLogConsistencyFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const analysis = analyzeServerAuditBackupLogConsistency(snapshot);
  const findings: ServerAuditFinding[] = analysis.issues.map((issue) => ({
    id: stableId(["backup-log-consistency", issue.kind, ...issue.sources]),
    severity: issue.severity,
    category: "evidence-integrity",
    title: TITLES[issue.kind],
    summary: issue.summary,
    recommendation: RECOMMENDATIONS[issue.kind],
    evidence: issue.sources.map((source) => ({ source, summary: issue.kind })),
  }));

  if (analysis.execution.issuesTruncated) {
    findings.push({
      id: stableId(["backup-log-consistency", "issues-truncated", String(analysis.execution.maxIssues)]),
      severity: "info",
      category: "coverage",
      title: "Backup/log consistency evidence was truncated",
      summary: "The backup/log consistency stage reached its deterministic issue limit, so additional internal contradictions may exist outside the emitted evidence.",
      recommendation: "Review the bounded evidence first, then narrow or split the read-only snapshot before drawing a completeness conclusion.",
      evidence: [{ source: "backupLogConsistency", summary: `issue limit ${analysis.execution.maxIssues} reached` }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
