import type { ServerAuditSnapshot } from "./types";

export type ServerAuditProcessRelationshipKind = "parent-process" | "listener-process" | "ambiguous-listener-process";

export type ServerAuditProcessRelationship = {
  id: string;
  kind: ServerAuditProcessRelationshipKind;
  sources: string[];
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
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
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
  processes.forEach((process, index) => {
    const pidIndexes = indexesByPid.get(process.pid) ?? [];
    pidIndexes.push(index);
    indexesByPid.set(process.pid, pidIndexes);

    const nameIndexes = indexesByName.get(process.name) ?? [];
    nameIndexes.push(index);
    indexesByName.set(process.name, nameIndexes);
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
    const sources = [`processes[${parentIndex}]`, `processes[${childIndex}]`];
    relationships.push({ id: stableId("parent-process", sources), kind: "parent-process", sources });
  }

  let listenerRelationshipsFound = 0;
  let ambiguousListenerAttributions = 0;
  let unresolvedListenerAttributions = 0;
  listeners.forEach((listener, listenerIndex) => {
    const processName = listener.process?.trim();
    if (!processName) return;
    const processIndexes = indexesByName.get(processName) ?? [];
    if (processIndexes.length === 0) {
      unresolvedListenerAttributions += 1;
      return;
    }
    if (processIndexes.length === 1) {
      listenerRelationshipsFound += 1;
      const sources = [`listeningSockets[${listenerIndex}]`, `processes[${processIndexes[0]}]`];
      relationships.push({ id: stableId("listener-process", sources), kind: "listener-process", sources });
      return;
    }

    ambiguousListenerAttributions += 1;
    const sources = [
      `listeningSockets[${listenerIndex}]`,
      ...processIndexes.map((index) => `processes[${index}]`).sort(),
    ];
    relationships.push({
      id: stableId("ambiguous-listener-process", sources),
      kind: "ambiguous-listener-process",
      sources,
    });
  });

  relationships.sort(compareRelationship);
  return {
    schema: "solvelang.server-audit.process-relationships.v0",
    mode: "analyze-only",
    relationships: relationships.slice(0, maxRelationships),
    summary: {
      processesChecked: processes.length,
      listenersChecked: listeners.length,
      parentRelationshipsFound,
      listenerRelationshipsFound,
      ambiguousListenerAttributions,
      unresolvedListenerAttributions,
      duplicateProcessIdsSkipped,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      relationshipsTruncated: relationships.length > maxRelationships,
    },
  };
}
