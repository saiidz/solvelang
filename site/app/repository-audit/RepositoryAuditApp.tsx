"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { createSolveGraphQueryIndex, type SolveGraphQueryIndex } from "../solve-graph/core/query-impact";
import { RepositoryAuditAngularTargetConfigPanel } from "./RepositoryAuditAngularTargetConfigPanel";
import { RepositoryAuditDeploymentPathPanel } from "./RepositoryAuditDeploymentPathPanel";
import { RepositoryAuditDockerComposePanel } from "./RepositoryAuditDockerComposePanel";
import { RepositoryAuditDockerComposeRelationshipPanel } from "./RepositoryAuditDockerComposeRelationshipPanel";
import { RepositoryAuditFrameworkPathPanel } from "./RepositoryAuditFrameworkPathPanel";
import { RepositoryAuditVisualExplorerPanel } from "./RepositoryAuditVisualExplorerPanel";
import { analyzeRepositorySnapshot, type RepositoryAuditAnalysisResult } from "./core/analysisPipeline";
import { createRepositoryAngularTargetConfigEvidenceDownload, type RepositoryAngularTargetConfigEvidenceDownload } from "./core/angularTargetConfigArtifact";
import { createRepositoryArchitecturePathEvidenceDownload, type RepositoryArchitecturePathEvidenceDownload } from "./core/architecturePathArtifact";
import { extractRepositoryArchive, type RepositoryArchiveExtractionResult } from "./core/archiveExtraction";
import { createRepositoryAuditBrowserIntelligence, type RepositoryAuditBrowserIntelligence } from "./core/browserIntelligence";
import { createCanonicalRepositoryAuditArtifact, type CanonicalRepositoryAuditArtifact } from "./core/canonicalArtifact";
import { createRepositoryDeploymentPathEvidenceDownload, type RepositoryDeploymentPathEvidenceDownload } from "./core/deploymentPathArtifact";
import { createDockerComposeRelationshipSnapshotDownload, type DockerComposeRelationshipSnapshotDownload } from "./core/dockerComposeRelationshipSnapshotArtifact";
import { analyzeDockerComposeRelationshipSnapshot } from "./core/dockerComposeRelationshipSnapshotEvidence";
import { createDockerComposeSnapshotDownload, type DockerComposeSnapshotDownload } from "./core/dockerComposeSnapshotArtifact";
import { analyzeDockerComposeSnapshot } from "./core/dockerComposeSnapshotEvidence";
import { createRepositoryFrameworkPathEvidenceDownload, type RepositoryFrameworkPathEvidenceDownload } from "./core/frameworkPathArtifact";
import type { RepositoryInventoryAnalysis, RepositorySeverity } from "./core/inventory";
import { ingestArchiveSnapshotEntries, type RepositoryIngestionResult, type RepositorySnapshotEntry } from "./core/ingestion";
import { createRepositoryAuditHtmlReport, createRepositoryAuditProductReport, repositoryAuditSafeFilename, type RepositoryAuditProductReport } from "./core/report";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const encoder = new TextEncoder();

type ScanResult = {
  extraction?: RepositoryArchiveExtractionResult;
  ingestion: RepositoryIngestionResult;
  analysis: RepositoryInventoryAnalysis;
  intelligence: RepositoryAuditAnalysisResult;
  report: RepositoryAuditProductReport;
  canonicalArtifact: CanonicalRepositoryAuditArtifact;
  angularTargetConfigEvidence: RepositoryAngularTargetConfigEvidenceDownload;
  architecturePathEvidence: RepositoryArchitecturePathEvidenceDownload;
  deploymentPathEvidence: RepositoryDeploymentPathEvidenceDownload;
  dockerComposeEvidence: DockerComposeSnapshotDownload;
  dockerComposeRelationshipEvidence: DockerComposeRelationshipSnapshotDownload;
  frameworkPathEvidence: RepositoryFrameworkPathEvidenceDownload;
  browserIntelligence: RepositoryAuditBrowserIntelligence;
  impactIndex: SolveGraphQueryIndex;
};

const severityClasses: Record<RepositorySeverity, string> = {
  critical: "border-red-300 bg-red-50 text-red-800",
  high: "border-orange-300 bg-orange-50 text-orange-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-blue-200 bg-blue-50 text-blue-800",
  info: "border-slate-200 bg-slate-50 text-slate-700",
};

function bytesLabel(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sampleEntries(): RepositorySnapshotEntry[] {
  const duplicate = encoder.encode("export const config = { retry: 3 };\n");
  return [
    { path: "sample-repository", kind: "directory" },
    { path: "sample-repository/src", kind: "directory" },
    { path: "sample-repository/dist", kind: "directory" },
    { path: "sample-repository/.github/workflows", kind: "directory" },
    {
      path: "sample-repository/package.json",
      kind: "file",
      bytes: encoder.encode(JSON.stringify({ name: "sample-repository", dependencies: { next: "16.2.7", react: "19.2.4" } }, null, 2)),
    },
    { path: "sample-repository/package-lock.json", kind: "file", bytes: encoder.encode("{}\n") },
    { path: "sample-repository/compose.yml", kind: "file", bytes: encoder.encode("services:\n  web:\n    image: example/web:1\n") },
    { path: "sample-repository/src/config.ts", kind: "file", bytes: duplicate },
    { path: "sample-repository/src/config.backup.ts", kind: "file", bytes: duplicate },
    { path: "sample-repository/src/page.tsx", kind: "file", bytes: encoder.encode("import { config } from './config';\nexport default function Page(){ return <main>{config.retry}</main>; }\n") },
    { path: "sample-repository/dist/app.js", kind: "file", bytes: encoder.encode("console.log('generated');\n"), generated: true },
    { path: "sample-repository/.github/workflows/ci.yml", kind: "file", bytes: encoder.encode("name: CI\non: [push]\n") },
    { path: "sample-repository/README.md", kind: "file", bytes: encoder.encode("# Sample repository\n") },
  ];
}

function recordEvent(name: string): void {
  window.dispatchEvent(new CustomEvent("solvelang:analytics", { detail: { name } }));
}

export function RepositoryAuditApp() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const busyRef = useRef(false);

  const technologies = useMemo(() => {
    if (!result) return [];
    return [
      ...result.analysis.inventory.languages.map(({ name }) => name),
      ...result.analysis.inventory.frameworks.map(({ name, version }) => version ? `${name} ${version}` : name),
      ...result.analysis.inventory.packageManagers.map(({ name }) => name),
      ...result.analysis.inventory.deploymentTargets.map(({ name }) => name),
    ].filter((value, index, values) => values.indexOf(value) === index).sort();
  }, [result]);

  const severityCounts = useMemo(() => {
    const counts: Record<RepositorySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of result?.analysis.findings ?? []) counts[finding.severity] += 1;
    return counts;
  }, [result]);

  async function buildResult(archiveName: string, archiveBytes: Uint8Array, entries: RepositorySnapshotEntry[], extraction?: RepositoryArchiveExtractionResult): Promise<ScanResult> {
    const ingestion = await ingestArchiveSnapshotEntries({
      archiveName,
      archiveBytes,
      entries,
      limits: {
        maxArchiveBytes: MAX_ARCHIVE_BYTES,
        maxEntries: MAX_ENTRIES,
        maxTotalBytes: MAX_EXPANDED_BYTES,
        maxEntryBytes: MAX_ENTRY_BYTES,
        maxDepth: 64,
        maxTextBytes: 1024 * 1024,
      },
    });
    const intelligence = await analyzeRepositorySnapshot(ingestion.snapshot, {
      inventoryLimits: {
        maxFiles: MAX_ENTRIES,
        maxTotalBytes: MAX_EXPANDED_BYTES,
        maxFileBytes: MAX_ENTRY_BYTES,
        maxDepth: 64,
        maxFindings: 2_000,
        maxManifestTextBytes: 1024 * 1024,
        largeFileThresholdBytes: 5 * 1024 * 1024,
      },
    });
    const dockerComposeSnapshotEvidence = analyzeDockerComposeSnapshot(ingestion.snapshot);
    const dockerComposeRelationshipSnapshotEvidence = analyzeDockerComposeRelationshipSnapshot(ingestion.snapshot);
    const analysis = intelligence.inventory;
    const now = new Date();
    const report = createRepositoryAuditProductReport({ archiveName, extraction, ingestion, analysis, intelligence, now });
    const canonicalArtifact = await createCanonicalRepositoryAuditArtifact({
      archiveName,
      analysis,
      intelligence,
      maxArchiveEntries: MAX_ENTRIES,
      now,
    });
    const angularTargetConfigEvidence = await createRepositoryAngularTargetConfigEvidenceDownload(
      archiveName,
      intelligence.angularTargetConfigEvidence,
    );
    const architecturePathEvidence = await createRepositoryArchitecturePathEvidenceDownload(
      archiveName,
      intelligence.architecturePaths,
    );
    const deploymentPathEvidence = await createRepositoryDeploymentPathEvidenceDownload(
      archiveName,
      intelligence.deploymentPathEvidence,
    );
    const dockerComposeEvidence = await createDockerComposeSnapshotDownload(
      archiveName,
      dockerComposeSnapshotEvidence,
    );
    const dockerComposeRelationshipEvidence = await createDockerComposeRelationshipSnapshotDownload(
      archiveName,
      dockerComposeRelationshipSnapshotEvidence,
    );
    const frameworkPathEvidence = await createRepositoryFrameworkPathEvidenceDownload(
      archiveName,
      intelligence.frameworkPathEvidence,
    );
    const impactIndex = await createSolveGraphQueryIndex(intelligence.graph.graph);
    const browserIntelligence = await createRepositoryAuditBrowserIntelligence(
      intelligence.graph.graph,
      intelligence.deploymentPathEvidence,
      {
        angularTargetConfigs: { maxRows: 100 },
        deploymentPaths: { maxRows: 100 },
        dockerCompose: { maxRows: 100 },
        dockerComposeRelationships: { maxRows: 100 },
        frameworkPaths: { maxRows: 100 },
      },
      intelligence.frameworkPathEvidence,
      intelligence.angularTargetConfigEvidence,
      undefined,
      dockerComposeSnapshotEvidence,
      dockerComposeRelationshipSnapshotEvidence,
    );
    return {
      extraction,
      ingestion,
      analysis,
      intelligence,
      report,
      canonicalArtifact,
      angularTargetConfigEvidence,
      architecturePathEvidence,
      deploymentPathEvidence,
      dockerComposeEvidence,
      dockerComposeRelationshipEvidence,
      frameworkPathEvidence,
      browserIntelligence,
      impactIndex,
    };
  }

  async function scanArchive(file: File): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setSelectedName(file.name);
    recordEvent("repository_audit_archive_selected");
    try {
      if (file.size === 0) throw new Error("The selected archive is empty.");
      if (file.size > MAX_ARCHIVE_BYTES) throw new Error("The archive exceeds the 50 MB local-scan limit.");
      const archiveBytes = new Uint8Array(await file.arrayBuffer());
      const extraction = await extractRepositoryArchive({
        name: file.name,
        bytes: archiveBytes,
        limits: {
          maxArchiveBytes: MAX_ARCHIVE_BYTES,
          maxEntries: MAX_ENTRIES,
          maxTotalUncompressedBytes: MAX_EXPANDED_BYTES,
          maxExpandedArchiveBytes: 320 * 1024 * 1024,
          maxEntryBytes: MAX_ENTRY_BYTES,
          maxDepth: 64,
          maxCompressionRatio: 100,
        },
      });
      const next = await buildResult(file.name, archiveBytes, extraction.entries, extraction);
      setResult(next);
      recordEvent("repository_audit_completed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The repository archive could not be scanned.");
      recordEvent("repository_audit_failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function runSample(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setSelectedName("sample-repository.zip");
    try {
      const archiveBytes = encoder.encode("SolveLang local sample repository");
      const next = await buildResult("sample-repository.zip", archiveBytes, sampleEntries());
      setResult(next);
      recordEvent("repository_audit_sample_completed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sample repository could not be scanned.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function exportReport(format: "product-json" | "canonical-json" | "angular-target-json" | "architecture-json" | "deployment-json" | "docker-compose-json" | "docker-compose-relationships-json" | "framework-json" | "html"): void {
    if (!result) return;
    const base = `${repositoryAuditSafeFilename(result.report.archive.name)}-solvelang-repository-audit`;
    if (format === "product-json") download(`${base}.json`, `${JSON.stringify(result.report, null, 2)}\n`, "application/json;charset=utf-8");
    else if (format === "canonical-json") download(result.canonicalArtifact.filename, result.canonicalArtifact.content, result.canonicalArtifact.mediaType);
    else if (format === "angular-target-json") download(result.angularTargetConfigEvidence.filename, result.angularTargetConfigEvidence.content, result.angularTargetConfigEvidence.mediaType);
    else if (format === "architecture-json") download(result.architecturePathEvidence.filename, result.architecturePathEvidence.content, result.architecturePathEvidence.mediaType);
    else if (format === "deployment-json") download(result.deploymentPathEvidence.filename, result.deploymentPathEvidence.content, result.deploymentPathEvidence.mediaType);
    else if (format === "docker-compose-json") download(result.dockerComposeEvidence.filename, result.dockerComposeEvidence.content, result.dockerComposeEvidence.mediaType);
    else if (format === "docker-compose-relationships-json") download(result.dockerComposeRelationshipEvidence.filename, result.dockerComposeRelationshipEvidence.content, result.dockerComposeRelationshipEvidence.mediaType);
    else if (format === "framework-json") download(result.frameworkPathEvidence.filename, result.frameworkPathEvidence.content, result.frameworkPathEvidence.mediaType);
    else download(`${base}.html`, createRepositoryAuditHtmlReport(result.report), "text/html;charset=utf-8");
    recordEvent(
      format === "angular-target-json"
        ? "repository_audit_angular_target_config_evidence_downloaded"
        : format === "docker-compose-relationships-json"
          ? "repository_audit_docker_compose_relationship_evidence_downloaded"
          : format === "docker-compose-json"
            ? "repository_audit_docker_compose_evidence_downloaded"
            : format === "framework-json"
              ? "repository_audit_framework_path_evidence_downloaded"
              : format === "deployment-json"
                ? "repository_audit_deployment_path_evidence_downloaded"
                : format === "architecture-json"
                  ? "repository_audit_architecture_evidence_downloaded"
                  : format === "canonical-json"
                    ? "repository_audit_canonical_evidence_downloaded"
                    : "repository_audit_report_downloaded",
    );
  }

  const shownFindings = result?.analysis.findings.slice(0, 100) ?? [];
  const shownHotspots = result?.intelligence.graph.intelligence.hotspots.slice(0, 10) ?? [];
  const shownSecretWarnings = result?.intelligence.secretWarnings.slice(0, 20) ?? [];
  const shownArchitecturePaths = result?.intelligence.architecturePaths.paths.slice(0, 10) ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 pb-28 lg:px-8">
      <section className="grid gap-8 lg:grid-cols-[1.08fr_.92fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/40 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Local repository scan</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Upload a repository archive</h2>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">Export a repository as ZIP or TAR. The archive is extracted and analyzed in this browser; files are not uploaded to SolveLang.</p>
          <label
            aria-disabled={busy}
            onDragEnter={() => { if (!busyRef.current) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event: DragEvent<HTMLLabelElement>) => {
              event.preventDefault();
              setDragging(false);
              if (busyRef.current) return;
              const file = event.dataTransfer.files?.[0];
              if (file) void scanArchive(file);
            }}
            className={`mt-8 flex min-h-60 flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 text-center transition ${busy ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-70" : dragging ? "cursor-pointer border-blue-500 bg-blue-50" : "cursor-pointer border-slate-300 bg-slate-50 hover:border-slate-500"}`}
          >
            <span className="text-4xl" aria-hidden="true">⇧</span>
            <span className="mt-4 text-lg font-semibold">Drop a repository archive here</span>
            <span className="mt-2 max-w-lg text-sm leading-6 text-slate-600">ZIP, TAR, TAR.GZ, or TGZ · maximum 50 MB compressed · up to 20,000 entries</span>
            <input
              className="sr-only"
              type="file"
              accept=".zip,.tar,.tar.gz,.tgz,application/zip,application/x-tar,application/gzip"
              disabled={busy}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) void scanArchive(file);
                event.target.value = "";
              }}
            />
            <span className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">{busy ? "Analyzing…" : "Choose archive"}</span>
          </label>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="break-all text-sm text-slate-500">{selectedName ? `Selected: ${selectedName}` : "No archive selected"}</p>
            <button type="button" onClick={() => void runSample()} disabled={busy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">Try sample report</button>
          </div>
          {error ? <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div> : null}
        </div>

        <aside className="rounded-[2rem] border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">Analyze only</p>
          <h2 className="mt-3 text-2xl font-semibold">Safe by default</h2>
          <ul className="mt-7 space-y-4 text-sm leading-6 text-slate-200">
            <li>✓ Rejects traversal, links, corrupt headers, and unsafe archive objects</li>
            <li>✓ Detects languages, frameworks, package managers, and deployment files</li>
            <li>✓ Finds exact duplicates, backup candidates, generated output, and large files</li>
            <li>✓ Maps bounded JavaScript/TypeScript dependencies and impact hotspots without executing code</li>
            <li>✓ Summarizes bounded architecture and security-boundary paths as structural evidence</li>
            <li>✓ Maps explicit repository-local deployment, Angular/Nest framework, and Angular target tsConfig references without executing code</li>
            <li>✓ Presents bounded Docker Compose services, literal image declarations, and explicit depends_on relationships without evaluating Compose or starting containers</li>
            <li>✓ Flags credential patterns with values redacted from reports and the UI</li>
            <li>✓ Never executes repository code, scripts, hooks, or package managers</li>
            <li>✓ Produces product JSON, integrity-covered canonical, architecture, deployment, Docker Compose inventory/relationship, framework, and Angular target-config evidence JSON, and a printable HTML report</li>
          </ul>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-6 text-slate-300">
            No file is deleted, moved, renamed, merged, or rewritten. Cleanup recommendations require a separate branch, validation, rollback planning, and human approval.
          </div>
        </aside>
      </section>

      {result ? <section className="mt-10" aria-live="polite">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">Files scanned</p><p className="mt-2 text-4xl font-semibold">{result.analysis.summary.filesScanned}</p><p className="mt-3 text-sm text-slate-600">{result.analysis.summary.directoriesSeen} directories</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">Repository size</p><p className="mt-2 text-4xl font-semibold">{bytesLabel(result.analysis.summary.bytesScanned)}</p><p className="mt-3 text-sm text-slate-600">Fingerprint verified</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">Findings</p><p className="mt-2 text-4xl font-semibold">{result.analysis.findings.length}</p><p className="mt-3 text-sm text-slate-600">{severityCounts.high + severityCounts.critical} high priority</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">Scan status</p><p className="mt-2 text-4xl font-semibold capitalize">{result.intelligence.execution.status}</p><p className="mt-3 text-sm text-slate-600">Read-only · local</p></div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Detected stack</p>
            <h2 className="mt-2 text-2xl font-semibold">Technology inventory</h2>
            <div className="mt-6 flex flex-wrap gap-2">{technologies.length ? technologies.map((item) => <span key={item} className="rounded-full bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">{item}</span>) : <span className="text-slate-500">No recognized technology markers.</span>}</div>
            <div className="mt-8 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {result.analysis.inventory.fileClasses.filter(({ count }) => count > 0).map((item) => <div key={item.class} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="capitalize text-slate-600">{item.class.replace("-", " ")}</p><p className="mt-1 text-2xl font-semibold">{item.count}</p></div>)}
            </div>
          </section>

          <section className="rounded-[2rem] border border-blue-200 bg-blue-50 p-6 sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">Evidence export</p>
            <h2 className="mt-2 text-2xl font-semibold">Keep the audit record</h2>
            <p className="mt-3 leading-7 text-slate-700">Download the product report, versioned canonical evidence, or dedicated architecture/security-path, deployment-path, Docker Compose inventory/relationship, framework-path, and Angular target-config artifacts for integrity verification. Evidence remains bounded and redacted without exporting secret values or keyed HMAC correlation fingerprints.</p>
            <div className="mt-7 flex flex-col gap-3 xl:flex-row xl:flex-wrap">
              <button type="button" onClick={() => exportReport("html")} className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800">Download HTML report</button>
              <button type="button" onClick={() => exportReport("product-json")} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50">Download product JSON</button>
              <button type="button" onClick={() => exportReport("canonical-json")} className="rounded-xl border border-blue-300 bg-white px-5 py-3 text-sm font-semibold text-blue-800 hover:bg-blue-100">Download canonical evidence</button>
              <button type="button" onClick={() => exportReport("angular-target-json")} className="rounded-xl border border-violet-300 bg-white px-5 py-3 text-sm font-semibold text-violet-800 hover:bg-violet-100">Download Angular target configs</button>
              <button type="button" onClick={() => exportReport("architecture-json")} className="rounded-xl border border-violet-300 bg-white px-5 py-3 text-sm font-semibold text-violet-800 hover:bg-violet-100">Download architecture paths</button>
              <button type="button" onClick={() => exportReport("deployment-json")} className="rounded-xl border border-indigo-300 bg-white px-5 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100">Download deployment paths</button>
              <button type="button" onClick={() => exportReport("docker-compose-json")} className="rounded-xl border border-cyan-300 bg-white px-5 py-3 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">Download Docker Compose evidence</button>
              <button type="button" onClick={() => exportReport("docker-compose-relationships-json")} className="rounded-xl border border-sky-300 bg-white px-5 py-3 text-sm font-semibold text-sky-800 hover:bg-sky-100">Download Compose relationships</button>
              <button type="button" onClick={() => exportReport("framework-json")} className="rounded-xl border border-cyan-300 bg-white px-5 py-3 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">Download framework paths</button>
            </div>
            <p className="mt-5 text-sm font-semibold text-slate-700">Canonical schema {result.canonicalArtifact.report.schemaVersion} · report {result.canonicalArtifact.report.reportId}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Integrity SHA-256: {result.canonicalArtifact.report.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Angular target config evidence {result.angularTargetConfigEvidence.artifact.schemaVersion} · {result.angularTargetConfigEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Angular target config SHA-256: {result.angularTargetConfigEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Architecture evidence {result.architecturePathEvidence.artifact.schemaVersion} · {result.architecturePathEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Architecture SHA-256: {result.architecturePathEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Deployment evidence {result.deploymentPathEvidence.artifact.schemaVersion} · {result.deploymentPathEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Deployment SHA-256: {result.deploymentPathEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Docker Compose evidence {result.dockerComposeEvidence.artifact.schemaVersion} · {result.dockerComposeEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Docker Compose SHA-256: {result.dockerComposeEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Docker Compose relationship evidence {result.dockerComposeRelationshipEvidence.artifact.schemaVersion} · {result.dockerComposeRelationshipEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Compose relationship SHA-256: {result.dockerComposeRelationshipEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Framework evidence {result.frameworkPathEvidence.artifact.schemaVersion} · {result.frameworkPathEvidence.artifact.status}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Framework SHA-256: {result.frameworkPathEvidence.artifact.integrity.canonicalJsonSha256}</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-slate-600">Source: {result.analysis.source.fingerprint}</p>
          </section>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-700">Dependency intelligence</p>
            <h2 className="mt-2 text-2xl font-semibold">Bounded blast-radius hotspots</h2>
            <p className="mt-3 leading-7 text-slate-600">{result.intelligence.graph.intelligence.counts.nodes} graph nodes · {result.intelligence.graph.intelligence.counts.edges} graph edges. Impact traversal is bounded and stays local.</p>
            <div className="mt-6 grid gap-3">
              {shownHotspots.length ? shownHotspots.map((hotspot) => <article key={hotspot.nodeId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4"><code className="break-all text-sm font-semibold text-slate-900">{hotspot.path ?? hotspot.label}</code><span className="shrink-0 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">{hotspot.transitiveImpact} impacted</span></div>
                <p className="mt-2 text-sm text-slate-600">{hotspot.directDependents} direct dependents{hotspot.impactTruncated ? " · bounded result truncated" : ""}</p>
              </article>) : <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No dependency hotspots were identified inside the bounded graph.</div>}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">Redacted security review</p>
            <h2 className="mt-2 text-2xl font-semibold">Credential-pattern warnings</h2>
            <p className="mt-3 leading-7 text-slate-600">{result.intelligence.secretWarnings.length} warning(s) across {result.intelligence.execution.secretFilesScanned} graph-accepted files. Secret values and HMAC correlation fingerprints are never rendered here or exported in the product report.</p>
            <div className="mt-6 grid gap-3">
              {shownSecretWarnings.length ? shownSecretWarnings.map((warning) => <article key={warning.warningId} className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-800">{warning.patternClass}</span><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{warning.exposure}</span></div>
                <code className="mt-3 block break-all text-sm font-semibold text-slate-900">{warning.path}:{warning.lineStart}</code>
                <p className="mt-2 text-sm leading-6 text-slate-600">{warning.remediation}</p>
              </article>) : <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No credential-pattern warnings were produced inside the bounded scan.</div>}
            </div>
            {result.intelligence.secretWarnings.length > shownSecretWarnings.length ? <p className="mt-4 text-sm text-slate-500">Showing {shownSecretWarnings.length} of {result.intelligence.secretWarnings.length} warnings. The downloaded report contains the full redacted warning set.</p> : null}
          </section>
        </div>

        <section className="mt-8 rounded-[2rem] border border-violet-200 bg-violet-50 p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-700">Architecture evidence</p><h2 className="mt-2 text-2xl font-semibold">Bounded structural paths</h2></div>
            <p className="text-sm text-slate-600">{result.intelligence.architecturePaths.summary.architecturePaths} architecture · {result.intelligence.architecturePaths.summary.securityBoundaryPaths} security-boundary</p>
          </div>
          <p className="mt-3 leading-7 text-slate-700">Structural route, workflow, job, dependency, resource, and permission paths are analyze-only evidence. A security-boundary label identifies a graph boundary; it does not assert a vulnerability.</p>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {shownArchitecturePaths.length ? shownArchitecturePaths.map((path, index) => <article key={`${path.classification}-${path.root.nodeId}-${path.target.nodeId}-${index}`} className="rounded-2xl border border-violet-100 bg-white p-5">
              <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold uppercase text-violet-800">{path.classification.replace("-", " ")}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">depth {path.depth}</span></div>
              <code className="mt-4 block break-all text-sm font-semibold text-slate-900">{path.root.path ?? path.root.nodeId}</code>
              <p className="my-2 text-sm text-slate-500">→</p>
              <code className="block break-all text-sm font-semibold text-slate-900">{path.target.path ?? path.target.nodeId}</code>
            </article>) : <div className="rounded-2xl border border-dashed border-violet-200 bg-white p-8 text-center text-slate-500 lg:col-span-2">No bounded architecture or security-boundary paths were identified.</div>}
          </div>
          {result.intelligence.architecturePaths.paths.length > shownArchitecturePaths.length ? <p className="mt-4 text-sm text-slate-500">Showing {shownArchitecturePaths.length} of {result.intelligence.architecturePaths.paths.length} paths. Download the architecture artifact for the complete bounded evidence set.</p> : null}
          {result.intelligence.architecturePaths.status === "partial" ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Architecture-path evidence is partial because one or more graph or traversal bounds were reached.</p> : null}
        </section>

        <RepositoryAuditVisualExplorerPanel explorer={result.browserIntelligence.visualExplorer} impactIndex={result.impactIndex} workflowEvidence={result.intelligence.workflowPathEvidence} className="mt-8" />
        <RepositoryAuditDeploymentPathPanel presentation={result.browserIntelligence.deploymentPaths} className="mt-8" />
        {result.browserIntelligence.dockerCompose ? (
          <RepositoryAuditDockerComposePanel presentation={result.browserIntelligence.dockerCompose} className="mt-8" />
        ) : null}
        {result.browserIntelligence.dockerComposeRelationships ? (
          <RepositoryAuditDockerComposeRelationshipPanel presentation={result.browserIntelligence.dockerComposeRelationships} className="mt-8" />
        ) : null}
        {result.browserIntelligence.frameworkPaths ? (
          <RepositoryAuditFrameworkPathPanel presentation={result.browserIntelligence.frameworkPaths} className="mt-8" />
        ) : null}
        {result.browserIntelligence.angularTargetConfigs ? (
          <RepositoryAuditAngularTargetConfigPanel presentation={result.browserIntelligence.angularTargetConfigs} className="mt-8" />
        ) : null}

        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Deterministic findings</p><h2 className="mt-2 text-2xl font-semibold">What needs review</h2></div><p className="text-sm text-slate-500">Showing {shownFindings.length} of {result.analysis.findings.length}</p></div>
          <div className="mt-6 grid gap-4">
            {shownFindings.length ? shownFindings.map((finding) => <article key={finding.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${severityClasses[finding.severity]}`}>{finding.severity}</span><span className="rounded-full bg-slate-200 px-3 py-1 font-mono text-xs font-semibold text-slate-700">{finding.ruleId}</span><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{finding.recommendation}</span></div>
              <h3 className="mt-4 text-lg font-semibold">{finding.title}</h3>
              <p className="mt-2 leading-7 text-slate-600">{finding.explanation}</p>
              <div className="mt-4 flex flex-wrap gap-2">{finding.evidence.slice(0, 6).map((item) => <code key={`${finding.id}-${item.path}`} className="max-w-full break-all rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">{item.path}</code>)}</div>
              {finding.approvalRequired ? <p className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">Human approval and rollback plan required before any change.</p> : null}
            </article>) : <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No deterministic inventory findings were produced.</div>}
          </div>
        </section>
      </section> : null}
    </div>
  );
}
