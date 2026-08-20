import type { ServerAuditFinding, ServerAuditSeverity, ServerAuditSnapshot } from "./types";

export type ServerAuditServiceCoverageOptions = {
  maxFindings?: number;
};

const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

function compareFinding(left: ServerAuditFinding, right: ServerAuditFinding): number {
  return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id);
}

export function createServerAuditServiceCoverageFindings(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditServiceCoverageOptions = {},
): ServerAuditFinding[] {
  const maxFindings = boundedInteger(options.maxFindings, 100, 1, 1_000, "Server Audit service-coverage maxFindings");
  const services = snapshot.services;
  if (services === undefined) return [];

  const candidates: ServerAuditFinding[] = [];
  if (services.length === 0) {
    candidates.push({
      id: stableId(["service-coverage", "empty-inventory"]),
      severity: "info",
      category: "coverage",
      title: "No service records supplied",
      summary: "The snapshot contains an explicit empty service inventory, so service state and boot-enablement posture cannot be evaluated from this evidence.",
      recommendation: "Re-collect the bounded service inventory with the reviewed read-only collector before relying on service posture conclusions.",
      evidence: [{ source: "services", summary: "0 service records" }],
    });
  }

  services.forEach((service, index) => {
    if (service.enabled !== undefined) return;
    candidates.push({
      id: stableId(["service-coverage", "missing-enabled", String(index)]),
      severity: "info",
      category: "coverage",
      title: "Service record lacks enablement evidence",
      summary: "A supplied service record has no enabled value, so boot-enablement posture for that entry cannot be established from this snapshot.",
      recommendation: "Re-collect bounded service metadata with enablement evidence before relying on boot-start posture for this entry.",
      evidence: [{ source: `services[${index}].enabled`, summary: "enablement evidence is absent" }],
    });
  });

  candidates.sort(compareFinding);
  if (candidates.length <= maxFindings) return candidates;

  const bounded = candidates.slice(0, maxFindings - 1);
  bounded.push({
    id: stableId(["service-coverage", "findings-truncated", String(maxFindings), String(candidates.length)]),
    severity: "info",
    category: "coverage",
    title: "Service evidence coverage findings were truncated",
    summary: `The service-coverage stage produced ${candidates.length} findings and emitted only the first ${maxFindings - 1} deterministic findings plus this limitation marker.`,
    recommendation: "Narrow or split the read-only snapshot before drawing a completeness conclusion from service enablement evidence.",
    evidence: [{ source: "services", summary: `finding limit ${maxFindings} reached` }],
  });
  return bounded.sort(compareFinding);
}
