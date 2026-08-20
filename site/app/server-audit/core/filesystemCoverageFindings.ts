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

export function createServerAuditFilesystemCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const filesystems = snapshot.filesystems;
  if (filesystems === undefined || filesystems.length > 0) return [];

  return [{
    id: stableId(["filesystem-coverage", "empty-inventory"]),
    severity: "info",
    category: "coverage",
    title: "No filesystem records supplied",
    summary: "The snapshot contains an explicit empty filesystem inventory. The reviewed collector uses a fixed read-only `df -P -B1` command and returns no records when that command is unavailable, fails, or yields no usable filesystem rows, so storage posture cannot be treated as complete from this evidence alone.",
    recommendation: "Re-collect the bounded filesystem inventory with the reviewed read-only collector before relying on disk-capacity conclusions. Treat an empty inventory as unknown coverage rather than proof that the host has no mounted filesystems.",
    evidence: [{ source: "filesystems", summary: "0 filesystem records" }],
  }];
}
