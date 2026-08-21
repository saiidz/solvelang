import type { ServerAuditFinding, ServerAuditReport, ServerAuditSeverity, ServerAuditSnapshot } from "./types";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditArtifactFindings } from "./artifactFindings";
import { createServerAuditBackupCoverageFindings } from "./backupCoverageFindings";
import { createServerAuditBackupLogConsistencyFindings } from "./backupLogConsistencyFindings";
import { createServerAuditBackupPostureFindings } from "./backupPostureFindings";
import { createServerAuditCertificateConsistencyFindings } from "./certificateConsistencyFindings";
import { createServerAuditCertificateCoverageFindings } from "./certificateCoverageFindings";
import { createServerAuditCertificateIdentityCoverageFindings } from "./certificateIdentityCoverageFindings";
import { createServerAuditCertificateExpiryFallbackFindings } from "./certificateExpiryFindings";
import { createServerAuditCoverageFindings } from "./coverageFindings";
import { createServerAuditFilesystemArtifactRelationshipFindings } from "./filesystemArtifactRelationshipFindings";
import { createServerAuditFilesystemCapacityCoverageFindings } from "./filesystemCapacityCoverageFindings";
import { createServerAuditFilesystemCoverageFindings } from "./filesystemCoverageFindings";
import { createServerAuditFilesystemIdentityCoverageFindings } from "./filesystemIdentityCoverageFindings";
import { createServerAuditFilesystemUsageFindings } from "./filesystemUsageFindings";
import { createServerAuditInventoryFindings } from "./inventoryFindings";
import { createServerAuditLargeLogFindings } from "./largeLogFindings";
import { createServerAuditListenerCoverageFindings } from "./listenerCoverageFindings";
import { createServerAuditListenerConsistencyFindings } from "./listenerConsistencyFindings";
import { createServerAuditListenerIdentityCoverageFindings } from "./listenerIdentityCoverageFindings";
import { createServerAuditLogCoverageFindings } from "./logCoverageFindings";
import { createServerAuditStaleLogFindings } from "./staleLogFindings";
import { createServerAuditPackageIdentityCoverageFindings } from "./packageIdentityCoverageFindings";
import { createServerAuditPackageVersionFindings } from "./packageVersionFindings";
import { createServerAuditProcessCoverageFindings } from "./processCoverageFindings";
import { createServerAuditProcessFindings } from "./processFindings";
import { createServerAuditProcessIdentityCoverageFindings } from "./processIdentityCoverageFindings";
import { createServerAuditPublicFileCoverageFindings } from "./publicFileCoverageFindings";
import { createServerAuditPublicFileFindings } from "./publicFileFindings";
import { createServerAuditScheduledJobCoverageFindings } from "./scheduledJobCoverageFindings";
import { createServerAuditScheduledJobIdentityCoverageFindings } from "./scheduledJobIdentityCoverageFindings";
import { createServerAuditScheduledJobRelationshipFindings } from "./scheduledJobRelationshipFindings";
import { createServerAuditServiceCoverageFindings } from "./serviceCoverageFindings";
import { createServerAuditServiceIdentityCoverageFindings } from "./serviceIdentityCoverageFindings";
import { createServerAuditServiceListenerRelationshipFindings } from "./serviceListenerRelationshipFindings";
import { createServerAuditServiceProcessRelationshipFindings } from "./serviceProcessRelationshipFindings";
import { createServerAuditSystemMetricsCoverageFindings } from "./systemMetricsCoverageFindings";
import { createServerAuditTemporalFindings } from "./temporalFindings";
import { createServerAuditTlsListenerFindings } from "./tlsListenerFindings";
import { createServerAuditWebIdentityCoverageFindings } from "./webIdentityCoverageFindings";
import { createServerAuditWebInventoryCoverageFindings } from "./webInventoryCoverageFindings";
import { createServerAuditWebRootPermissionCoverageFindings } from "./webRootPermissionCoverageFindings";
import { createServerAuditWebRootPermissionFindings } from "./webRootPermissionFindings";
import { createServerAuditWebListenerFindings } from "./webListenerFindings";
import { createServerAuditWebServerRelationshipFindings } from "./webServerRelationshipFindings";

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

const LEGACY_FILESYSTEM_USAGE_TITLES = new Set([
  "Filesystem critically full",
  "Filesystem nearly full",
  "Filesystem usage elevated",
]);

const LEGACY_LARGE_LOG_TITLES = new Set([
  "Very large log file",
]);

const LEGACY_BACKUP_POSTURE_TITLES = new Set([
  "Newest backup is older than 72 hours",
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
  return analyzeServerSnapshot(snapshot).filter(
    (finding) =>
      !LEGACY_WEB_ROOT_PERMISSION_TITLES.has(finding.title)
      && !LEGACY_FILESYSTEM_USAGE_TITLES.has(finding.title)
      && !LEGACY_LARGE_LOG_TITLES.has(finding.title)
      && !LEGACY_BACKUP_POSTURE_TITLES.has(finding.title),
  );
}

function findingEvidenceIdentity(finding: ServerAuditFinding): string {
  return [
    finding.category,
    finding.title,
    ...finding.evidence.map((item) => item.source).sort(),
  ].join("\u001f");
}

function createArtifactConsistencyFindings(snapshot: ServerAuditSnapshot): ServerAuditFinding[] {
  const preferred = createServerAuditBackupLogConsistencyFindings(snapshot);
  const preferredIdentities = new Set(preferred.map(findingEvidenceIdentity));
  const legacy = createServerAuditArtifactFindings(snapshot).filter(
    (finding) => !preferredIdentities.has(findingEvidenceIdentity(finding)),
  );
  return [...preferred, ...legacy];
}

export function createServerAuditReport(snapshot: ServerAuditSnapshot, generatedAt = new Date().toISOString()): ServerAuditReport {
  const findings = sortFindings([
    ...createBaselineFindings(snapshot),
    ...createArtifactConsistencyFindings(snapshot),
    ...createServerAuditBackupCoverageFindings(snapshot),
    ...createServerAuditBackupPostureFindings(snapshot),
    ...createServerAuditTemporalFindings(snapshot),
    ...createServerAuditInventoryFindings(snapshot),
    ...createServerAuditSystemMetricsCoverageFindings(snapshot),
    ...createServerAuditFilesystemCoverageFindings(snapshot),
    ...createServerAuditFilesystemCapacityCoverageFindings(snapshot),
    ...createServerAuditFilesystemIdentityCoverageFindings(snapshot),
    ...createServerAuditFilesystemUsageFindings(snapshot),
    ...createServerAuditProcessCoverageFindings(snapshot),
    ...createServerAuditProcessIdentityCoverageFindings(snapshot),
    ...createServerAuditProcessFindings(snapshot),
    ...createServerAuditServiceCoverageFindings(snapshot),
    ...createServerAuditServiceIdentityCoverageFindings(snapshot),
    ...createServerAuditScheduledJobCoverageFindings(snapshot),
    ...createServerAuditScheduledJobIdentityCoverageFindings(snapshot),
    ...createServerAuditScheduledJobRelationshipFindings(snapshot),
    ...createServerAuditListenerCoverageFindings(snapshot),
    ...createServerAuditListenerIdentityCoverageFindings(snapshot),
    ...createServerAuditListenerConsistencyFindings(snapshot),
    ...createServerAuditTlsListenerFindings(snapshot),
    ...createServerAuditServiceListenerRelationshipFindings(snapshot),
    ...createServerAuditServiceProcessRelationshipFindings(snapshot),
    ...createServerAuditPackageIdentityCoverageFindings(snapshot),
    ...createServerAuditPackageVersionFindings(snapshot),
    ...createServerAuditLogCoverageFindings(snapshot),
    ...createServerAuditLargeLogFindings(snapshot),
    ...createServerAuditStaleLogFindings(snapshot),
    ...createServerAuditPublicFileFindings(snapshot),
    ...createServerAuditPublicFileCoverageFindings(snapshot),
    ...createServerAuditCertificateConsistencyFindings(snapshot),
    ...createServerAuditCertificateCoverageFindings(snapshot),
    ...createServerAuditCertificateIdentityCoverageFindings(snapshot),
    ...createServerAuditCertificateExpiryFallbackFindings(snapshot),
    ...createServerAuditWebIdentityCoverageFindings(snapshot),
    ...createServerAuditWebInventoryCoverageFindings(snapshot),
    ...createServerAuditWebRootPermissionCoverageFindings(snapshot),
    ...createServerAuditWebRootPermissionFindings(snapshot),
    ...createServerAuditWebListenerFindings(snapshot),
    ...createServerAuditWebServerRelationshipFindings(snapshot),
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
      "System-telemetry coverage findings report only supplied system sections that omit reviewed uptime, load, or memory metrics; they do not prove host health, collector completeness, authoritative telemetry, or absence of resource pressure.",
      "Timestamp-integrity findings are based only on the supplied snapshot collection time and bounded consistency checks; they do not prove host clock correctness.",
      "Inventory-consistency findings identify only contradictions inside the supplied snapshot; they do not determine which duplicate value is authoritative.",
      "Backup/log consistency findings identify only contradictory duplicate artifact evidence; collection-time churn can explain some log differences and the stage does not determine which value is authoritative.",
      "Backup-coverage findings report only supplied backup records that lack ageHours or sizeBytes evidence; they do not prove backup failure, freshness, artifact completeness, restoreability, or complete backup discovery.",
      "Backup-posture findings use only supplied age and size evidence against a bounded review threshold; they do not prove backup success, restoreability, retention quality, or off-host/offsite protection.",
      "Log-coverage findings report only explicit empty log inventories or supplied log records that lack modifiedAt or sizeBytes evidence; they do not prove logging failure, activity, retention, completeness, or collector authority.",
      "Stale-log candidates compare only supplied log modification times to the supplied snapshot time; they do not prove log rotation failure, service health, workload activity, or complete log coverage.",
      "Filesystem-coverage findings report only an explicit empty filesystem inventory; because the reviewed collector maps failed/unavailable fixed `df -P -B1` execution or empty usable output to an empty array, they do not prove that the host has no mounted filesystems or that filesystem collection was complete or authoritative.",
      "Filesystem-capacity coverage findings report only supplied filesystem records that omit usagePercent; they do not prove filesystem health, collector completeness, authoritative disk utilization, or absence of capacity pressure.",
      "Filesystem-usage findings compare only supplied usagePercent values against bounded 80/90/95 percent review thresholds; they do not prove filesystem identity, growth cause, future exhaustion, or collector authority.",
      "Filesystem-identity coverage findings report only supplied filesystem records whose mount identity is empty after trim and NFC normalization; they do not prove filesystem absence, mount authority, collector completeness, or the correctness of capacity and filesystem-artifact relationship attribution.",
      "Filesystem-artifact relationship findings use lexical absolute POSIX path evidence only; ambiguous, invalid, unresolved, or truncated mappings are completeness/integrity signals and do not identify an authoritative filesystem.",
      "Process relationship findings are point-in-time evidence; process churn, visibility limits, or bounded collection may explain missing parents or listener-name mismatches, and a single zombie observation does not prove persistence.",
      "Process-coverage findings report only an explicit empty process inventory; because the reviewed collector maps failed/unavailable fixed `ps` execution or empty usable output to an empty array, they do not prove that the host has no processes or that process collection was complete or authoritative.",
      "Process-identity coverage findings report only supplied process records whose executable identity is empty after trim and NFC normalization; they do not prove process absence, process ownership, runtime health, or collector authority.",
      "Service-coverage findings report only an explicit empty service inventory; they do not prove service discovery completeness, boot enablement, runtime health, or collector authority.",
      "Service-identity coverage findings report only supplied service records whose identity is empty after trim and NFC normalization; they do not prove service absence, service ownership, runtime health, or collector authority.",
      "Scheduled-job coverage findings report only an explicit empty scheduled-job inventory; because the reviewed collector scans a fixed set of cron directories and missing, unreadable, or empty directories can all yield no records, they do not prove that the host has no scheduled jobs or that scheduled-job collection was complete or authoritative.",
      "Scheduled-job identity coverage findings report only supplied scheduled-job records whose source or command-summary identity is empty after trim and NFC normalization; they do not prove job absence, provenance authority, command validity, runtime execution, or collector completeness.",
      "Scheduled-job relationship findings use only bounded exact-name-token matches over supplied sanitized command summaries and service/process names; multi-target, unresolved, oversized, or truncated results are completeness/integrity signals and do not prove command execution, ownership, job validity, runtime health, or collector authority.",
      "Listener-coverage findings report only an explicit empty listening-socket inventory; because the reviewed collector maps both empty `ss` output and command failure/unavailability to an empty array, they do not prove that the host has no listeners or that socket collection was complete or authoritative.",
      "Listener-identity coverage findings report only supplied listening-socket records whose protocol or local-address identity is empty after trim and NFC normalization; they do not prove listener absence, endpoint ownership, public reachability, runtime health, or collector authority.",
      "Listener-consistency findings identify only duplicate supplied endpoints whose process attribution conflicts; collection timing, visibility limits, duplicate rows, or process churn can explain the contradiction, and the stage does not determine authoritative ownership or reachability.",
      "TLS-listener consistency findings compare only supplied local TLS certificate inventory with collected TCP port-443 listener evidence; mismatches are completeness/integrity signals and do not prove endpoint reachability, TLS termination location, certificate serving state, or ownership.",
      "Service-listener relationship findings use only conservative exact static-label matches across supplied service, process, and listener records; ambiguous, unresolved, skipped, or truncated mappings are completeness/integrity signals and do not prove service ownership, exposure, runtime health, or collector authority.",
      "Service-process relationship findings use only conservative exact static-label matches across supplied service and process records; grouped, unmatched, skipped, or truncated mappings are completeness/integrity signals and do not prove service ownership, process identity, runtime health, or collector authority.",
      "Package-identity coverage findings report only supplied package records whose identity is empty after trim and NFC normalization; they do not prove package absence, package discovery completeness, collector authority, or vulnerability status.",
      "Package-version evidence findings report explicit empty inventories plus missing or non-specific supplied versions; they do not prove package discovery completeness, collector authority, or vulnerability status.",
      "Public-file marker findings prove only local marker presence under a candidate web root; they do not prove that a file is reachable over HTTP or disclose its contents.",
      "Public-file reference-integrity findings report only that supplied marker evidence cannot be linked to an available web-root record; they do not establish marker presence or exposure.",
      "Public-file coverage findings compare only the fixed reviewed marker checks for available candidate web roots; missing or contradictory marker evidence is a completeness/integrity signal and does not prove exposure or safety.",
      "Certificate-consistency findings identify contradictory duplicate certificate evidence only; they do not choose an active certificate or prove endpoint reachability.",
      "Certificate-coverage findings report only supplied certificate records that lack both notAfter and daysRemaining evidence; they do not prove endpoint absence, certificate invalidity, collector authority, or which certificate is actively served.",
      "Certificate-identity coverage findings report only supplied certificate records whose identity is empty after trim and NFC normalization; they do not identify the actively served certificate, prove endpoint reachability, or establish collector authority.",
      "Certificate-expiry fallback findings derive an alert window only from a supplied notAfter timestamp when daysRemaining is absent; they do not identify the actively served certificate or perform endpoint validation.",
      "Web-identity coverage findings report only supplied web-server labels or web-root paths that are empty after trim and NFC normalization; they do not prove service absence, root absence, public reachability, or collector authority.",
      "Web-inventory coverage findings report only explicit empty web-server, web-root, or TLS-certificate inventories from the fixed local probes; they do not prove those surfaces are absent, that discovery was complete or authoritative, or that any endpoint is publicly reachable.",
      "Web-listener consistency findings compare only supplied local web-server and TCP listener evidence; they do not identify application ownership, prove public reachability, or perform network scanning.",
      "Web-server relationship findings compare only recognized static web-server labels with supplied service and package inventory evidence; missing or contradictory matches are completeness/integrity signals and do not prove installation source, service ownership, runtime health, public reachability, or collector authority.",
      "Web-root ownership/permission coverage findings report only supplied candidate web-root records that omit usable owner or mode evidence; they do not prove root absence, ownership correctness, permission safety, collector completeness, filesystem reachability, or public exposure.",
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
