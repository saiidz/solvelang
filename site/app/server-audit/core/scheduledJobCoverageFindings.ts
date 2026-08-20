import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

export function createServerAuditScheduledJobCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const scheduledJobs = snapshot.scheduledJobs;
  if (scheduledJobs === undefined || scheduledJobs.length > 0) return [];

  return [{
    id: stableId(["scheduled-job-coverage", "empty-inventory"]),
    severity: "info",
    category: "coverage",
    title: "No scheduled-job records supplied",
    summary: "The snapshot contains an explicit empty scheduled-job inventory. The reviewed collector scans a fixed set of cron directories, and missing, unreadable, or empty directories can all contribute no records, so scheduled-job posture cannot be treated as complete from this evidence alone.",
    recommendation: "Re-collect the bounded scheduled-job inventory with the reviewed read-only collector before relying on scheduled-job or scheduled-job relationship conclusions. Treat an empty inventory as unknown coverage rather than proof that the host has no scheduled jobs.",
    evidence: [{ source: "scheduledJobs", summary: "0 scheduled-job records" }],
  }];
}
