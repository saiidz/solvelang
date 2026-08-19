import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;

export type ServerAuditListenerProcessRelationshipKind =
  | "listener-process"
  | "listener-process-group";

export type ServerAuditListenerProcessRelationship = {
  id: string;
  kind: ServerAuditListenerProcessRelationshipKind;
  protocol: string;
  localAddress: string;
  port: number;
  processName: string;
  sources: string[];
  sourcesTruncated?: true;
};

export type ServerAuditListenerProcessRelationshipOptions = {
  maxRelationships?: number;
};

export type ServerAuditListenerProcessRelationshipAnalysis = {
  schema: "solvelang.server-audit.listener-process-relationships.v0";
  mode: "analyze-only";
  relationships: ServerAuditListenerProcessRelationship[];
  summary: {
    listenersChecked: number;
    processesChecked: number;
    matchedListeners: number;
    groupedProcessMatches: number;
    unmatchedListeners: number;
    missingProcessLabels: number;
    relationshipsWithTruncatedSources: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
    maxSourcesPerRelationship: number;
    relationshipsTruncated: boolean;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(
  kind: ServerAuditListenerProcessRelationshipKind,
  protocol: string,
  localAddress: string,
  port: number,
  processName: string,
  sources: readonly string[],
): string {
  const input = [kind, protocol, localAddress, String(port), processName, ...sources].join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-listener-process:${hash.toString(16).padStart(8, "0")}`;
}

function normalizedProcessName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function relationship(
  kind: ServerAuditListenerProcessRelationshipKind,
  protocol: string,
  localAddress: string,
  port: number,
  processName: string,
  allSources: string[],
): ServerAuditListenerProcessRelationship {
  const sources = allSources.slice(0, MAX_SOURCES_PER_RELATIONSHIP);
  return {
    id: stableId(kind, protocol, localAddress, port, processName, allSources),
    kind,
    protocol,
    localAddress,
    port,
    processName,
    sources,
    ...(allSources.length > sources.length ? { sourcesTruncated: true as const } : {}),
  };
}

export function analyzeServerAuditListenerProcessRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditListenerProcessRelationshipOptions = {},
): ServerAuditListenerProcessRelationshipAnalysis {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    1_000,
    1,
    5_000,
    "Server Audit listener-process maxRelationships",
  );
  const listeners = snapshot.listeningSockets ?? [];
  const processes = snapshot.processes ?? [];
  const processIndexesByName = new Map<string, number[]>();

  processes.forEach((process, index) => {
    const name = normalizedProcessName(process.name);
    if (!name) return;
    const indexes = processIndexesByName.get(name) ?? [];
    indexes.push(index);
    processIndexesByName.set(name, indexes);
  });

  const relationships: ServerAuditListenerProcessRelationship[] = [];
  let matchedListeners = 0;
  let groupedProcessMatches = 0;
  let unmatchedListeners = 0;
  let missingProcessLabels = 0;

  listeners.forEach((listener, listenerIndex) => {
    const processName = normalizedProcessName(listener.process);
    if (!processName) {
      missingProcessLabels += 1;
      return;
    }

    const processIndexes = processIndexesByName.get(processName) ?? [];
    if (processIndexes.length === 0) {
      unmatchedListeners += 1;
      return;
    }

    matchedListeners += 1;
    const sortedProcessIndexes = [...processIndexes].sort((left, right) => left - right);
    const sources = [
      `listeningSockets[${listenerIndex}]`,
      ...sortedProcessIndexes.map((index) => `processes[${index}]`),
    ];
    const kind = sortedProcessIndexes.length === 1
      ? "listener-process"
      : "listener-process-group";
    if (kind === "listener-process-group") groupedProcessMatches += 1;
    relationships.push(relationship(
      kind,
      listener.protocol,
      listener.localAddress,
      listener.port,
      processName,
      sources,
    ));
  });

  relationships.sort((left, right) => compareText(left.id, right.id));
  const boundedRelationships = relationships.slice(0, maxRelationships);

  return {
    schema: "solvelang.server-audit.listener-process-relationships.v0",
    mode: "analyze-only",
    relationships: boundedRelationships,
    summary: {
      listenersChecked: listeners.length,
      processesChecked: processes.length,
      matchedListeners,
      groupedProcessMatches,
      unmatchedListeners,
      missingProcessLabels,
      relationshipsWithTruncatedSources: boundedRelationships.filter((entry) => entry.sourcesTruncated).length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxSourcesPerRelationship: MAX_SOURCES_PER_RELATIONSHIP,
      relationshipsTruncated: relationships.length > maxRelationships,
    },
  };
}
