import { analyzeServerAuditTemporalConsistency, type ServerAuditTemporalIssueKind } from "./temporalConsistency";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const TITLES: Record<ServerAuditTemporalIssueKind, string> = {
  "invalid-certificate-timestamp": "Certificate expiry timestamp is invalid",
  "certificate-days-remaining-mismatch": "Certificate expiry evidence is inconsistent",
  "invalid-log-timestamp": "Log modification timestamp is invalid",
  "future-log-timestamp": "Log timestamp exceeds snapshot collection time",
};

const RECOMMENDATIONS: Record<ServerAuditTemporalIssueKind, string> = {
  "invalid-certificate-timestamp": "Re-collect certificate metadata with the reviewed collector before relying on certificate-expiry posture.",
  "certificate-days-remaining-mismatch": "Re-collect certificate metadata and verify collector clock/timezone handling before relying on the reported remaining-day value.",
  "invalid-log-timestamp": "Re-collect log metadata with a valid timestamp before using log recency as audit evidence.",
  "future-log-timestamp": "Verify host clock synchronization and re-collect the snapshot before drawing conclusions from log recency.",
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

export function createServerAuditTemporalFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const analysis = analyzeServerAuditTemporalConsistency(snapshot);
  const findings: ServerAuditFinding[] = analysis.issues.map((issue) => ({
    id: stableId(["temporal", issue.kind, issue.source, issue.summary]),
    severity: issue.severity,
    category: "evidence-integrity",
    title: TITLES[issue.kind],
    summary: issue.summary,
    recommendation: RECOMMENDATIONS[issue.kind],
    evidence: [{ source: issue.source, summary: issue.kind }],
  }));

  if (analysis.execution.issuesTruncated) {
    findings.push({
      id: stableId(["temporal", "issues-truncated", String(analysis.execution.maxIssues)]),
      severity: "info",
      category: "coverage",
      title: "Temporal consistency evidence was truncated",
      summary: "The temporal consistency stage reached its deterministic issue limit, so additional timestamp inconsistencies may exist outside the emitted evidence.",
      recommendation: "Review the bounded report first, then narrow or split the read-only snapshot before drawing a completeness conclusion.",
      evidence: [{ source: "temporalConsistency", summary: `issue limit ${analysis.execution.maxIssues} reached` }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
