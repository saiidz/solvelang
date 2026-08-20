import type { ServerAuditFinding, ServerAuditPublicFileMarker, ServerAuditSnapshot } from "./types";

const MAX_PUBLIC_FILE_FINDINGS = 100;

const TITLES: Record<ServerAuditPublicFileMarker, string> = {
  "env-file": "Environment-file marker exists under a candidate web root",
  "git-config": "Git metadata marker exists under a candidate web root",
  "npmrc": "npm configuration marker exists under a candidate web root",
  "composer-auth": "Composer authentication marker exists under a candidate web root",
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

function hasValidRootReference(rootIndex: number, rootCount: number): boolean {
  return Number.isInteger(rootIndex) && rootIndex >= 0 && rootIndex < rootCount;
}

export function createServerAuditPublicFileFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const roots = snapshot.web?.roots ?? [];
  const indexedChecks = (snapshot.web?.publicFileChecks ?? []).map((check, index) => ({ check, index }));

  const presentFindings = indexedChecks
    .filter(({ check }) => check.present && hasValidRootReference(check.rootIndex, roots.length))
    .map(({ check, index }): ServerAuditFinding => {
      const sources = [`web.publicFileChecks[${index}]`, `web.roots[${check.rootIndex}]`];
      return {
        id: stableId(["public-file-marker", check.marker, ...sources]),
        severity: "medium",
        category: "web-exposure",
        title: TITLES[check.marker],
        summary: "A fixed sensitive-file marker exists under a candidate web root. Local presence does not prove the file is reachable over HTTP, but the serving boundary should be verified before treating it as private.",
        recommendation: "Confirm the effective web-server document root and deny rules. If this marker can be served, move it outside the public root or block access without exposing the file contents during review.",
        evidence: sources.map((source) => ({ source, summary: check.marker })),
      };
    });

  const invalidReferenceFindings = indexedChecks
    .filter(({ check }) => !hasValidRootReference(check.rootIndex, roots.length))
    .map(({ index }): ServerAuditFinding => {
      const source = `web.publicFileChecks[${index}].rootIndex`;
      return {
        id: stableId(["public-file-marker", "invalid-root-reference", source]),
        severity: "info",
        category: "evidence-integrity",
        title: "Public-file marker check references an unavailable web root",
        summary: "A supplied public-file marker check does not reference a web root present in the same snapshot, so the audit will not infer file exposure from that check.",
        recommendation: "Re-collect the bounded web-root and public-file evidence with the reviewed collector before drawing a public-file exposure conclusion.",
        evidence: [{ source, summary: "root reference is outside the supplied web.roots evidence" }],
      };
    });

  const candidates = [...presentFindings, ...invalidReferenceFindings];
  if (candidates.length === 0) return [];
  if (candidates.length <= MAX_PUBLIC_FILE_FINDINGS) return candidates;

  const bounded = candidates.slice(0, MAX_PUBLIC_FILE_FINDINGS - 1);
  bounded.push({
    id: stableId(["public-file-marker", "truncated", String(candidates.length), String(MAX_PUBLIC_FILE_FINDINGS)]),
    severity: "info",
    category: "coverage",
    title: "Public-file marker findings were truncated",
    summary: `${candidates.length - (MAX_PUBLIC_FILE_FINDINGS - 1)} additional marker/reference finding(s) were omitted by the deterministic finding limit.`,
    recommendation: "Review the emitted findings first, then narrow the snapshot if per-root evidence is needed; do not treat the truncated report as complete.",
    evidence: [{ source: "web.publicFileChecks", summary: `finding limit ${MAX_PUBLIC_FILE_FINDINGS} reached` }],
  });
  return bounded;
}
