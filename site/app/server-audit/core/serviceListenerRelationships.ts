import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;
const MAX_ATTRIBUTION_LABEL_BYTES = 128;
const encoder = new TextEncoder();
const STABLE_ID_SEPARATOR = "\u001f";

export type ServerAuditServiceListenerRelationshipKind = "service-listener" | "ambiguous-service-listener";

export type ServerAuditServiceListenerRelationship = {
  id: string;
  kind: ServerAuditServiceListenerRelationshipKind;
  sources: string[];
  sourcesTruncated?: true;
};

export type ServerAuditServiceListenerRelationshipOptions = {
  maxRelationships?: number;
};

export type ServerAuditServiceListenerRelationshipAnalysis = {
  schema: "solvelang.server-audit.service-listener-relationships.v0";
  mode: "analyze-only";
  relationships: ServerAuditServiceListenerRelationship[];
  summary: {
    servicesChecked: number;
    processesChecked: number;
    listenersChecked: number;
    matchedServices: number;
    listenerRelationshipsFound: number;
    ambiguousListenerAttributions: number;
    unresolvedListenerAttributions: number;
    unmatchedServices: number;
    skippedServiceNames: number;
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
  if (!trimmed || encoder.encode(trimmed).byteLength > MAX_ATTRIBUTION_LABEL_BYTES) return undefined;
  return trimmed;
}

function serviceProcessToken(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_ATTRIBUTION_LABEL_BYTES) return undefined;
  if (!/^[A-Za-z0-9_.@+-]+(?:\.service)?$/.test(trimmed)) return undefined;
  const token = trimmed.endsWith(".service") ? trimmed.slice(0, -".service".length) : trimmed;
  return normalizedAttributionLabel(token);
}

function updateStableHash(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

function stableAttributionId(
  kind: ServerAuditServiceListenerRelationshipKind,
  serviceIndex: number,
  listenerIndex: number,
  processIndexes: number[],
): string {
  let hash = 2166136261;
  const updateSource = (source: string, withSeparator: boolean) => {
    if (withSeparator) hash = updateStableHash(hash, STABLE_ID_SEPARATOR);
    hash = updateStableHash(hash, source);
  };

  updateSource(kind, false);
  updateSource(`services[${serviceIndex}]`, true);
  updateSource(`listeningSockets[${listenerIndex}]`, true);
  processIndexes.forEach((index) => updateSource(`processes[${index}]`, true));

  return `server-service-listener:${hash.toString(16).padStart(8, "0")}`;
}

function relationship(
  kind: ServerAuditServiceListenerRelationshipKind,
  serviceIndex: number,
  listenerIndex: number,
  processIndexes: number[],
): ServerAuditServiceListenerRelationship {
  const serviceSource = `services[${serviceIndex}]`;
  const listenerSource = `listeningSockets[${listenerIndex}]`;
  const totalSources = 2 + processIndexes.length;
  const truncated = totalSources > MAX_SOURCES_PER_RELATIONSHIP;
  const sources = [serviceSource, listenerSource];

  if (truncated) {
    const processPrefixLength = MAX_SOURCES_PER_RELATIONSHIP - 3;
    for (let index = 0; index < processPrefixLength; index += 1) {
      sources.push(`processes[${processIndexes[index]}]`);
    }
    sources.push(`processes[${processIndexes[processIndexes.length - 1]}]`);
  } else {
    processIndexes.forEach((index) => sources.push(`processes[${index}]`));
  }

  return {
    id: stableAttributionId(kind, serviceIndex, listenerIndex, processIndexes),
    kind,
    sources,
    ...(truncated ? { sourcesTruncated: true as const } : {}),
  };
}

export function analyzeServerAuditServiceListenerRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditServiceListenerRelationshipOptions = {},
): ServerAuditServiceListenerRelationshipAnalysis {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    500,
    1,
    5_000,
    "Server Audit service-listener maxRelationships",
  );
  const services = snapshot.services ?? [];
  const processes = snapshot.processes ?? [];
  const listeners = snapshot.listeningSockets ?? [];
  const processIndexesByName = new Map<string, number[]>();
  let invalidProcessLabelsSkipped = 0;

  processes.forEach((process, index) => {
    const label = normalizedAttributionLabel(process.name);
    if (!label) {
      invalidProcessLabelsSkipped += 1;
      return;
    }
    const indexes = processIndexesByName.get(label) ?? [];
    indexes.push(index);
    processIndexesByName.set(label, indexes);
  });

  const serviceEntries: Array<{ index: number; token: string }> = [];
  let skippedServiceNames = 0;
  let matchedServices = 0;
  let unmatchedServices = 0;
  services.forEach((service, index) => {
    const token = serviceProcessToken(service.name);
    if (!token) {
      skippedServiceNames += 1;
      return;
    }
    serviceEntries.push({ index, token });
    if (processIndexesByName.has(token)) matchedServices += 1;
    else unmatchedServices += 1;
  });

  const servicesByToken = new Map<string, number[]>();
  serviceEntries.forEach(({ index, token }) => {
    const indexes = servicesByToken.get(token) ?? [];
    indexes.push(index);
    servicesByToken.set(token, indexes);
  });

  const relationships: ServerAuditServiceListenerRelationship[] = [];
  let listenerRelationshipsFound = 0;
  let ambiguousListenerAttributions = 0;
  let unresolvedListenerAttributions = 0;
  let invalidListenerLabelsSkipped = 0;
  let totalRelationshipCandidates = 0;
  listeners.forEach((listener, listenerIndex) => {
    const label = normalizedAttributionLabel(listener.process);
    if (!label) {
      if (typeof listener.process === "string" && listener.process.trim()) invalidListenerLabelsSkipped += 1;
      return;
    }
    const serviceIndexes = servicesByToken.get(label);
    if (!serviceIndexes) return;
    const processIndexes = processIndexesByName.get(label) ?? [];
    if (processIndexes.length === 0) {
      unresolvedListenerAttributions += 1;
      return;
    }

    // Both index lists are populated in ascending snapshot order. Count every candidate
    // relationship exactly, but only materialize the configured bounded prefix so a
    // repeated label cannot create an O(services * listeners) object explosion.
    const kind: ServerAuditServiceListenerRelationshipKind = processIndexes.length === 1
      ? "service-listener"
      : "ambiguous-service-listener";
    totalRelationshipCandidates += serviceIndexes.length;
    if (kind === "service-listener") listenerRelationshipsFound += serviceIndexes.length;
    else ambiguousListenerAttributions += serviceIndexes.length;

    const remaining = maxRelationships - relationships.length;
    if (remaining <= 0) return;
    for (let offset = 0; offset < Math.min(remaining, serviceIndexes.length); offset += 1) {
      relationships.push(relationship(kind, serviceIndexes[offset], listenerIndex, processIndexes));
    }
  });

  relationships.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema: "solvelang.server-audit.service-listener-relationships.v0",
    mode: "analyze-only",
    relationships,
    summary: {
      servicesChecked: services.length,
      processesChecked: processes.length,
      listenersChecked: listeners.length,
      matchedServices,
      listenerRelationshipsFound,
      ambiguousListenerAttributions,
      unresolvedListenerAttributions,
      unmatchedServices,
      skippedServiceNames,
      invalidProcessLabelsSkipped,
      invalidListenerLabelsSkipped,
      relationshipsWithTruncatedSources: relationships.filter((entry) => entry.sourcesTruncated).length,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxSourcesPerRelationship: MAX_SOURCES_PER_RELATIONSHIP,
      maxAttributionLabelBytes: MAX_ATTRIBUTION_LABEL_BYTES,
      relationshipsTruncated: totalRelationshipCandidates > maxRelationships,
    },
  };
}
