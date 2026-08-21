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

function hasUsableEnablement(enabled: string | undefined): boolean {
  return enabled !== undefined && enabled.trim().normalize("NFC").length > 0;
}

export function createServerAuditServiceEnablementCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const services = snapshot.services ?? [];
  const candidates = services
    .map((service, index): ServerAuditFinding | undefined => {
      if (hasUsableEnablement(service.enabled)) return undefined;
      const source = `services[${index}].enabled`;
      return {
        id: stableId(["service-enablement-coverage", "missing-or-blank-enablement", source]),
        severity: "info",
        category: "coverage",
        title: "Service record lacks usable enablement evidence",
        summary: `Service evidence at services[${index}] has no non-whitespace enablement value, so startup-policy conclusions cannot treat this record as having observed enablement state.`,
        recommendation: "Re-collect the bounded service inventory with the reviewed read-only collector before relying on startup-policy or enablement conclusions for this record.",
        evidence: [{ source, summary: "service enablement is absent or empty after normalization" }],
      };
    })
    .filter((finding): finding is ServerAuditFinding => finding !== undefined)
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["service-enablement-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Service enablement coverage findings were truncated",
    summary: "The deterministic service-enablement coverage stage reached its finding limit, so additional supplied service records may lack usable enablement evidence outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating service-enablement coverage as complete.",
    evidence: [{ source: "services", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
