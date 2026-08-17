import { analyzeServerAuditInventoryConsistency, type ServerAuditInventoryIssueKind } from "./inventoryConsistency";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const TITLES: Record<ServerAuditInventoryIssueKind, string> = {
  "conflicting-package-version": "Package inventory reports conflicting versions",
  "conflicting-service-state": "Service inventory reports conflicting state",
  "conflicting-filesystem-capacity": "Filesystem inventory reports conflicting capacity",
  "conflicting-web-root-metadata": "Web-root inventory reports conflicting metadata",
};

const RECOMMENDATIONS: Record<ServerAuditInventoryIssueKind, string> = {
  "conflicting-package-version": "Re-collect package inventory with the reviewed collector and resolve duplicate evidence before relying on package-version posture.",
  "conflicting-service-state": "Re-collect service inventory and verify the collector source before relying on service state or enablement posture.",
  "conflicting-filesystem-capacity": "Re-collect filesystem capacity evidence and verify mount deduplication before relying on storage posture.",
  "conflicting-web-root-metadata": "Re-collect web-root ownership and mode metadata before relying on permission posture for the duplicated root.",
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

export function createServerAuditInventoryFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const analysis = analyzeServerAuditInventoryConsistency(snapshot);
  const findings: ServerAuditFinding[] = analysis.issues.map((issue) => ({
    id: stableId(["inventory", issue.kind, ...issue.sources]),
    severity: issue.severity,
    category: "evidence-integrity",
    title: TITLES[issue.kind],
    summary: issue.summary,
    recommendation: RECOMMENDATIONS[issue.kind],
    evidence: issue.sources.map((source) => ({ source, summary: issue.kind })),
  }));

  if (analysis.execution.issuesTruncated) {
    findings.push({
      id: stableId(["inventory", "issues-truncated", String(analysis.execution.maxIssues)]),
      severity: "info",
      category: "coverage",
      title: "Inventory consistency evidence was truncated",
      summary: "The inventory consistency stage reached its deterministic issue limit, so additional internal contradictions may exist outside the emitted evidence.",
      recommendation: "Review the bounded report first, then narrow or split the read-only snapshot before drawing a completeness conclusion.",
      evidence: [{ source: "inventoryConsistency", summary: `issue limit ${analysis.execution.maxIssues} reached` }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
