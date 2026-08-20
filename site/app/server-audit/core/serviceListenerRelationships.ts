import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;
const MAX_ATTRIBUTION_LABEL_BYTES = 128;
const encoder = new TextEncoder();

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

function stableId(kind: ServerAuditServiceListenerRelationshipKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-service-listener:${hash.toString(16).padStart(8, "0")}`;
}

function relationship(
  kind: ServerAuditServiceListenerRelationshipKind,
  allSources: string[],
): ServerAuditServiceListenerRelationship {
  const truncated = allSources.length > MAX_SOURCES_PER_RELATIONSHIP;
  const sources = truncated
    ? [...allSources.slice(0, MAX_SOURCES_PER_RELATIONSHIP - 1), allSources[allSources.length - 1]]
    : allSources;
  return {
    id: stableId(kind, allSources),
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
      const serviceIndex = serviceIndexes[offset];
      relationships.push(relationship(kind, [
        `services[${serviceIndex}]`,
        `listeningSockets[${listenerIndex}]`,
        ...processIndexes.map((index) => `processes[${index}]`),
      ]));
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
