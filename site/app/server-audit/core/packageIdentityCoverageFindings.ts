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

export function createServerAuditPackageIdentityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates = (snapshot.packages ?? [])
    .map((entry, index): ServerAuditFinding | undefined => {
      if (hasUsableIdentity(entry.name)) return undefined;
      const source = `packages[${index}].name`;
      return {
        id: stableId(["package-identity-coverage", "unusable-name", source]),
        severity: "info",
        category: "coverage",
        title: "Package record lacks a usable identity",
        summary: `Package evidence at packages[${index}] has no non-whitespace identity, so duplicate-version consistency and package-version posture cannot use this record reliably.`,
        recommendation: "Re-collect the bounded package inventory with a stable package identity before relying on duplicate-version or package-version conclusions. No advisory or CVE database is consulted by this stage.",
        evidence: [{ source, summary: "package identity is empty after normalization" }],
      };
    })
    .filter((finding): finding is ServerAuditFinding => finding !== undefined)
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["package-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Package identity coverage findings were truncated",
    summary: "The deterministic package-identity coverage stage reached its finding limit, so additional supplied package records may lack usable identities outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating package identity coverage as complete.",
    evidence: [{ source: "packages", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
