import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const MAX_FILESYSTEM_BYTE_EVIDENCE = 100;
const BYTE_FIELDS = ["sizeBytes", "usedBytes", "availableBytes"] as const;

type FilesystemByteField = (typeof BYTE_FIELDS)[number];

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

export function createServerAuditFilesystemByteCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const filesystems = snapshot.filesystems;
  if (filesystems === undefined || filesystems.length === 0) return [];

  const missingByField: Record<FilesystemByteField, number[]> = {
    sizeBytes: [],
    usedBytes: [],
    availableBytes: [],
  };

  filesystems.forEach((filesystem, index) => {
    for (const field of BYTE_FIELDS) {
      if (filesystem[field] === undefined) missingByField[field].push(index);
    }
  });

  const missingCounts = BYTE_FIELDS.map((field) => missingByField[field].length);
  const totalMissing = missingCounts.reduce((sum, count) => sum + count, 0);
  if (totalMissing === 0) return [];

  const evidence: ServerAuditFinding["evidence"] = [];
  for (let offset = 0; evidence.length < MAX_FILESYSTEM_BYTE_EVIDENCE; offset += 1) {
    let added = false;
    for (const field of BYTE_FIELDS) {
      const index = missingByField[field][offset];
      if (index === undefined) continue;
      evidence.push({
        source: `filesystems[${index}].${field}`,
        summary: `${field} missing`,
      });
      added = true;
      if (evidence.length >= MAX_FILESYSTEM_BYTE_EVIDENCE) break;
    }
    if (!added) break;
  }

  const evidenceTruncated = totalMissing > evidence.length;
  const [missingSize, missingUsed, missingAvailable] = missingCounts;

  return [{
    id: stableId([
      "filesystem-byte-coverage",
      String(filesystems.length),
      String(missingSize),
      String(missingUsed),
      String(missingAvailable),
      ...evidence.map((item) => item.source),
    ]),
    severity: "info",
    category: "coverage",
    title: "Filesystem byte-accounting evidence is incomplete",
    summary: `${missingSize} sizeBytes, ${missingUsed} usedBytes, and ${missingAvailable} availableBytes field(s) are missing across ${filesystems.length} supplied filesystem record(s), so byte-level capacity/accounting analysis is incomplete.${evidenceTruncated ? ` Only the first ${evidence.length} structural reference(s) are included.` : ""}`,
    recommendation: "Re-collect the bounded filesystem inventory with the reviewed read-only collector before treating missing byte-accounting fields as complete capacity evidence.",
    evidence,
  }];
}
