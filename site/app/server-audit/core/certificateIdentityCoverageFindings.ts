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

function hasUsableIdentity(name: string): boolean {
  return name.trim().normalize("NFC").length > 0;
}

export function createServerAuditCertificateIdentityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates = (snapshot.web?.certificates ?? [])
    .map((certificate, index): ServerAuditFinding | undefined => {
      if (hasUsableIdentity(certificate.name)) return undefined;
      const source = `web.certificates[${index}].name`;
      return {
        id: stableId(["certificate-identity-coverage", "unusable-name", source]),
        severity: "info",
        category: "coverage",
        title: "TLS certificate record lacks a usable identity",
        summary: `Certificate evidence at web.certificates[${index}] has no non-whitespace identity, so duplicate-certificate grouping and endpoint attribution cannot use this record reliably.`,
        recommendation: "Re-collect the bounded certificate inventory with a stable certificate or endpoint identity before relying on duplicate, expiry, or endpoint-level TLS conclusions; a separately approved endpoint check is still required to verify the actively served certificate.",
        evidence: [{ source, summary: "certificate identity is empty after normalization" }],
      };
    })
    .filter((finding): finding is ServerAuditFinding => finding !== undefined)
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["certificate-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Certificate identity coverage findings were truncated",
    summary: "The deterministic certificate-identity coverage stage reached its finding limit, so additional supplied certificate records may lack usable identities outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating certificate identity coverage as complete.",
    evidence: [{ source: "web.certificates", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
