import {
  analyzeServerAuditFilesystemArtifactRelationships,
  type ServerAuditFilesystemArtifactRelationshipKind,
} from "./filesystemArtifactRelationships";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

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

function ambiguityTitle(kind: ServerAuditFilesystemArtifactRelationshipKind): string {
  return kind === "ambiguous-filesystem-log"
    ? "Log evidence maps ambiguously to filesystem inventory"
    : "Backup evidence maps ambiguously to filesystem inventory";
}

export function createServerAuditFilesystemArtifactRelationshipFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const analysis = analyzeServerAuditFilesystemArtifactRelationships(snapshot);
  const findings: ServerAuditFinding[] = [];

  for (const relationship of analysis.relationships) {
    if (relationship.kind !== "ambiguous-filesystem-log" && relationship.kind !== "ambiguous-filesystem-backup") continue;
    const evidence: ServerAuditFinding["evidence"] = relationship.sources.map((source) => ({ source, summary: relationship.kind }));
    if (relationship.sourcesTruncated) {
      evidence.push({
        source: relationship.id,
        summary: `source fanout truncated at ${analysis.execution.maxSourcesPerRelationship} entries; artifact source retained`,
      });
    }
    findings.push({
      id: stableId(["filesystem-artifact", relationship.kind, relationship.id]),
      severity: "medium",
      category: "evidence-integrity",
      title: ambiguityTitle(relationship.kind),
      summary: `The artifact path matched more than one equally specific collected filesystem mount. The finding uses structural snapshot indexes only and does not choose an authoritative mount.${relationship.sourcesTruncated ? " The source fanout was truncated, with the triggering artifact source retained." : ""}`,
      recommendation: "Re-collect filesystem and artifact inventory with the reviewed collector, remove duplicate/contradictory mount evidence, and avoid drawing storage-posture conclusions until the mapping is unambiguous.",
      evidence,
    });
  }

  if (analysis.summary.unresolvedArtifacts > 0) {
    findings.push({
      id: stableId(["filesystem-artifact", "unresolved", String(analysis.summary.unresolvedArtifacts)]),
      severity: "info",
      category: "coverage",
      title: "Some artifact evidence could not be mapped to a filesystem",
      summary: `${analysis.summary.unresolvedArtifacts} collected log/backup artifact(s) had valid absolute paths but did not fall under any valid collected filesystem mount.`,
      recommendation: "Collect the missing filesystem mount evidence or narrow the snapshot before using artifact-to-filesystem relationships for storage conclusions.",
      evidence: [{ source: "filesystemArtifactRelationships.summary.unresolvedArtifacts", summary: String(analysis.summary.unresolvedArtifacts) }],
    });
  }

  if (analysis.summary.skippedInvalidArtifactPaths > 0 || analysis.summary.skippedInvalidMountPaths > 0) {
    findings.push({
      id: stableId([
        "filesystem-artifact",
        "invalid-paths",
        String(analysis.summary.skippedInvalidArtifactPaths),
        String(analysis.summary.skippedInvalidMountPaths),
      ]),
      severity: "info",
      category: "coverage",
      title: "Filesystem artifact mapping skipped invalid path evidence",
      summary: `The bounded lexical mapper skipped ${analysis.summary.skippedInvalidArtifactPaths} artifact path(s) and ${analysis.summary.skippedInvalidMountPaths} mount path(s) that were absent or not valid absolute POSIX paths.`,
      recommendation: "Re-collect the affected read-only evidence with canonical absolute paths before relying on filesystem/artifact relationship completeness.",
      evidence: [
        { source: "filesystemArtifactRelationships.summary.skippedInvalidArtifactPaths", summary: String(analysis.summary.skippedInvalidArtifactPaths) },
        { source: "filesystemArtifactRelationships.summary.skippedInvalidMountPaths", summary: String(analysis.summary.skippedInvalidMountPaths) },
      ],
    });
  }

  if (analysis.execution.relationshipsTruncated) {
    findings.push({
      id: stableId(["filesystem-artifact", "relationships-truncated", String(analysis.execution.maxRelationships)]),
      severity: "info",
      category: "coverage",
      title: "Filesystem artifact relationships were truncated",
      summary: `The deterministic relationship stage reached its ${analysis.execution.maxRelationships}-relationship cap, so additional filesystem/log/backup mappings may exist outside the emitted evidence.`,
      recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from filesystem/artifact relationships.",
      evidence: [{ source: "filesystemArtifactRelationships.execution.maxRelationships", summary: String(analysis.execution.maxRelationships) }],
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
