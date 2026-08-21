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

function hasUsableIdentity(mount: string): boolean {
  return mount.trim().normalize("NFC").length > 0;
}

export function createServerAuditFilesystemIdentityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  const candidates = (snapshot.filesystems ?? [])
    .map((entry, index): ServerAuditFinding | undefined => {
      if (hasUsableIdentity(entry.mount)) return undefined;
      const source = `filesystems[${index}].mount`;
      return {
        id: stableId(["filesystem-identity-coverage", "unusable-mount", source]),
        severity: "info",
        category: "coverage",
        title: "Filesystem record lacks a usable mount identity",
        summary: `Filesystem evidence at filesystems[${index}] has no non-whitespace mount identity, so capacity attribution and filesystem-artifact relationships cannot use this record reliably.`,
        recommendation: "Re-collect the bounded filesystem inventory with a stable mount identity before relying on capacity or filesystem-artifact relationship conclusions for this record.",
        evidence: [{ source, summary: "filesystem mount identity is empty after normalization" }],
      };
    })
    .filter((finding): finding is ServerAuditFinding => finding !== undefined)
    .sort(compareFindings);

  if (candidates.length <= MAX_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_FINDINGS - 1);
  bounded.push({
    id: stableId(["filesystem-identity-coverage", "findings-truncated", String(MAX_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Filesystem identity coverage findings were truncated",
    summary: "The deterministic filesystem-identity coverage stage reached its finding limit, so additional supplied filesystem records may lack usable mount identities outside the emitted findings.",
    recommendation: "Review the bounded findings first, then narrow or split the read-only snapshot before treating filesystem identity coverage as complete.",
    evidence: [{ source: "filesystems", summary: `finding limit ${MAX_FINDINGS} reached` }],
  });
  return bounded.sort(compareFindings);
}
