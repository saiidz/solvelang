import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const MAX_FILESYSTEM_SOURCE_EVIDENCE = 100;

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function hasUsableSource(value: string | undefined): boolean {
  return value !== undefined && value.trim().normalize("NFC").length > 0;
}

export function createServerAuditFilesystemSourceCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const filesystems = snapshot.filesystems;
  if (filesystems === undefined || filesystems.length === 0) return [];

  const missingSource = filesystems
    .map((filesystem, index) => (hasUsableSource(filesystem.filesystem) ? undefined : index))
    .filter((index): index is number => index !== undefined);

  if (missingSource.length === 0) return [];

  const evidence = missingSource.slice(0, MAX_FILESYSTEM_SOURCE_EVIDENCE).map((index) => ({
    source: `filesystems[${index}].filesystem`,
    summary: "filesystem source identity missing",
  }));
  const evidenceTruncated = missingSource.length > evidence.length;

  return [{
    id: stableId([
      "filesystem-source-coverage",
      String(filesystems.length),
      String(missingSource.length),
      ...evidence.map((item) => item.source),
    ]),
    severity: "info",
    category: "coverage",
    title: "Filesystem source identity evidence is incomplete",
    summary: `${missingSource.length} of ${filesystems.length} supplied filesystem record(s) omit a usable filesystem source identity, so device/source attribution is incomplete.${evidenceTruncated ? ` Only the first ${evidence.length} structural reference(s) are included.` : ""}`,
    recommendation: "Re-collect the bounded filesystem inventory with the reviewed read-only collector before relying on filesystem device/source attribution for records without a usable source identity.",
    evidence,
  }];
}
