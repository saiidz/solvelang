import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const MAX_FILESYSTEM_CAPACITY_EVIDENCE = 100;

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

export function createServerAuditFilesystemCapacityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const filesystems = snapshot.filesystems;
  if (filesystems === undefined || filesystems.length === 0) return [];

  const missingUsagePercent = filesystems
    .map((filesystem, index) => (filesystem.usagePercent === undefined ? index : undefined))
    .filter((index): index is number => index !== undefined);

  if (missingUsagePercent.length === 0) return [];

  const evidence = missingUsagePercent
    .slice(0, MAX_FILESYSTEM_CAPACITY_EVIDENCE)
    .map((index) => ({
      source: `filesystems[${index}].usagePercent`,
      summary: "usagePercent missing",
    }));
  const evidenceTruncated = missingUsagePercent.length > evidence.length;

  return [{
    id: stableId([
      "filesystem-capacity-coverage",
      String(filesystems.length),
      String(missingUsagePercent.length),
      ...evidence.map((item) => item.source),
    ]),
    severity: "info",
    category: "coverage",
    title: "Filesystem usage evidence is incomplete",
    summary: `${missingUsagePercent.length} of ${filesystems.length} supplied filesystem record(s) omit usagePercent, so disk-capacity threshold analysis is incomplete.${evidenceTruncated ? ` Only the first ${evidence.length} structural reference(s) are included.` : ""}`,
    recommendation: "Re-collect the bounded filesystem inventory with the reviewed read-only collector before treating filesystems without usagePercent as healthy or below an operational threshold.",
    evidence,
  }];
}
