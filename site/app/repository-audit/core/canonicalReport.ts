import type {
  RepositoryDetection,
  RepositoryEvidence,
  RepositoryFinding,
  RepositoryInventoryAnalysis,
  RepositoryRecommendation,
  RepositorySeverity,
} from "./inventory";
import { repositoryAuditIntegrityDigest, repositoryAuditReportId } from "./reportIntegrity";

const severityOrder: Record<RepositorySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const evidenceKinds = {
  file: "file",
  directory: "directory",
  manifest: "manifest",
  config: "config",
  "generated-marker": "generated-marker",
  size: "size",
  hash: "hash",
  "name-pattern": "name-pattern",
  deployment: "config",
} as const;

function evidence(item: RepositoryEvidence) {
  return {
    path: item.path,
    kind: evidenceKinds[item.kind],
    ...(item.byteSize === undefined ? {} : { byteSize: item.byteSize }),
    ...(item.sha256 ? { sha256: item.sha256 } : {}),
    ...(item.note ? { note: item.note.slice(0, 1000) } : {}),
  };
}

function detection(item: RepositoryDetection) {
  return {
    name: item.name,
    ...(item.version ? { version: item.version } : {}),
    confidence: item.confidence,
    evidence: item.evidence.map(evidence),
  };
}

function finding(item: RepositoryFinding) {
  return {
    id: item.id,
    ruleId: item.ruleId,
    category: item.category,
    severity: item.severity,
    title: item.title,
    status: "open" as const,
    recommendation: item.recommendation,
    explanation: item.explanation,
    confidence: item.confidence,
    impact: item.impact,
    evidence: item.evidence.map(evidence),
    destructive: item.destructive,
    approvalRequired: item.approvalRequired,
    validation: [...item.validation],
    rollback: [...item.rollback],
  };
}

function sortFindings(items: ReturnType<typeof finding>[]) {
  return [...items].sort((left, right) =>
    severityOrder[left.severity] - severityOrder[right.severity]
    || left.ruleId.localeCompare(right.ruleId)
    || (left.evidence[0]?.path ?? "").localeCompare(right.evidence[0]?.path ?? "")
    || left.id.localeCompare(right.id));
}

function severityCounts(items: ReturnType<typeof finding>[]) {
  const counts: Record<RepositorySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

function actionCounts(items: ReturnType<typeof finding>[]) {
  const counts: Record<RepositoryRecommendation, number> = {
    keep: 0,
    review: 0,
    move: 0,
    merge: 0,
    rewrite: 0,
    "delete-candidate": 0,
  };
  for (const item of items) counts[item.recommendation] += 1;
  return counts;
}

function date(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid.`);
  return value.toISOString();
}

export type CanonicalReportOptions = {
  generatedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  engineVersion?: string;
  rulesetVersion?: string;
  maxArchiveEntries?: number;
  timeoutMs?: number;
  repositoryUrl?: string;
  defaultBranch?: string;
  archiveName?: string;
  privateSource?: boolean;
};

export async function createCanonicalRepositoryAuditReport(
  analysis: RepositoryInventoryAnalysis,
  options: CanonicalReportOptions = {},
) {
  const generatedAt = options.generatedAt ?? new Date();
  const startedAt = options.startedAt ?? generatedAt;
  const finishedAt = options.finishedAt ?? generatedAt;
  if (finishedAt.getTime() < startedAt.getTime()) throw new Error("Repository Audit finish time cannot precede start time.");

  const engineVersion = options.engineVersion ?? "0.1.0";
  const rulesetVersion = options.rulesetVersion ?? "2026-08-13";
  const maxArchiveEntries = options.maxArchiveEntries ?? 100_000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const limits = { ...analysis.limits, maxArchiveEntries, timeoutMs };
  const findings = sortFindings(analysis.findings.map(finding));

  let source;
  if (analysis.source.kind === "github") {
    if (!options.repositoryUrl || !options.defaultBranch) throw new Error("GitHub reports require repositoryUrl and defaultBranch.");
    source = {
      kind: "github" as const,
      displayName: analysis.source.displayName,
      repositoryUrl: options.repositoryUrl,
      defaultBranch: options.defaultBranch,
      revision: analysis.source.revision,
      fingerprint: analysis.source.fingerprint,
      private: options.privateSource ?? false,
    };
  } else {
    const archiveName = options.archiveName ?? analysis.source.displayName;
    source = {
      kind: "archive" as const,
      displayName: analysis.source.displayName,
      revision: analysis.source.revision,
      fingerprint: analysis.source.fingerprint,
      archiveName,
      private: options.privateSource ?? false,
    };
  }

  const reportId = await repositoryAuditReportId({
    sourceFingerprint: analysis.source.fingerprint,
    engineVersion,
    rulesetVersion,
    limits,
  });

  const reportWithoutIntegrity = {
    schemaVersion: "1.0.0" as const,
    reportId,
    generatedAt: date(generatedAt, "generatedAt"),
    mode: "analyze-only" as const,
    engine: {
      name: "SolveLang Repository Audit" as const,
      version: engineVersion,
      rulesetVersion,
      deterministic: true as const,
    },
    source,
    limits,
    execution: {
      startedAt: date(startedAt, "startedAt"),
      finishedAt: date(finishedAt, "finishedAt"),
      status: analysis.execution.status,
      truncated: analysis.execution.truncated,
      truncationReasons: [...analysis.execution.truncationReasons],
      networkAccess: false as const,
      writeAccess: false as const,
      errors: [] as const,
    },
    summary: {
      filesScanned: analysis.summary.filesScanned,
      filesSkipped: analysis.summary.filesSkipped,
      bytesScanned: analysis.summary.bytesScanned,
      directoriesSeen: analysis.summary.directoriesSeen,
      findingsBySeverity: severityCounts(findings),
      actionsByType: actionCounts(findings),
    },
    inventory: {
      languages: analysis.inventory.languages.map(detection),
      frameworks: analysis.inventory.frameworks.map(detection),
      packageManagers: analysis.inventory.packageManagers.map(detection),
      deploymentTargets: analysis.inventory.deploymentTargets.map(detection),
      fileClasses: analysis.inventory.fileClasses,
      largeFiles: analysis.inventory.largeFiles.map(evidence),
    },
    detections: {
      duplicates: analysis.detections.duplicates.map((group) => ({
        groupId: group.groupId,
        matchType: group.matchType,
        confidence: group.confidence,
        members: group.members.map(evidence),
      })),
      backupCandidates: analysis.detections.backupCandidates.map(evidence),
      generatedCandidates: analysis.detections.generatedCandidates.map(evidence),
      secretExposureWarnings: [] as const,
    },
    findings,
    redaction: {
      policyVersion: "1.0.0" as const,
      secretValuesIncluded: false as const,
      pathNormalization: "repository-relative-posix" as const,
      contentExcerptPolicy: "none" as const,
      redactedMatchCount: 0,
    },
  };

  const integrityWithoutDigest = {
    findingOrder: "severity-desc-rule-id-path-line" as const,
    stableIds: true as const,
  };
  const canonicalJsonSha256 = await repositoryAuditIntegrityDigest({
    ...reportWithoutIntegrity,
    integrity: integrityWithoutDigest,
  });

  return {
    ...reportWithoutIntegrity,
    integrity: {
      canonicalJsonSha256,
      ...integrityWithoutDigest,
    },
  };
}

export function serializeCanonicalRepositoryAuditReport(report: Awaited<ReturnType<typeof createCanonicalRepositoryAuditReport>>) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
