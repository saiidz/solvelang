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

export function createServerAuditServiceCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const services = snapshot.services;
  if (services === undefined || services.length > 0) return [];

  return [{
    id: stableId(["service-coverage", "empty-inventory"]),
    severity: "info",
    category: "coverage",
    title: "No service records supplied",
    summary: "The snapshot contains an explicit empty service inventory, so service-state posture cannot be evaluated from this evidence.",
    recommendation: "Re-collect the bounded service inventory with the reviewed read-only collector before relying on service-state conclusions.",
    evidence: [{ source: "services", summary: "0 service records" }],
  }];
}
