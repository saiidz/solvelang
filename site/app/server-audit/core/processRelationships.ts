import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;
const MAX_ATTRIBUTION_LABEL_BYTES = 128;
const encoder = new TextEncoder();

export type ServerAuditProcessRelationshipKind = "parent-process" | "listener-process" | "ambiguous-listener-process";

export type ServerAuditProcessRelationship = {
  id: string;
  kind: ServerAuditProcessRelationshipKind;
  sources: string[];
  sourcesTruncated?: true;
};

export type ServerAuditProcessRelationshipOptions = {
  maxRelationships?: number;
};

export type ServerAuditProcessRelationshipAnalysis = {
  schema: "solvelang.server-audit.process-relationships.v0";
  mode: "analyze-only";
  relationships: ServerAuditProcessRelationship[];
  summary: {
    processesChecked: number;
    listenersChecked: number;
    parentRelationshipsFound: number;
    listenerRelationshipsFound: number;
    ambiguousListenerAttributions: number;
    unresolvedListenerAttributions: number;
    duplicateProcessIdsSkipped: number;
    invalidProcessLabelsSkipped: number;
    invalidListenerLabelsSkipped: number;
    relationshipsWithTruncatedSources: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
    maxSourcesPerRelationship: number;
    maxAttributionLabelBytes: number;
    relationshipsTruncated: boolean;
  };
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function normalizedAttributionLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.normalize("NFC");
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  const trimmed = normalized.trim();
  if (!trimmed) return undefined;
  if (encoder.encode(trimmed).byteLength > MAX_ATTRIBUTION_LABEL_BYTES) return undefined;
  return trimmed;
}

function hasNonBlankLabel(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function stableId(kind: ServerAuditProcessRelationshipKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-process:${hash.toString(16).padStart(8, "0")}`;
}

function compareRelationship(left: ServerAuditProcessRelationship, right: ServerAuditProcessRelationship): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function relationship(kind: ServerAuditProcessRelationshipKind, allSources: string[]): ServerAuditProcessRelationship {
  const sources = allSources.slice(0, MAX_SOURCES_PER_RELATIONSHIP);
  return {
    id: stableId(kind, allSources),
    kind,
    sources,
    ...(allSources.length > sources.length ? { sourcesTruncated: true as const } : {}),
  };
}

export function analyzeServerAuditProcessRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditProcessRelationshipOptions = {},
): ServerAuditProcessRelationshipAnalysis {
  const maxRelationships = boundedInteger(options.maxRelationships, 1_000, 1, 5_000, "Server Audit process maxRelationships");
  const processes = snapshot.processes ?? [];
  const listeners = snapshot.listeningSockets ?? [];
  const relationships: ServerAuditProcessRelationship[] = [];

  const indexesByPid = new Map<number, number[]>();
  const indexesByName = new Map<string, number[]>();
  let invalidProcessLabelsSkipped = 0;
  processes.forEach((process, index) => {
    const pidIndexes = indexesByPid.get(process.pid) ?? [];
    pidIndexes.push(index);
    indexesByPid.set(process.pid, pidIndexes);

    const processName = normalizedAttributionLabel(process.name);
    if (!processName) {
      invalidProcessLabelsSkipped += 1;
      return;
    }
    const nameIndexes = indexesByName.get(processName) ?? [];
    nameIndexes.push(index);
    indexesByName.set(processName, nameIndexes);
  });

  const uniqueIndexByPid = new Map<number, number>();
  let duplicateProcessIdsSkipped = 0;
  for (const [pid, indexes] of indexesByPid) {
    if (indexes.length === 1) uniqueIndexByPid.set(pid, indexes[0]);
    else duplicateProcessIdsSkipped += indexes.length;
  }

  let parentRelationshipsFound = 0;
  for (const [pid, childIndex] of [...uniqueIndexByPid.entries()].sort((left, right) => left[0] - right[0])) {
    const child = processes[childIndex];
    if (child.ppid <= 1 || child.ppid === pid) continue;
    const parentIndex = uniqueIndexByPid.get(child.ppid);
    if (parentIndex === undefined) continue;
    parentRelationshipsFound += 1;
    relationships.push(relationship("parent-process", [`processes[${parentIndex}]`, `processes[${childIndex}]`]));
  }

  let listenerRelationshipsFound = 0;
  let ambiguousListenerAttributions = 0;
  let unresolvedListenerAttributions = 0;
  let invalidListenerLabelsSkipped = 0;
  listeners.forEach((listener, listenerIndex) => {
    const processName = normalizedAttributionLabel(listener.process);
    if (!processName) {
      if (hasNonBlankLabel(listener.process)) invalidListenerLabelsSkipped += 1;
      return;
    }
    const processIndexes = indexesByName.get(processName) ?? [];
    if (processIndexes.length === 0) {
      unresolvedListenerAttributions += 1;
      return;
    }
    if (processIndexes.length === 1) {
      listenerRelationshipsFound += 1;
      relationships.push(relationship("listener-process", [`listeningSockets[${listenerIndex}]`, `processes[${processIndexes[0]}]`]));
      return;
    }

    ambiguousListenerAttributions += 1;
    const allSources = [
      `listeningSockets[${listenerIndex}]`,
      ...processIndexes.map((index) => `processes[${index}]`).sort(),
    ];
    relationships.push(relationship("ambiguous-listener-process", allSources));
  });

  relationships.sort(compareRelationship);
  const boundedRelationships = relationships.slice(0, maxRelationships);
  return {
    schema: "solvelang.server-audit.process-relationships.v0",
    mode: "analyze-only",
    relationships: boundedRelationships,
    summary: {
      processesChecked: processes.length,
      listenersChecked: listeners.length,
      parentRelationshipsFound,
      listenerRelationshipsFound,
      ambiguousListenerAttributions,
      unresolvedListenerAttributions,
      duplicateProcessIdsSkipped,
      invalidProcessLabelsSkipped,
      invalidListenerLabelsSkipped,
      relationshipsWithTruncatedSources: boundedRelationships.filter((entry) => entry.sourcesTruncated).length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxSourcesPerRelationship: MAX_SOURCES_PER_RELATIONSHIP,
      maxAttributionLabelBytes: MAX_ATTRIBUTION_LABEL_BYTES,
      relationshipsTruncated: relationships.length > maxRelationships,
    },
  };
}
