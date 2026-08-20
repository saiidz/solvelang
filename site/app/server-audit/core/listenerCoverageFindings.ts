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

export function createServerAuditListenerCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const listeners = snapshot.listeningSockets;
  if (listeners === undefined || listeners.length > 0) return [];

  return [{
    id: stableId(["listener-coverage", "empty-inventory"]),
    severity: "info",
    category: "coverage",
    title: "No listening socket records supplied",
    summary: "The snapshot contains an explicit empty listening-socket inventory. The reviewed collector maps both an empty `ss` result and an unavailable/failed `ss` command to an empty array, so listener posture cannot be treated as complete from this evidence alone.",
    recommendation: "Re-collect the bounded listening-socket inventory with the reviewed read-only collector before relying on a no-listener conclusion. Treat an empty inventory as unknown coverage rather than proof that the host exposes no listening sockets.",
    evidence: [{ source: "listeningSockets", summary: "0 listening socket records" }],
  }];
}
