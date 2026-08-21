import type { ServerAuditSnapshot } from "./types";

export type ServerAuditBackupLogConsistencyIssueKind =
  | "conflicting-backup-record"
  | "conflicting-log-record";

export type ServerAuditBackupLogConsistencyIssue = {
  id: string;
  kind: ServerAuditBackupLogConsistencyIssueKind;
  severity: "low" | "info";
  sources: string[];
  sourceCount: number;
  sourcesTruncated: boolean;
  summary: string;
};

export type ServerAuditBackupLogConsistencyOptions = {
  maxIssues?: number;
  maxSourcesPerIssue?: number;
};

export type ServerAuditBackupLogConsistencyAnalysis = {
  schema: "solvelang.server-audit.backup-log-consistency.v0";
  mode: "analyze-only";
  issues: ServerAuditBackupLogConsistencyIssue[];
  summary: {
    backupsChecked: number;
    logsChecked: number;
    conflictingBackupGroups: number;
    conflictingLogGroups: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    rawBackupNamesExposed: false;
    rawBackupPathsExposed: false;
    rawLogPathsExposed: false;
    maxIssues: number;
    maxSourcesPerIssue: number;
    issuesTruncated: boolean;
    issueSourcesTruncated: boolean;
  };
};

const IDENTITY_SOURCE_LIMIT = 32;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditBackupLogConsistencyIssueKind, sources: string[]): string {
  const sourceCount = sources.length;
  const identitySources = sources.slice(0, IDENTITY_SOURCE_LIMIT);
  const completeInput = `${kind}\u001f${identitySources.join("\u001f")}`;
  const input = sourceCount > identitySources.length
    ? `${completeInput}\u001fsources-truncated:${sourceCount}`
    : completeInput;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-backup-log:${hash.toString(16).padStart(8, "0")}`;
}

function compareIssue(
  left: ServerAuditBackupLogConsistencyIssue,
  right: ServerAuditBackupLogConsistencyIssue,
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function groupIndexes<T>(items: T[], key: (item: T) => string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const value = key(item);
    const current = groups.get(value) ?? [];
    current.push(index);
    groups.set(value, current);
  });
  return groups;
}

function distinctCount(values: string[]): number {
  return new Set(values).size;
}

function selectBoundedConflictSources(
  sources: string[],
  metadataVariants: string[],
  maxSourcesPerIssue: number,
): string[] {
  const firstVariant = metadataVariants[0];
  const conflictingIndex = metadataVariants.findIndex((variant) => variant !== firstVariant);
  if (conflictingIndex < 1) {
    throw new Error("Server Audit backup/log consistency conflict evidence requires two distinct metadata variants.");
  }

  const selectedIndexes = [0, conflictingIndex];
  for (let index = 1; index < sources.length && selectedIndexes.length < maxSourcesPerIssue; index += 1) {
    if (index === conflictingIndex) continue;
    selectedIndexes.push(index);
  }
  selectedIndexes.sort((left, right) => left - right);
  return selectedIndexes.map((index) => sources[index]!);
}

function issueWithBoundedSources(
  kind: ServerAuditBackupLogConsistencyIssueKind,
  severity: "low" | "info",
  sources: string[],
  metadataVariants: string[],
  summary: string,
  maxSourcesPerIssue: number,
): ServerAuditBackupLogConsistencyIssue {
  const sourceCount = sources.length;
  const boundedSources = selectBoundedConflictSources(sources, metadataVariants, maxSourcesPerIssue);
  return {
    id: stableId(kind, sources),
    kind,
    severity,
    sources: boundedSources,
    sourceCount,
    sourcesTruncated: sourceCount > boundedSources.length,
    summary,
  };
}

export function analyzeServerAuditBackupLogConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditBackupLogConsistencyOptions = {},
): ServerAuditBackupLogConsistencyAnalysis {
  const maxIssues = boundedInteger(
    options.maxIssues,
    250,
    1,
    2_000,
    "Server Audit backup/log consistency maxIssues",
  );
  const maxSourcesPerIssue = boundedInteger(
    options.maxSourcesPerIssue,
    32,
    2,
    256,
    "Server Audit backup/log consistency maxSourcesPerIssue",
  );
  const backups = snapshot.backups ?? [];
  const logs = snapshot.logs ?? [];
  const issues: ServerAuditBackupLogConsistencyIssue[] = [];
  let conflictingBackupGroups = 0;
  let conflictingLogGroups = 0;

  for (const indexes of groupIndexes(backups, (entry) => entry.name).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = backups[index]!;
      return `${entry.path ?? "<undefined>"}\u001f${entry.ageHours ?? "<undefined>"}\u001f${entry.sizeBytes ?? "<undefined>"}`;
    });
    if (distinctCount(metadata) < 2) continue;
    conflictingBackupGroups += 1;
    const sources = indexes.map((index) => `backups[${index}]`);
    issues.push(issueWithBoundedSources(
      "conflicting-backup-record",
      "low",
      sources,
      metadata,
      "Multiple collected entries for the same backup identity report different path, age, or size metadata. Raw backup names and paths are intentionally withheld from this consistency evidence.",
      maxSourcesPerIssue,
    ));
  }

  for (const indexes of groupIndexes(logs, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = logs[index]!;
      return `${entry.sizeBytes ?? "<undefined>"}\u001f${entry.modifiedAt ?? "<undefined>"}`;
    });
    if (distinctCount(metadata) < 2) continue;
    conflictingLogGroups += 1;
    const sources = indexes.map((index) => `logs[${index}]`);
    issues.push(issueWithBoundedSources(
      "conflicting-log-record",
      "info",
      sources,
      metadata,
      "Multiple collected entries for the same log path report different size or modification-time metadata. The raw log path is intentionally withheld from this consistency evidence.",
      maxSourcesPerIssue,
    ));
  }

  issues.sort(compareIssue);
  const boundedIssues = issues.slice(0, maxIssues);
  return {
    schema: "solvelang.server-audit.backup-log-consistency.v0",
    mode: "analyze-only",
    issues: boundedIssues,
    summary: {
      backupsChecked: backups.length,
      logsChecked: logs.length,
      conflictingBackupGroups,
      conflictingLogGroups,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      rawBackupNamesExposed: false,
      rawBackupPathsExposed: false,
      rawLogPathsExposed: false,
      maxIssues,
      maxSourcesPerIssue,
      issuesTruncated: issues.length > maxIssues,
      issueSourcesTruncated: boundedIssues.some((issue) => issue.sourcesTruncated),
    },
  };
}
