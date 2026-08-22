import type { ServerAuditSnapshot } from "./types";

export type ServerAuditArtifactConsistencyIssueKind =
  | "conflicting-backup-metadata"
  | "conflicting-log-metadata";

export type ServerAuditArtifactConsistencyIssue = {
  id: string;
  kind: ServerAuditArtifactConsistencyIssueKind;
  severity: "low" | "info";
  sources: string[];
  sourceCount: number;
  sourcesTruncated: boolean;
  summary: string;
};

export type ServerAuditArtifactConsistencyOptions = {
  maxIssues?: number;
  maxSourcesPerIssue?: number;
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
    maxSourcesPerIssue: number;
    issuesTruncated: boolean;
    issueSourcesTruncated: boolean;
  };
};

const IDENTITY_SOURCE_LIMIT = 32;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditArtifactConsistencyIssueKind, sources: string[]): string {
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
  return `server-artifact:${hash.toString(16).padStart(8, "0")}`;
}

function compareIssue(left: ServerAuditArtifactConsistencyIssue, right: ServerAuditArtifactConsistencyIssue): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function siftWorstIssueUp(heap: ServerAuditArtifactConsistencyIssue[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareIssue(heap[parentIndex], heap[index]) >= 0) return;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function siftWorstIssueDown(heap: ServerAuditArtifactConsistencyIssue[]): void {
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= heap.length) return;
    const rightIndex = leftIndex + 1;
    let worstChildIndex = leftIndex;
    if (rightIndex < heap.length && compareIssue(heap[rightIndex], heap[leftIndex]) > 0) {
      worstChildIndex = rightIndex;
    }
    if (compareIssue(heap[index], heap[worstChildIndex]) >= 0) return;
    [heap[index], heap[worstChildIndex]] = [heap[worstChildIndex], heap[index]];
    index = worstChildIndex;
  }
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

function selectBoundedConflictSources(
  sources: string[],
  metadataVariants: string[],
  maxSourcesPerIssue: number,
): string[] {
  const firstVariant = metadataVariants[0];
  const conflictingIndex = metadataVariants.findIndex((variant) => variant !== firstVariant);
  if (conflictingIndex < 1) {
    throw new Error("Server Audit artifact consistency conflict evidence requires two distinct metadata variants.");
  }

  const selectedIndexes = [0, conflictingIndex];
  for (let index = 1; index < sources.length && selectedIndexes.length < maxSourcesPerIssue; index += 1) {
    if (index === conflictingIndex) continue;
    selectedIndexes.push(index);
  }
  selectedIndexes.sort((left, right) => left - right);
  return selectedIndexes.map((index) => sources[index]!);
}

function conflictIssueWithBoundedSources(
  kind: ServerAuditArtifactConsistencyIssueKind,
  severity: "low" | "info",
  sources: string[],
  metadataVariants: string[],
  summary: string,
  maxSourcesPerIssue: number,
): ServerAuditArtifactConsistencyIssue {
  const boundedSources = selectBoundedConflictSources(sources, metadataVariants, maxSourcesPerIssue);
  return {
    id: stableId(kind, sources),
    kind,
    severity,
    sources: boundedSources,
    sourceCount: sources.length,
    sourcesTruncated: boundedSources.length < sources.length,
    summary,
  };
}

export function analyzeServerAuditArtifactConsistency(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditArtifactConsistencyOptions = {},
): ServerAuditArtifactConsistencyAnalysis {
  const maxIssues = boundedInteger(options.maxIssues, 250, 1, 5_000, "Server Audit artifact maxIssues");
  const maxSourcesPerIssue = boundedInteger(
    options.maxSourcesPerIssue,
    32,
    2,
    256,
    "Server Audit artifact maxSourcesPerIssue",
  );
  const retainedIssues: ServerAuditArtifactConsistencyIssue[] = [];
  let issuesObserved = 0;
  const recordIssue = (issue: ServerAuditArtifactConsistencyIssue): void => {
    issuesObserved += 1;
    if (retainedIssues.length < maxIssues) {
      retainedIssues.push(issue);
      siftWorstIssueUp(retainedIssues, retainedIssues.length - 1);
      return;
    }
    if (compareIssue(issue, retainedIssues[0]) >= 0) return;
    retainedIssues[0] = issue;
    siftWorstIssueDown(retainedIssues);
  };

  const backups = snapshot.backups ?? [];
  const logs = snapshot.logs ?? [];

  for (const indexes of groupIndexes(backups, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = backups[index]!;
      return `${entry.name}\u001f${entry.ageHours ?? ""}\u001f${entry.sizeBytes ?? ""}`;
    });
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `backups[${index}]`);
    recordIssue(conflictIssueWithBoundedSources(
      "conflicting-backup-metadata",
      "low",
      sources,
      metadata,
      "Multiple backup entries for the same collected path report different identity, age, or size metadata; backup evidence is internally inconsistent.",
      maxSourcesPerIssue,
    ));
  }

  for (const indexes of groupIndexes(logs, (entry) => entry.path).values()) {
    if (indexes.length < 2) continue;
    const metadata = indexes.map((index) => {
      const entry = logs[index]!;
      return `${entry.sizeBytes ?? ""}\u001f${entry.modifiedAt ?? ""}`;
    });
    if (distinct(metadata) < 2) continue;
    const sources = indexes.map((index) => `logs[${index}]`);
    recordIssue(conflictIssueWithBoundedSources(
      "conflicting-log-metadata",
      "info",
      sources,
      metadata,
      "Multiple log entries for the same collected path report different size or modification metadata; log evidence is internally inconsistent and may reflect collection-time churn.",
      maxSourcesPerIssue,
    ));
  }

  retainedIssues.sort(compareIssue);
  return {
    schema: "solvelang.server-audit.artifact-consistency.v0",
    mode: "analyze-only",
    issues: retainedIssues,
    summary: {
      backupsChecked: backups.length,
      logsChecked: logs.length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxIssues,
      maxSourcesPerIssue,
      issuesTruncated: issuesObserved > maxIssues,
      issueSourcesTruncated: retainedIssues.some((issue) => issue.sourcesTruncated),
    },
  };
}
