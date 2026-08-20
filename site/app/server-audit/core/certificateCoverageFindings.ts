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

export function createServerAuditCertificateCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates = (snapshot.web?.certificates ?? [])
    .map((certificate, index): ServerAuditFinding | undefined => {
      if (certificate.notAfter !== undefined || certificate.daysRemaining !== undefined) return undefined;
      const source = `web.certificates[${index}]`;
      return {
        id: stableId(["certificate-coverage", "missing-expiry", source]),
        severity: "info",
        category: "coverage",
        title: "TLS certificate record lacks expiry evidence",
        summary: `Certificate evidence at web.certificates[${index}] includes no explicit notAfter timestamp or daysRemaining value, so expiry posture for that record is unknown.`,
        recommendation: "Re-collect certificate inventory with the reviewed read-only collector before relying on TLS expiry posture; a separate approved endpoint check is required to verify the actively served certificate.",
        evidence: [{ source, summary: "certificate record has no supplied expiry evidence" }],
      };
    })
    .filter((finding): finding is ServerAuditFinding => finding !== undefined)
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["certificate-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Certificate expiry coverage findings were truncated",
    summary: "The deterministic certificate-coverage stage reached its finding limit, so additional supplied certificate records may lack expiry evidence outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating certificate-expiry evidence as complete.",
    evidence: [{ source: "web.certificates", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
