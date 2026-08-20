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

function hasUsableIdentity(value: string): boolean {
  return value.trim().normalize("NFC").length > 0;
}

export function createServerAuditListenerIdentityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates: ServerAuditFinding[] = [];

  for (const [index, listener] of (snapshot.listeningSockets ?? []).entries()) {
    if (!hasUsableIdentity(listener.protocol)) {
      const source = `listeningSockets[${index}].protocol`;
      candidates.push({
        id: stableId(["listener-identity-coverage", "unusable-protocol", source]),
        severity: "info",
        category: "coverage",
        title: "Listening socket record lacks a usable protocol identity",
        summary: `Listening-socket evidence at listeningSockets[${index}] has no non-whitespace protocol identity, so endpoint grouping and relationship attribution cannot use this record reliably.`,
        recommendation: "Re-collect the bounded listening-socket inventory with a stable protocol identity before relying on endpoint consistency or service/listener attribution conclusions.",
        evidence: [{ source, summary: "listener protocol identity is empty after normalization" }],
      });
    }

    if (!hasUsableIdentity(listener.localAddress)) {
      const source = `listeningSockets[${index}].localAddress`;
      candidates.push({
        id: stableId(["listener-identity-coverage", "unusable-address", source]),
        severity: "info",
        category: "coverage",
        title: "Listening socket record lacks a usable local-address identity",
        summary: `Listening-socket evidence at listeningSockets[${index}] has no non-whitespace local-address identity, so endpoint grouping and exposure evidence cannot use this record reliably.`,
        recommendation: "Re-collect the bounded listening-socket inventory with a stable local-address identity before relying on endpoint consistency or exposure conclusions.",
        evidence: [{ source, summary: "listener local-address identity is empty after normalization" }],
      });
    }
  }

  candidates.sort(compareFindings);
  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["listener-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Listening socket identity coverage findings were truncated",
    summary: "The deterministic listening-socket identity coverage stage reached its finding limit, so additional supplied listener records may lack usable protocol or local-address identities outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating listener identity coverage as complete.",
    evidence: [{ source: "listeningSockets", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
