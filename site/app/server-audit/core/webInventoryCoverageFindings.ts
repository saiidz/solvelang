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

function coverageFinding(
  key: string,
  title: string,
  summary: string,
  recommendation: string,
  source: string,
  evidenceSummary: string,
): ServerAuditFinding {
  return {
    id: stableId(["web-inventory-coverage", key]),
    severity: "info",
    category: "coverage",
    title,
    summary,
    recommendation,
    evidence: [{ source, summary: evidenceSummary }],
  };
}

export function createServerAuditWebInventoryCoverageFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const findings: ServerAuditFinding[] = [];
  const web = snapshot.web;
  if (!web) return findings;

  if (web.servers !== undefined && web.servers.length === 0) {
    findings.push(coverageFinding(
      "empty-servers",
      "No web-server records supplied",
      "The snapshot contains an explicit empty web-server inventory. The reviewed collector checks only a fixed set of local service names and treats unavailable or non-active service probes as no active record, so web-server posture cannot be treated as complete from this evidence alone.",
      "Re-collect the bounded web-server inventory and correlate it with local listener and process evidence before relying on web-server conclusions. Treat an empty inventory as unknown coverage rather than proof that the host runs no web server.",
      "web.servers",
      "0 web-server records",
    ));
  }

  if (web.roots !== undefined && web.roots.length === 0) {
    findings.push(coverageFinding(
      "empty-roots",
      "No web-root records supplied",
      "The snapshot contains an explicit empty web-root inventory. The reviewed collector searches only bounded conventional local root candidates and can produce no records when candidates are absent or unavailable, so web-root posture cannot be treated as complete from this evidence alone.",
      "Re-collect the bounded web-root inventory before relying on root-permission, framework-hint, or public-file conclusions. Treat an empty inventory as unknown coverage rather than proof that the host has no web roots.",
      "web.roots",
      "0 web-root records",
    ));
  }

  if (web.certificates !== undefined && web.certificates.length === 0) {
    findings.push(coverageFinding(
      "empty-certificates",
      "No TLS certificate records supplied",
      "The snapshot contains an explicit empty TLS certificate inventory. The reviewed collector inspects only bounded local certificate evidence and can produce no records when that evidence is absent or unavailable, so TLS inventory posture cannot be treated as complete from this evidence alone.",
      "Re-collect the bounded certificate inventory before relying on TLS expiry conclusions. A separately approved endpoint check is still required to determine which certificate, if any, is actively served.",
      "web.certificates",
      "0 TLS certificate records",
    ));
  }

  return findings;
}
