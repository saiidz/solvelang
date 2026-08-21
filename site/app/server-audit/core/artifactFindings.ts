import { analyzeServerAuditArtifactConsistency, type ServerAuditArtifactConsistencyIssueKind } from "./artifactConsistency";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const TITLES: Record<ServerAuditArtifactConsistencyIssueKind, string> = {
  "conflicting-backup-metadata": "Backup inventory reports conflicting metadata",
  "conflicting-log-metadata": "Log inventory reports conflicting metadata",
};

const RECOMMENDATIONS: Record<ServerAuditArtifactConsistencyIssueKind, string> = {
  "conflicting-backup-metadata": "Re-collect backup inventory with the reviewed collector and resolve duplicate evidence before relying on backup age, identity, or size posture.",
  "conflicting-log-metadata": "Re-collect log inventory and account for collection-time churn before relying on log size or modification-time posture.",
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

export function createServerAuditArtifactFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const analysis = analyzeServerAuditArtifactConsistency(snapshot);
  const findings: ServerAuditFinding[] = analysis.issues.map((issue) => ({
    id: stableId([
      "artifact",
      issue.kind,
      ...issue.sources,
      ...(issue.sourcesTruncated ? [`sources-truncated:${issue.sourceCount}`] : []),
    ]),
    severity: issue.severity,
    category: "evidence-integrity",
    title: TITLES[issue.kind],
    summary: issue.sourcesTruncated
      ? `${issue.summary} Structural evidence references are bounded to ${issue.sources.length} of ${issue.sourceCount} affected records.`
      : issue.summary,
    recommendation: RECOMMENDATIONS[issue.kind],
    evidence: issue.sources.map((source) => ({ source, summary: issue.kind })),
  }));

  if (analysis.execution.issuesTruncated) {
    findings.push({
      id: stableId(["artifact", "issues-truncated", String(analysis.execution.maxIssues)]),
      severity: "info",
      category: "coverage",
      title: "Artifact consistency evidence was truncated",
      summary: "The backup/log consistency stage reached its deterministic issue limit, so additional contradictions may exist outside the emitted evidence.",
      recommendation: "Review the bounded evidence first, then narrow or split the read-only snapshot before drawing a completeness conclusion.",
      evidence: [{ source: "artifactConsistency", summary: `issue limit ${analysis.execution.maxIssues} reached` }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
