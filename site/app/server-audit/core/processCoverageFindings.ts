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

export function createServerAuditProcessCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const processes = snapshot.processes;
  if (processes === undefined || processes.length > 0) return [];

  return [{
    id: stableId(["process-coverage", "empty-inventory"]),
    severity: "info",
    category: "coverage",
    title: "No process records supplied",
    summary: "The snapshot contains an explicit empty process inventory. The reviewed collector maps an unavailable/failed fixed `ps` command or empty output to an empty array, so process posture cannot be treated as complete from this evidence alone.",
    recommendation: "Re-collect the bounded process inventory with the reviewed read-only collector before relying on process, parent, service, or listener attribution conclusions. Treat an empty inventory as unknown coverage rather than proof that the host has no processes.",
    evidence: [{ source: "processes", summary: "0 process records" }],
  }];
}
