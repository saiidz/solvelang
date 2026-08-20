import type { ServerAuditFinding, ServerAuditReport, ServerAuditSeverity, ServerAuditSnapshot } from "./types";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditArtifactFindings } from "./artifactFindings";
import { createServerAuditCertificateConsistencyFindings } from "./certificateConsistencyFindings";
import { createServerAuditCoverageFindings } from "./coverageFindings";
import { createServerAuditFilesystemArtifactRelationshipFindings } from "./filesystemArtifactRelationshipFindings";
import { createServerAuditInventoryFindings } from "./inventoryFindings";
import { createServerAuditProcessFindings } from "./processFindings";
import { createServerAuditPublicFileFindings } from "./publicFileFindings";
import { createServerAuditTemporalFindings } from "./temporalFindings";
import { createServerAuditWebRootPermissionFindings } from "./webRootPermissionFindings";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const SEVERITY_ORDER: Record<ServerAuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const LEGACY_WEB_ROOT_PERMISSION_TITLES = new Set([
  "Web root is world-writable",
  "Web root is group-writable",
  "Application web root owned by root",
]);

function stableHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function count(findings: ServerAuditFinding[], severity: ServerAuditFinding["severity"]) {
  return findings.filter((finding) => finding.severity === severity).length;
}

function score(findings: ServerAuditFinding[]) {
  const weights: Record<ServerAuditFinding["severity"], number> = { critical: 25, high: 12, medium: 6, low: 2, info: 0 };
  const penalty = findings.reduce((total, finding) => total + weights[finding.severity], 0);
  return Math.max(0, 100 - penalty);
}

function sortFindings(findings: ServerAuditFinding[]): ServerAuditFinding[] {
  return [...findings].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.category.localeCompare(right.category)
      || left.id.localeCompare(right.id),
  );
}

function createBaselineFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  return analyzeServerSnapshot(snapshot).filter((finding) => !LEGACY_WEB_ROOT_PERMISSION_TITLES.has(finding.title));
}

export function createServerAuditReport(snapshot: ServerAuditSnapshot, generatedAt = new Date().toISOString()): ServerAuditReport {
  const findings = sortFindings([
    ...createBaselineFindings(snapshot),
    ...createServerAuditTemporalFindings(snapshot),
    ...createServerAuditInventoryFindings(snapshot),
    ...createServerAuditArtifactFindings(snapshot),
    ...createServerAuditProcessFindings(snapshot),
    ...createServerAuditPublicFileFindings(snapshot),
    ...createServerAuditCertificateConsistencyFindings(snapshot),
    ...createServerAuditWebRootPermissionFindings(snapshot),
    ...createServerAuditFilesystemArtifactRelationshipFindings(snapshot),
    ...createServerAuditCoverageFindings(snapshot),
  ]);
  const canonical = JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    collectedAt: snapshot.collectedAt,
    hostname: snapshot.host.hostname,
    findings: findings.map((finding) => finding.id),
  });
  return {
    schemaVersion: "1",
    reportId: `server-audit-${stableHash(canonical)}`,
    snapshotCollectedAt: snapshot.collectedAt,
    generatedAt,
    host: snapshot.host,
    summary: {
      critical: count(findings, "critical"),
      high: count(findings, "high"),
      medium: count(findings, "medium"),
      low: count(findings, "low"),
      info: count(findings, "info"),
      score: score(findings),
    },
    findings,
    limitations: [
      "This report analyzes only the supplied read-only snapshot; absence of evidence is not proof of secure configuration.",
      "Coverage-gap findings report structurally absent snapshot sections only; a present section does not prove that collection was complete or authoritative.",
      "Timestamp-integrity findings are based only on the supplied snapshot collection time and bounded consistency checks; they do not prove host clock correctness.",
      "Inventory-consistency findings identify only contradictions inside the supplied snapshot; they do not determine which duplicate value is authoritative.",
      "Backup/log consistency findings identify only contradictory duplicate artifact evidence; collection-time churn can explain some log differences and the stage does not determine which value is authoritative.",
      "Filesystem-artifact relationship findings use lexical absolute POSIX path evidence only; ambiguous, invalid, unresolved, or truncated mappings are completeness/integrity signals and do not identify an authoritative filesystem.",
      "Process relationship findings are point-in-time evidence; process churn, visibility limits, or bounded collection may explain missing parents or listener-name mismatches, and a single zombie observation does not prove persistence.",
      "Public-file marker findings prove only local marker presence under a candidate web root; they do not prove that a file is reachable over HTTP or disclose its contents.",
      "Certificate-consistency findings identify contradictory duplicate certificate evidence only; they do not choose an active certificate or prove endpoint reachability.",
      "Web-root permission findings emit structural snapshot references instead of raw root paths or owner values; group-writable and privileged-owner states are review candidates rather than proof of exploitable exposure.",
      "No package or CVE database lookup is performed in v0, so version strings are inventory evidence rather than vulnerability determinations.",
      "No remediation command is executed or generated for automatic execution.",
      "Restore testing, external firewall rules, cloud IAM, database contents, application secrets, and customer data are outside the v0 snapshot contract unless represented by safe summary evidence.",
    ],
  };
}

export function serverAuditReportJson(report: ServerAuditReport) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function serverAuditReportHtml(report: ServerAuditReport) {
  const findings = report.findings.map((finding) => `<article class="finding"><h3>${escapeHtml(finding.title)}</h3><p><strong>${finding.severity.toUpperCase()}</strong> · ${escapeHtml(finding.category)}</p><p>${escapeHtml(finding.summary)}</p><p><b>Recommendation:</b> ${escapeHtml(finding.recommendation)}</p><ul>${finding.evidence.map((evidence) => `<li><code>${escapeHtml(evidence.source)}</code>: ${escapeHtml(evidence.summary)}</li>`).join("")}</ul></article>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Server Audit ${escapeHtml(report.host.hostname)}</title><style>body{font:15px system-ui;max-width:1050px;margin:40px auto;padding:0 20px;color:#17202a}code{background:#f3f4f6;padding:2px 4px}.summary{display:flex;gap:12px;flex-wrap:wrap}.metric,.finding{border:1px solid #d9dde3;border-radius:10px;padding:14px;margin:12px 0}.metric{min-width:120px}</style></head><body><h1>Server Audit</h1><p>${escapeHtml(report.host.hostname)} · snapshot ${escapeHtml(report.snapshotCollectedAt)}</p><div class="summary"><div class="metric"><b>Score</b><div>${report.summary.score}/100</div></div><div class="metric"><b>Critical</b><div>${report.summary.critical}</div></div><div class="metric"><b>High</b><div>${report.summary.high}</div></div><div class="metric"><b>Medium</b><div>${report.summary.medium}</div></div></div><h2>Findings</h2>${findings || "<p>No deterministic findings were produced from the supplied evidence.</p>"}<h2>Limitations</h2><ul>${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></body></html>`;
}
