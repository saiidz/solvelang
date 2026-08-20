import { analyzeServerAuditServiceProcessRelationships } from "./serviceProcessRelationships";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditServiceProcessRelationshipFindingOptions = {
  maxRelationships?: number;
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

export function createServerAuditServiceProcessRelationshipFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditServiceProcessRelationshipFindingOptions = {},
): ServerAuditFinding[] {
  const analysis = analyzeServerAuditServiceProcessRelationships(snapshot, {
    maxRelationships: options.maxRelationships,
  });
  const findings: ServerAuditFinding[] = [];

  for (const relationship of analysis.relationships) {
    if (relationship.kind !== "service-process-group") continue;

    const evidence: ServerAuditFinding["evidence"] = relationship.sources.map((source) => ({
      source,
      summary: "exact-label service/process relationship participant",
    }));
    if (relationship.sourcesTruncated) {
      evidence.push({
        source: relationship.id,
        summary: `source fanout truncated at ${analysis.execution.maxSourcesPerRelationship} structural entries`,
      });
    }

    findings.push({
      id: stableId(["service-process", "group", relationship.id]),
      severity: "info",
      category: "evidence-integrity",
      title: "Service maps to multiple collected process records",
      summary: `A collected service has more than one collected process record under the conservative exact-label relationship contract.${relationship.sourcesTruncated ? " The structural source fanout was truncated." : ""} This can be legitimate and does not by itself indicate a service-health problem.`,
      recommendation: "Treat the relationship as a process group unless stronger same-snapshot evidence identifies a unique authoritative process; do not infer ownership from names alone.",
      evidence,
    });
  }

  if (analysis.summary.unmatchedServices > 0) {
    findings.push({
      id: stableId(["service-process", "unmatched", String(analysis.summary.unmatchedServices)]),
      severity: "info",
      category: "coverage",
      title: "Some collected services have no exact-label process relationship",
      summary: `${analysis.summary.unmatchedServices} collected service record(s) had no collected process record under the conservative exact-label relationship contract. This can be normal for inactive or one-shot services and does not prove a failed service or incomplete process collection.`,
      recommendation: "Use service state plus same-run process evidence before drawing runtime-health or ownership conclusions; treat the relationship surface as partial when stronger evidence is unavailable.",
      evidence: [{
        source: "serviceProcessRelationships.summary.unmatchedServices",
        summary: String(analysis.summary.unmatchedServices),
      }],
    });
  }

  if (analysis.summary.skippedServiceNames > 0) {
    findings.push({
      id: stableId(["service-process", "labels-skipped", String(analysis.summary.skippedServiceNames)]),
      severity: "info",
      category: "coverage",
      title: "Service-process mapping skipped unsupported service labels",
      summary: `The conservative exact-label mapper skipped ${analysis.summary.skippedServiceNames} service label(s) that were empty, malformed, too long, or outside the bounded static-label contract.`,
      recommendation: "Preserve canonical static service labels in the read-only snapshot or treat service-process relationship coverage as partial; do not infer aliases, paths, or case-folded matches.",
      evidence: [{
        source: "serviceProcessRelationships.summary.skippedServiceNames",
        summary: String(analysis.summary.skippedServiceNames),
      }],
    });
  }

  if (analysis.execution.relationshipsTruncated) {
    findings.push({
      id: stableId(["service-process", "relationships-truncated", String(analysis.execution.maxRelationships)]),
      severity: "info",
      category: "coverage",
      title: "Service-process relationships were truncated",
      summary: `The deterministic relationship stage reached its ${analysis.execution.maxRelationships}-relationship cap, so additional exact-label service/process mappings may exist outside the emitted evidence.`,
      recommendation: "Narrow or split the read-only snapshot before drawing completeness conclusions from service-process relationships.",
      evidence: [{
        source: "serviceProcessRelationships.execution.maxRelationships",
        summary: String(analysis.execution.maxRelationships),
      }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
