import type { ServerAuditSnapshot } from "./types";

const MAX_SOURCES_PER_RELATIONSHIP = 32;

export type ServerAuditServiceProcessRelationshipKind = "service-process" | "service-process-group";

export type ServerAuditServiceProcessRelationship = {
  id: string;
  kind: ServerAuditServiceProcessRelationshipKind;
  sources: string[];
  sourcesTruncated?: true;
};

export type ServerAuditServiceProcessRelationshipOptions = {
  maxRelationships?: number;
};

export type ServerAuditServiceProcessRelationshipAnalysis = {
  schema: "solvelang.server-audit.service-process-relationships.v0";
  mode: "analyze-only";
  relationships: ServerAuditServiceProcessRelationship[];
  summary: {
    servicesChecked: number;
    processesChecked: number;
    matchedServices: number;
    groupedProcessMatches: number;
    unmatchedServices: number;
    skippedServiceNames: number;
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

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function stableId(kind: ServerAuditServiceProcessRelationshipKind, sources: string[]): string {
  const input = `${kind}\u001f${sources.join("\u001f")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `server-service-process:${hash.toString(16).padStart(8, "0")}`;
}

function compareRelationship(
  left: ServerAuditServiceProcessRelationship,
  right: ServerAuditServiceProcessRelationship,
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function relationship(
  kind: ServerAuditServiceProcessRelationshipKind,
  allSources: string[],
): ServerAuditServiceProcessRelationship {
  const sources = allSources.slice(0, MAX_SOURCES_PER_RELATIONSHIP);
  return {
    id: stableId(kind, allSources),
    kind,
    sources,
    ...(allSources.length > sources.length ? { sourcesTruncated: true as const } : {}),
  };
}

function serviceProcessToken(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  if (!/^[A-Za-z0-9_.@+-]+(?:\.service)?$/.test(trimmed)) return undefined;
  const token = trimmed.endsWith(".service") ? trimmed.slice(0, -".service".length) : trimmed;
  return token || undefined;
}

export function analyzeServerAuditServiceProcessRelationships(
  snapshot: ServerAuditSnapshot,
  options: ServerAuditServiceProcessRelationshipOptions = {},
): ServerAuditServiceProcessRelationshipAnalysis {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    500,
    1,
    5_000,
    "Server Audit service-process maxRelationships",
  );
  const services = snapshot.services ?? [];
  const processes = snapshot.processes ?? [];
  const processIndexesByName = new Map<string, number[]>();

  processes.forEach((process, index) => {
    const name = process.name.trim();
    if (!name) return;
    const indexes = processIndexesByName.get(name) ?? [];
    indexes.push(index);
    processIndexesByName.set(name, indexes);
  });

  const relationships: ServerAuditServiceProcessRelationship[] = [];
  let matchedServices = 0;
  let groupedProcessMatches = 0;
  let unmatchedServices = 0;
  let skippedServiceNames = 0;

  services.forEach((service, serviceIndex) => {
    const token = serviceProcessToken(service.name);
    if (!token) {
      skippedServiceNames += 1;
      return;
    }

    const processIndexes = processIndexesByName.get(token) ?? [];
    if (processIndexes.length === 0) {
      unmatchedServices += 1;
      return;
    }

    matchedServices += 1;
    const sortedProcessIndexes = [...processIndexes].sort((left, right) => left - right);
    const sources = [
      `services[${serviceIndex}]`,
      ...sortedProcessIndexes.map((index) => `processes[${index}]`),
    ];

    if (sortedProcessIndexes.length === 1) {
      relationships.push(relationship("service-process", sources));
      return;
    }

    groupedProcessMatches += 1;
    relationships.push(relationship("service-process-group", sources));
  });

  relationships.sort(compareRelationship);
  const boundedRelationships = relationships.slice(0, maxRelationships);

  return {
    schema: "solvelang.server-audit.service-process-relationships.v0",
    mode: "analyze-only",
    relationships: boundedRelationships,
    summary: {
      servicesChecked: services.length,
      processesChecked: processes.length,
      matchedServices,
      groupedProcessMatches,
      unmatchedServices,
      skippedServiceNames,
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
