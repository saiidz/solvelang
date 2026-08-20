import {
  analyzeServerAuditScheduledJobRelationships,
  type ServerAuditScheduledJobRelationshipOptions,
} from "./scheduledJobRelationships";
import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const MAX_FINDING_SOURCES = 32;

export type ServerAuditScheduledJobRelationshipFindingOptions = ServerAuditScheduledJobRelationshipOptions;

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

export function createServerAuditScheduledJobRelationshipFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditScheduledJobRelationshipFindingOptions = {},
): ServerAuditFinding[] {
  const analysis = analyzeServerAuditScheduledJobRelationships(snapshot, options);
  const findings: ServerAuditFinding[] = [];
  const relationshipsByJob = new Map<number, typeof analysis.relationships>();

  for (const relationship of analysis.relationships) {
    const relationships = relationshipsByJob.get(relationship.jobIndex) ?? [];
    relationships.push(relationship);
    relationshipsByJob.set(relationship.jobIndex, relationships);
  }

  let emittedMultiTargetJobs = 0;
  for (const [jobIndex, relationships] of relationshipsByJob) {
    if (relationships.length < 2) continue;
    emittedMultiTargetJobs += 1;

    const sources = new Set<string>([`scheduledJobs[${jobIndex}]`]);
    for (const relationship of relationships) {
      sources.add(
        relationship.kind === "scheduled-job-service"
          ? `services[${relationship.targetIndex}]`
          : `processes[${relationship.targetIndex}]`,
      );
    }
    const allSources = [...sources].sort();
    const boundedSources = allSources.slice(0, MAX_FINDING_SOURCES);
    const sourcesTruncated = allSources.length > boundedSources.length;

    findings.push({
      id: stableId(["scheduled-job", "multiple-targets", String(jobIndex), String(relationships.length), ...allSources]),
      severity: "info",
      category: "evidence-integrity",
      title: "Scheduled job maps to multiple collected targets",
      summary: `A collected scheduled-job record has ${relationships.length} emitted exact-name-token relationship(s) to supplied service/process records.${sourcesTruncated ? " Structural source evidence was truncated." : ""} Multiple targets can be intentional and do not by themselves prove duplicate execution or incorrect ownership.`,
      recommendation: "Review the same-snapshot scheduled-job and target records before using this static relationship evidence for ownership or execution conclusions.",
      evidence: [
        ...boundedSources.map((source) => ({
          source,
          summary: "structural scheduled-job relationship participant",
        })),
        ...(sourcesTruncated ? [{
          source: `scheduledJobRelationships.jobs[${jobIndex}]`,
          summary: `structural source fanout truncated at ${MAX_FINDING_SOURCES} entries`,
        }] : []),
      ],
    });
  }

  const partiallyMaterializedMultiTargetJobs = analysis.summary.jobsWithPartiallyMaterializedMultipleRelationships;
  if (
    analysis.summary.jobsWithMultipleRelationships > emittedMultiTargetJobs
    || partiallyMaterializedMultiTargetJobs > 0
  ) {
    findings.push({
      id: stableId([
        "scheduled-job",
        "multi-target-output-truncated",
        String(analysis.summary.jobsWithMultipleRelationships),
        String(emittedMultiTargetJobs),
        String(partiallyMaterializedMultiTargetJobs),
      ]),
      severity: "info",
      category: "coverage",
      title: "Some multi-target scheduled-job mappings are not fully materialized",
      summary: `${analysis.summary.jobsWithMultipleRelationships} analyzed scheduled-job record(s) had more than one exact-name-token match in the bounded supplied targets; ${emittedMultiTargetJobs} record(s) had at least two relationships materialized in the bounded output, and ${partiallyMaterializedMultiTargetJobs} multi-target record(s) had observed fanout that exceeded the remaining relationship-output capacity. Per-job fanout details can therefore be incomplete even though the observed multi-target counts remain exact for the analyzed snapshot.`,
      recommendation: "Treat per-job scheduled-job fanout as partial when the relationship output is truncated; narrow or split the read-only snapshot rather than executing scheduled-job commands or guessing aliases.",
      evidence: [
        {
          source: "scheduledJobRelationships.summary.jobsWithMultipleRelationships",
          summary: String(analysis.summary.jobsWithMultipleRelationships),
        },
        {
          source: "scheduledJobRelationships.output.emittedMultiTargetJobs",
          summary: String(emittedMultiTargetJobs),
        },
        {
          source: "scheduledJobRelationships.summary.jobsWithPartiallyMaterializedMultipleRelationships",
          summary: String(partiallyMaterializedMultiTargetJobs),
        },
      ],
    });
  }

  if (analysis.summary.unresolvedJobs > 0) {
    findings.push({
      id: stableId(["scheduled-job", "unresolved", String(analysis.summary.unresolvedJobs)]),
      severity: "info",
      category: "coverage",
      title: "Some scheduled jobs have no exact-name-token relationship",
      summary: `${analysis.summary.unresolvedJobs} analyzed scheduled-job record(s) had no exact-name-token match to the bounded supplied service/process targets. This does not prove that the job is invalid, inactive, or unrelated to runtime work.`,
      recommendation: "Treat scheduled-job relationship coverage as partial for these records unless stronger same-snapshot structural evidence is available; do not infer aliases or execute command content to improve matching.",
      evidence: [{
        source: "scheduledJobRelationships.summary.unresolvedJobs",
        summary: String(analysis.summary.unresolvedJobs),
      }],
    });
  }

  const partialEvidence: ServerAuditFinding["evidence"] = [];
  if (analysis.execution.jobsTruncated) {
    partialEvidence.push({
      source: "scheduledJobRelationships.execution.maxJobs",
      summary: String(analysis.execution.maxJobs),
    });
  }
  if (analysis.execution.targetsTruncated) {
    partialEvidence.push({
      source: "scheduledJobRelationships.execution.maxTargets",
      summary: String(analysis.execution.maxTargets),
    });
  }
  if (analysis.execution.relationshipsTruncated) {
    partialEvidence.push({
      source: "scheduledJobRelationships.execution.maxRelationships",
      summary: String(analysis.execution.maxRelationships),
    });
  }
  if (analysis.execution.oversizedCommandSummariesSkipped > 0) {
    partialEvidence.push({
      source: "scheduledJobRelationships.execution.oversizedCommandSummariesSkipped",
      summary: String(analysis.execution.oversizedCommandSummariesSkipped),
    });
  }

  if (partialEvidence.length > 0) {
    findings.push({
      id: stableId([
        "scheduled-job",
        "partial",
        analysis.execution.jobsTruncated ? `jobs:${analysis.execution.maxJobs}` : "",
        analysis.execution.targetsTruncated ? `targets:${analysis.execution.maxTargets}` : "",
        analysis.execution.relationshipsTruncated ? `relationships:${analysis.execution.maxRelationships}` : "",
        `oversized:${analysis.execution.oversizedCommandSummariesSkipped}`,
      ]),
      severity: "info",
      category: "coverage",
      title: "Scheduled-job relationship analysis is partial",
      summary: "One or more deterministic scan bounds or oversized sanitized command summaries limited scheduled-job relationship evidence, so additional static relationships may exist outside the emitted result.",
      recommendation: "Narrow or split the read-only snapshot, or retain the partial status, before drawing completeness conclusions. Do not execute scheduled-job commands to fill relationship gaps.",
      evidence: partialEvidence,
    });
  }

  return findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}
