import type { ServerAuditFinding, ServerAuditSnapshot } from "./types";

const CORE_SECURITY_FIELDS = [
  "firewall",
  "automaticUpdates",
  "rootSshLogin",
  "passwordSshLogin",
] as const;

function stableId(parts: string[]): string {
  const input = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `srv_${hash.toString(16).padStart(8, "0")}`;
}

export function createServerAuditSecurityCoverageFindings(
  snapshot: ServerAuditSnapshot,
): ServerAuditFinding[] {
  if (snapshot.security === undefined) return [];

  const missing = CORE_SECURITY_FIELDS.filter((field) => snapshot.security?.[field] === undefined);
  if (missing.length === 0) return [];

  const evidence = missing.map((field) => ({
    source: `security.${field}`,
    summary: "field absent",
  }));

  return [{
    id: stableId(["security-coverage", ...evidence.map((item) => item.source)]),
    severity: "info",
    category: "coverage",
    title: "Core security posture fields are incomplete",
    summary: `${missing.length} core read-only security posture field(s) were not supplied, so the corresponding firewall, patching, or SSH conclusion must remain unknown.`,
    recommendation: "Re-collect the missing core security posture fields with the reviewed read-only collector before treating absence of related findings as evidence of a hardened host.",
    evidence,
  }];
}
