import type { ServerAuditSnapshot } from "./types";

export type ServerAuditBackupLogConsistencyIssueKind =
  | "conflicting-backup-record"
  | "conflicting-log-record";

export type ServerAuditBackupLogConsistencyIssue = {
  id: string;
  kind: ServerAuditBackupLogConsistencyIssueKind;
  severity: "low" | "info";
  sources: string[];
  summary: string;
};

export type ServerAuditBackupLogConsistencyOptions = {
  maxIssues?: number;
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
    issuesTruncated: boolean;
  };
};

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
  const input = `${kind}\u001f${sources.join("\u001f")}`;
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
    issues.push({
      id: stableId("conflicting-backup-record", sources),
      kind: "conflicting-backup-record",
      severity: "low",
      sources,
      summary: "Multiple collected entries for the same backup identity report different path, age, or size metadata. Raw backup names and paths are intentionally withheld from this consistency evidence.",
    });
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
    issues.push({
      id: stableId("conflicting-log-record", sources),
      kind: "conflicting-log-record",
      severity: "info",
      sources,
      summary: "Multiple collected entries for the same log path report different size or modification-time metadata. The raw log path is intentionally withheld from this consistency evidence.",
    });
  }

  issues.sort(compareIssue);
  return {
    schema: "solvelang.server-audit.backup-log-consistency.v0",
    mode: "analyze-only",
    issues: issues.slice(0, maxIssues),
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
      issuesTruncated: issues.length > maxIssues,
    },
  };
}
