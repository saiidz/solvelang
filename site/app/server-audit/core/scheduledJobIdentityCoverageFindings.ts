import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

const MAX_FINDINGS = 100;
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

function compareFindings(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

function hasUsableIdentity(value: string): boolean {
  return value.trim().normalize("NFC").length > 0;
}

export function createServerAuditScheduledJobIdentityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates = (snapshot.scheduledJobs ?? [])
    .flatMap((job, index): ServerAuditFinding[] => {
      const findings: ServerAuditFinding[] = [];

      if (!hasUsableIdentity(job.source)) {
        const source = `scheduledJobs[${index}].source`;
        findings.push({
          id: stableId(["scheduled-job-identity-coverage", "unusable-source", source]),
          severity: "info",
          category: "coverage",
          title: "Scheduled-job record lacks a usable source identity",
          summary: `Scheduled-job evidence at scheduledJobs[${index}] has no non-whitespace source identity, so provenance and source-level grouping cannot use this record reliably.`,
          recommendation: "Re-collect the bounded scheduled-job inventory with a stable structural source before relying on scheduled-job provenance or relationship conclusions for this record.",
          evidence: [{ source, summary: "scheduled-job source identity is empty after normalization" }],
        });
      }

      if (!hasUsableIdentity(job.commandSummary)) {
        const source = `scheduledJobs[${index}].commandSummary`;
        findings.push({
          id: stableId(["scheduled-job-identity-coverage", "unusable-command", source]),
          severity: "info",
          category: "coverage",
          title: "Scheduled-job record lacks a usable command identity",
          summary: `Scheduled-job evidence at scheduledJobs[${index}] has no non-whitespace command identity, so static service/process relationship attribution cannot use this record reliably.`,
          recommendation: "Re-collect the bounded scheduled-job inventory with a stable redacted command summary before relying on scheduled-job-to-service/process relationship conclusions for this record.",
          evidence: [{ source, summary: "scheduled-job command identity is empty after normalization" }],
        });
      }

      return findings;
    })
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["scheduled-job-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Scheduled-job identity coverage findings were truncated",
    summary: "The deterministic scheduled-job identity coverage stage reached its finding limit, so additional supplied scheduled-job records may lack usable source or command identities outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating scheduled-job identity coverage as complete.",
    evidence: [{ source: "scheduledJobs", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
