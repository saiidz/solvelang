import type { RepositoryArchiveExtractionResult } from "./archiveExtraction";
import type { RepositoryAuditAnalysisResult } from "./analysisPipeline";
import {
  createRepositoryAuditEvidenceCompleteness,
  type RepositoryAuditEvidenceCompleteness,
} from "./evidenceCompleteness";
import type { RepositoryInventoryAnalysis, RepositorySeverity } from "./inventory";
import type { RepositoryIngestionResult } from "./ingestion";
import type { RepositorySecretWarning } from "./secretScan";

export type RepositoryAuditProductSecretWarning = Omit<RepositorySecretWarning, "fingerprint">;

export type RepositoryAuditProductIntelligence = {
  schema: "solvelang.repository-audit.product-intelligence.v0";
  graph: RepositoryAuditAnalysisResult["graph"]["intelligence"];
  evidenceCompleteness: RepositoryAuditEvidenceCompleteness;
  securityWarnings: RepositoryAuditProductSecretWarning[];
  execution: RepositoryAuditAnalysisResult["execution"];
};

export type RepositoryAuditProductReport = {
  schema: "solvelang.repository-audit.product-report.v0";
  generatedAt: string;
  archive: {
    name: string;
    format: RepositoryArchiveExtractionResult["format"] | "sample";
    archiveBytes: number;
    extractedEntries: number;
  };
  ingestion: RepositoryIngestionResult["ingestion"];
  analysis: RepositoryInventoryAnalysis;
  intelligence?: RepositoryAuditProductIntelligence;
};

const severityRank: Record<RepositorySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeText(value: unknown): string {
  return escapeHtml(String(value ?? ""));
}

function bytesLabel(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function severityCounts(report: RepositoryAuditProductReport): Record<RepositorySeverity, number> {
  const counts: Record<RepositorySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of report.analysis.findings) counts[finding.severity] += 1;
  return counts;
}

function technologyNames(report: RepositoryAuditProductReport): string[] {
  return [
    ...report.analysis.inventory.languages.map(({ name }) => name),
    ...report.analysis.inventory.frameworks.map(({ name, version }) => version ? `${name} ${version}` : name),
    ...report.analysis.inventory.packageManagers.map(({ name }) => name),
    ...report.analysis.inventory.deploymentTargets.map(({ name }) => name),
  ].filter((value, index, values) => values.indexOf(value) === index).sort();
}

function sameAnalysisSource(inventory: RepositoryInventoryAnalysis, intelligence: RepositoryAuditAnalysisResult): boolean {
  return inventory.source.kind === intelligence.source.kind
    && inventory.source.displayName === intelligence.source.displayName
    && inventory.source.revision === intelligence.source.revision
    && inventory.source.fingerprint === intelligence.source.fingerprint;
}

function productIntelligence(analysis: RepositoryAuditAnalysisResult): RepositoryAuditProductIntelligence {
  const graph = analysis.graph.intelligence;
  return {
    schema: "solvelang.repository-audit.product-intelligence.v0",
    graph: {
      ...graph,
      source: { ...graph.source },
      counts: {
        ...graph.counts,
        nodesByKind: graph.counts.nodesByKind.map((item) => ({ ...item })),
        edgesByKind: graph.counts.edgesByKind.map((item) => ({ ...item })),
      },
      hotspots: graph.hotspots.map((item) => ({ ...item })),
      execution: { ...graph.execution },
    },
    evidenceCompleteness: createRepositoryAuditEvidenceCompleteness(analysis),
    // Product reports deliberately omit the keyed HMAC fingerprint. The warning ID,
    // path, line, class, exposure, and remediation are sufficient for review while
    // avoiding a portable credential-correlation token in exported artifacts.
    securityWarnings: analysis.secretWarnings.map(({ fingerprint: _fingerprint, ...warning }) => ({ ...warning })),
    execution: {
      ...analysis.execution,
      inventoryTruncationReasons: [...analysis.execution.inventoryTruncationReasons],
      graphTruncationReasons: [...analysis.execution.graphTruncationReasons],
    },
  };
}

export function createRepositoryAuditProductReport(input: {
  archiveName: string;
  extraction?: RepositoryArchiveExtractionResult;
  ingestion: RepositoryIngestionResult;
  analysis: RepositoryInventoryAnalysis;
  intelligence?: RepositoryAuditAnalysisResult;
  now?: Date;
}): RepositoryAuditProductReport {
  const archiveName = input.archiveName.trim().slice(0, 255) || "repository-archive";
  if (input.intelligence && !sameAnalysisSource(input.analysis, input.intelligence)) {
    throw new Error("Repository Audit product intelligence source does not match the inventory analysis.");
  }
  return {
    schema: "solvelang.repository-audit.product-report.v0",
    generatedAt: (input.now ?? new Date()).toISOString(),
    archive: {
      name: archiveName,
      format: input.extraction?.format ?? "sample",
      archiveBytes: input.extraction?.stats.archiveBytes ?? 0,
      extractedEntries: input.extraction?.stats.entries ?? input.ingestion.ingestion.entriesSeen,
    },
    ingestion: input.ingestion.ingestion,
    analysis: input.analysis,
    ...(input.intelligence ? { intelligence: productIntelligence(input.intelligence) } : {}),
  };
}

function evidenceCompletenessMarkup(report: RepositoryAuditProductReport): string {
  const evidence = report.intelligence?.evidenceCompleteness;
  if (!evidence) return "";
  const limitations = evidence.limitations.length
    ? `<ul>${evidence.limitations.map((item) => `<li><strong>${safeText(item.scope)}</strong> · <code>${safeText(item.reason)}</code> — ${safeText(item.message)}</li>`).join("")}</ul>`
    : '<div class="empty">No bounded scan limit truncated the collected inventory or graph evidence.</div>';
  return `
<section class="section"><h2>Evidence completeness</h2><p>Status: <strong>${safeText(evidence.status)}</strong>. Inventory: ${safeText(evidence.inventory.filesScanned)} of ${safeText(evidence.inventory.filesSeen)} file(s) scanned, ${safeText(bytesLabel(evidence.inventory.bytesScanned))}. Graph: ${safeText(evidence.graph.fileNodes)} file nodes, ${safeText(evidence.graph.nodes)} total nodes, ${safeText(evidence.graph.edges)} edges. Credential-pattern analysis covered ${safeText(evidence.secretAnalysis.filesScanned)} graph-accepted file(s).</p>${limitations}</section>`;
}

function intelligenceMarkup(report: RepositoryAuditProductReport): string {
  if (!report.intelligence) return "";
  const graph = report.intelligence.graph;
  const hotspotMarkup = graph.hotspots.length
    ? `<ol>${graph.hotspots.slice(0, 20).map((item) => `<li><code>${safeText(item.path ?? item.label)}</code> — ${safeText(item.transitiveImpact)} transitive dependents, ${safeText(item.directDependents)} direct dependents${item.impactTruncated ? " — bounded result truncated" : ""}</li>`).join("")}</ol>`
    : '<div class="empty">No dependency hotspots were identified inside the bounded graph.</div>';
  const warningMarkup = report.intelligence.securityWarnings.length
    ? `<ul>${report.intelligence.securityWarnings.map((warning) => `<li><code>${safeText(warning.path)}:${safeText(warning.lineStart)}</code> — ${safeText(warning.patternClass)} · ${safeText(warning.exposure)} — ${safeText(warning.remediation)}</li>`).join("")}</ul>`
    : '<div class="empty">No credential-pattern warnings were produced inside the bounded scan.</div>';
  return `
${evidenceCompletenessMarkup(report)}
<section class="section"><h2>Dependency intelligence</h2><p>${safeText(graph.counts.nodes)} graph nodes · ${safeText(graph.counts.edges)} graph edges · ${safeText(graph.hotspots.length)} ranked hotspots. Impact analysis is bounded to depth ${safeText(graph.execution.maxImpactDepth)} and ${safeText(graph.execution.maxImpactResults)} results per hotspot.</p>${hotspotMarkup}</section>
<section class="section"><h2>Redacted credential warnings</h2><p>${safeText(report.intelligence.securityWarnings.length)} warning(s). Secret values and HMAC correlation fingerprints are not included in this product report.</p>${warningMarkup}</section>`;
}

export function createRepositoryAuditHtmlReport(report: RepositoryAuditProductReport): string {
  const counts = severityCounts(report);
  const technologies = technologyNames(report);
  const findings = [...report.analysis.findings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || left.ruleId.localeCompare(right.ruleId)
    || left.id.localeCompare(right.id));
  const findingMarkup = findings.length === 0
    ? '<div class="empty">No deterministic inventory findings were produced for this snapshot.</div>'
    : findings.map((finding) => `
      <article class="finding ${safeText(finding.severity)}">
        <div class="finding-head"><span class="severity">${safeText(finding.severity)}</span><span class="rule">${safeText(finding.ruleId)}</span></div>
        <h3>${safeText(finding.title)}</h3>
        <p>${safeText(finding.explanation)}</p>
        <dl><div><dt>Recommendation</dt><dd>${safeText(finding.recommendation)}</dd></div><div><dt>Confidence</dt><dd>${safeText(finding.confidence.level)} (${safeText(finding.confidence.score)})</dd></div><div><dt>Impact</dt><dd>${safeText(finding.impact)}</dd></div></dl>
        <h4>Evidence</h4>
        <ul>${finding.evidence.map((item) => `<li><code>${safeText(item.path)}</code>${item.note ? ` — ${safeText(item.note)}` : ""}${item.byteSize === undefined ? "" : ` — ${safeText(bytesLabel(item.byteSize))}`}</li>`).join("")}</ul>
        ${finding.validation.length ? `<h4>Validation</h4><ul>${finding.validation.map((item) => `<li>${safeText(item)}</li>`).join("")}</ul>` : ""}
        ${finding.rollback.length ? `<h4>Rollback</h4><ul>${finding.rollback.map((item) => `<li>${safeText(item)}</li>`).join("")}</ul>` : ""}
        ${finding.approvalRequired ? '<p class="approval">Human approval required before any repository change.</p>' : ""}
      </article>`).join("");
  const richerAnalysis = report.intelligence
    ? "Bounded, read-only repository inventory, dependency intelligence, and redacted credential-pattern analysis."
    : "Deterministic, read-only repository inventory.";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeText(report.archive.name)} — SolveLang Repository Audit</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#f8fafc}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:0 auto;padding:48px 24px 80px}.hero{border-radius:28px;padding:36px;background:#081426;color:#fff}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:12px;font-weight:800;color:#93c5fd}h1{font-size:40px;line-height:1.1;margin:12px 0}.subtitle{color:#cbd5e1;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:22px}.metric{border:1px solid #e2e8f0;border-radius:18px;background:#fff;padding:20px}.metric strong{display:block;font-size:28px;margin-top:7px}.section{margin-top:28px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;padding:28px}.section li{line-height:1.65;color:#475569;margin-top:8px}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:7px 11px;font-size:13px;font-weight:700}.finding{border:1px solid #e2e8f0;border-radius:20px;padding:22px;margin-top:16px;background:#fff}.finding h3{margin:12px 0 8px}.finding p,.finding li,.finding dd{line-height:1.65;color:#475569}.finding-head{display:flex;gap:8px}.severity,.rule{border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;text-transform:uppercase}.severity{background:#0f172a;color:#fff}.rule{background:#e2e8f0}.finding.critical,.finding.high{border-color:#fecaca}.finding.medium{border-color:#fde68a}.approval{padding:12px;border-radius:12px;background:#fff7ed;color:#9a3412!important;font-weight:700}dl{display:grid;gap:8px}dl div{display:grid;grid-template-columns:140px 1fr;gap:12px}dt{font-weight:800}dd{margin:0}.empty{border:1px dashed #cbd5e1;border-radius:18px;padding:24px;color:#64748b}.footer{margin-top:30px;color:#64748b;font-size:13px;line-height:1.7}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}h1{font-size:32px}dl div{grid-template-columns:1fr}}@media print{body{background:#fff}.hero{break-inside:avoid}.finding{break-inside:avoid}main{padding:0}.section,.metric{box-shadow:none}}
</style></head><body><main>
<section class="hero"><div class="eyebrow">SolveLang Repository Audit</div><h1>${safeText(report.archive.name)}</h1><p class="subtitle">${safeText(richerAnalysis)} No archive content was executed. Generated ${safeText(report.generatedAt)}.</p></section>
<section class="grid"><div class="metric">Files scanned<strong>${safeText(report.analysis.summary.filesScanned)}</strong></div><div class="metric">Bytes scanned<strong>${safeText(bytesLabel(report.analysis.summary.bytesScanned))}</strong></div><div class="metric">Findings<strong>${safeText(report.analysis.findings.length)}</strong></div><div class="metric">Status<strong>${safeText(report.intelligence?.execution.status ?? report.analysis.execution.status)}</strong></div></section>
<section class="section"><h2>Severity summary</h2><p>${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${counts.low} low · ${counts.info} informational</p></section>
<section class="section"><h2>Detected technology</h2><div class="chips">${technologies.length ? technologies.map((item) => `<span class="chip">${safeText(item)}</span>`).join("") : '<span class="chip">No recognized technology markers</span>'}</div></section>
${intelligenceMarkup(report)}
<section class="section"><h2>Findings</h2>${findingMarkup}</section>
<section class="section"><h2>Scan boundary</h2><p>Mode: <strong>Analyze only</strong>. Network access during analysis: ${safeText(report.intelligence?.execution.networkAccess ?? report.analysis.execution.networkAccess)}. Repository write access: ${safeText(report.intelligence?.execution.writeAccess ?? report.analysis.execution.writeAccess)}. Archive entries: ${safeText(report.archive.extractedEntries)}. Source fingerprint: <code>${safeText(report.analysis.source.fingerprint)}</code>.</p></section>
<p class="footer">SolveLang findings are evidence for human review, not authorization to delete, move, merge, or rewrite repository content. Destructive recommendations require a dedicated branch, validation, rollback planning, and explicit approval.</p>
</main></body></html>`;
}

export function repositoryAuditSafeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").replace(/\.(zip|tar|tgz|gz)$/i, "").slice(0, 80) || "repository";
}
