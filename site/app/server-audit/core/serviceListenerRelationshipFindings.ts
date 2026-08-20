import { analyzeServerAuditServiceListenerRelationships } from "./serviceListenerRelationships";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditServiceListenerRelationshipFindingOptions = {
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

export function createServerAuditServiceListenerRelationshipFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditServiceListenerRelationshipFindingOptions = {},
): ServerAuditFinding[] {
  const analysis = analyzeServerAuditServiceListenerRelationships(snapshot, {
    maxRelationships: options.maxRelationships,
  });
  const findings: ServerAuditFinding[] = [];

  for (const relationship of analysis.relationships) {
    if (relationship.kind !== "ambiguous-service-listener") continue;
    const evidence: ServerAuditFinding["evidence"] = relationship.sources.map((source) => ({
      source,
      summary: "ambiguous exact-label service/listener attribution participant",
    }));
    if (relationship.sourcesTruncated) {
      evidence.push({
        source: relationship.id,
        summary: `source fanout truncated at ${analysis.execution.maxSourcesPerRelationship} structural entries`,
      });
    }
    findings.push({
      id: stableId(["service-listener", "ambiguous", relationship.id]),
      severity: "info",
      category: "evidence-integrity",
      title: "Listener attribution is ambiguous across collected processes",
      summary: `A listener matched a collected service by the analyzer's exact-label contract, but more than one collected process record has that same label, so this snapshot cannot uniquely attribute the listener to one process.${relationship.sourcesTruncated ? " The structural source fanout was truncated." : ""}`,
      recommendation: "Re-collect service, process, and listener evidence from the same reviewed collector run before using this relationship for ownership or exposure conclusions.",
      evidence,
    });
  }

  if (analysis.summary.unresolvedListenerAttributions > 0) {
    findings.push({
      id: stableId(["service-listener", "unresolved", String(analysis.summary.unresolvedListenerAttributions)]),
      severity: "info",
      category: "coverage",
      title: "Some service-listener attribution lacks collected process evidence",
      summary: `${analysis.summary.unresolvedListenerAttributions} listener attribution(s) matched collected service labels but had no corresponding collected process record under the exact-label contract.`,
      recommendation: "Re-collect the bounded process and listener inventories together before drawing service ownership conclusions from these records.",
      evidence: [{
        source: "serviceListenerRelationships.summary.unresolvedListenerAttributions",
        summary: String(analysis.summary.unresolvedListenerAttributions),
      }],
    });
  }

  const skippedLabels = analysis.summary.skippedServiceNames
    + analysis.summary.invalidProcessLabelsSkipped
    + analysis.summary.invalidListenerLabelsSkipped;
  if (skippedLabels > 0) {
    findings.push({
      id: stableId([
        "service-listener",
        "labels-skipped",
        String(analysis.summary.skippedServiceNames),
        String(analysis.summary.invalidProcessLabelsSkipped),
        String(analysis.summary.invalidListenerLabelsSkipped),
      ]),
      severity: "info",
      category: "coverage",
      title: "Service-listener mapping skipped unsupported label evidence",
      summary: `The conservative exact-label mapper skipped ${analysis.summary.skippedServiceNames} service label(s), ${analysis.summary.invalidProcessLabelsSkipped} process label(s), and ${analysis.summary.invalidListenerLabelsSkipped} listener label(s) that were empty, malformed, control-bearing, or outside the bounded label contract.`,
      recommendation: "Preserve canonical static service/process labels in the read-only snapshot or treat relationship coverage as partial; do not infer aliases, paths, or case-folded matches.",
      evidence: [
        { source: "serviceListenerRelationships.summary.skippedServiceNames", summary: String(analysis.summary.skippedServiceNames) },
        { source: "serviceListenerRelationships.summary.invalidProcessLabelsSkipped", summary: String(analysis.summary.invalidProcessLabelsSkipped) },
        { source: "serviceListenerRelationships.summary.invalidListenerLabelsSkipped", summary: String(analysis.summary.invalidListenerLabelsSkipped) },
      ],
    });
  }

  if (analysis.execution.relationshipsTruncated) {
    findings.push({
      id: stableId(["service-listener", "relationships-truncated", String(analysis.execution.maxRelationships)]),
      severity: "info",
      category: "coverage",
      title: "Service-listener relationships were truncated",
      summary: `The deterministic relationship stage reached its ${analysis.execution.maxRelationships}-relationship cap, so additional service/process/listener mappings may exist outside the emitted evidence.`,
      recommendation: "Narrow or split the read-only snapshot before drawing completeness conclusions from service-listener relationships.",
      evidence: [{
        source: "serviceListenerRelationships.execution.maxRelationships",
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
