import type { ServerAuditSnapshot } from "./types";

export type ServerAuditArtifactConsistencyIssueKind =
  | "conflicting-backup-metadata"
  | "conflicting-log-metadata";

export type ServerAuditArtifactConsistencyIssue = {
  id: string;
  kind: ServerAuditArtifactConsistencyIssueKind;
  severity: "low" | "info";
  sources: string[];
  summary: string;
};

export type ServerAuditArtifactConsistencyOptions = {
  maxIssues?: number;
};

export type ServerAuditArtifactConsistencyAnalysis = {
  schema: "solvelang.server-audit.artifact-consistency.v0";
  mode: "analyze-only";
  issues: ServerAuditArtifactConsistencyIssue[];
  summary: {
    backupsChecked: number;
    logsChecked: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxIssues: number;
    issuesTruncated: boolean;
  };
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditArtifactConsistencyIssueKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-artifact:${hash.toString(16).padStart(8, "0")}`;
}

function groupIndexes<T>(items: T[], key: (item: T) => string | undefined): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const value = key(item);
    if (!value) return;
    const current = groups.get(value) ?? [];
    current.push(index);
    groups.set(value, current);
  });
  return groups;
}

function distinct(values: Array<string | number | undefined>): number {
  return new Set(values.map((value) => value === undefined ? "<undefined>" : String(value))).size;
}

export function analyzeServerAuditArtifactConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditArtifactConsistencyOptions = {},
): ServerAuditArtifactConsistencyAnalysis {
  const maxIssues = boundedInteger(options.maxIssues, 250, 1, 5_000, "Server Audit artifact maxIssues");
  const issues: ServerAuditArtifactConsistencyIssue[] = [];
  const backups = snapshot.backups ?? [];
  const logs = snapshot.logs ?? [];

  for (const indexes of groupIndexes(backups, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = backups[index];
      return `${entry.name}\u001f${entry.ageHours ?? ""}\u001f${entry.sizeBytes ?? ""}`;
    });
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `backups[${index}]`).sort();
    issues.push({
      id: stableId("conflicting-backup-metadata", sources),
      kind: "conflicting-backup-metadata",
      severity: "low",
      sources,
      summary: "Multiple backup entries for the same collected path report different identity, age, or size metadata; backup evidence is internally inconsistent.",
    });
  }

  for (const indexes of groupIndexes(logs, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = logs[index];
      return `${entry.sizeBytes ?? ""}\u001f${entry.modifiedAt ?? ""}`;
    });
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `logs[${index}]`).sort();
    issues.push({
      id: stableId("conflicting-log-metadata", sources),
      kind: "conflicting-log-metadata",
      severity: "info",
      sources,
      summary: "Multiple log entries for the same collected path report different size or modification metadata; log evidence is internally inconsistent and may reflect collection-time churn.",
    });
  }

  issues.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema: "solvelang.server-audit.artifact-consistency.v0",
    mode: "analyze-only",
    issues: issues.slice(0, maxIssues),
    summary: {
      backupsChecked: backups.length,
      logsChecked: logs.length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxIssues,
      issuesTruncated: issues.length > maxIssues,
    },
  };
}
