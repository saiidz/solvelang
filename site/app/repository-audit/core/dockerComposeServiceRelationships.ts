const MAX_COMPOSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RELATIONSHIPS = 1_000;
const MAX_RELATIONSHIPS = 2_000;

export type DockerComposeServiceRelationship = {
  relationshipId: string;
  kind: "depends-on";
  fromService: string;
  toService: string;
  targetState: "present" | "missing";
  evidence: {
    field: "depends_on";
    syntax: "list" | "mapping" | "inline-list";
  };
};

export type DockerComposeServiceRelationshipEvidence = {
  schema: "solvelang.repository-audit.docker-compose-service-relationships.v0";
  mode: "analyze-only";
  status: "absent" | "complete" | "partial";
  services: string[];
  relationships: DockerComposeServiceRelationship[];
  summary: {
    servicesSeen: number;
    relationshipsSeen: number;
    relationshipsReturned: number;
    relationshipsHidden: number;
    missingTargets: number;
    unsupportedReferences: number;
    duplicateRelationships: number;
  };
  notices: string[];
  execution: {
    composeEvaluation: false;
    containerStart: false;
    networkAccess: false;
    writeAccess: false;
    maxComposeBytes: number;
    maxRelationships: number;
  };
};

export type DockerComposeServiceRelationshipOptions = {
  maxRelationships?: number;
};

type RelationshipSeed = {
  fromService: string;
  toService: string;
  syntax: DockerComposeServiceRelationship["evidence"]["syntax"];
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function boundedMaxRelationships(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_RELATIONSHIPS;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_RELATIONSHIPS) {
    throw new Error(`Docker Compose maxRelationships must be an integer from 1 through ${MAX_RELATIONSHIPS}.`);
  }
  return resolved;
}

function literalServiceName(value: string): string | undefined {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2");
  if (!/^[A-Za-z0-9_.-]+$/.test(unquoted)) return undefined;
  return unquoted;
}

function parseInlineList(value: string): string[] | undefined {
  const match = /^\[(.*)\]$/.exec(value.trim());
  if (!match) return undefined;
  const content = match[1]!.trim();
  if (!content) return [];
  const values: string[] = [];
  for (const item of content.split(",")) {
    const service = literalServiceName(item);
    if (!service) return undefined;
    values.push(service);
  }
  return values;
}

function relationshipId(fromService: string, toService: string): string {
  return `docker-compose:depends-on:${fromService}:${toService}`;
}

export function analyzeDockerComposeServiceRelationships(
  text: string,
  options: DockerComposeServiceRelationshipOptions = {},
): DockerComposeServiceRelationshipEvidence {
  if (new TextEncoder().encode(text).byteLength > MAX_COMPOSE_BYTES) {
    throw new Error("Docker Compose text exceeds the 1 MiB text bound.");
  }
  const maxRelationships = boundedMaxRelationships(options.maxRelationships);
  const services = new Set<string>();
  const seeds: RelationshipSeed[] = [];
  let unsupportedReferences = 0;
  let servicesIndent: number | undefined;
  let currentService: string | undefined;
  let currentServiceIndent: number | undefined;
  let dependsOnIndent: number | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = indentation(line);

    if (servicesIndent === undefined) {
      if (/^services\s*:\s*$/.test(trimmed)) servicesIndent = indent;
      continue;
    }
    if (indent <= servicesIndent) break;

    const serviceMatch = /^([A-Za-z0-9_.-]+)\s*:\s*$/.exec(trimmed);
    if (indent === servicesIndent + 2 && serviceMatch) {
      currentService = serviceMatch[1]!;
      currentServiceIndent = indent;
      dependsOnIndent = undefined;
      services.add(currentService);
      continue;
    }
    if (!currentService || currentServiceIndent === undefined) continue;

    const dependsOnMatch = /^depends_on\s*:\s*(.*)$/.exec(trimmed);
    if (indent === currentServiceIndent + 2 && dependsOnMatch) {
      const tail = dependsOnMatch[1]!.trim();
      if (!tail) {
        dependsOnIndent = indent;
        continue;
      }
      const inlineValues = parseInlineList(tail);
      if (!inlineValues) {
        unsupportedReferences += 1;
      } else {
        for (const toService of inlineValues) {
          seeds.push({ fromService: currentService, toService, syntax: "inline-list" });
        }
      }
      dependsOnIndent = undefined;
      continue;
    }

    if (dependsOnIndent === undefined) continue;
    if (indent <= dependsOnIndent) {
      dependsOnIndent = undefined;
      continue;
    }
    if (indent !== dependsOnIndent + 2) continue;

    const listMatch = /^-\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      const toService = literalServiceName(listMatch[1]!);
      if (toService) seeds.push({ fromService: currentService, toService, syntax: "list" });
      else unsupportedReferences += 1;
      continue;
    }

    const mappingMatch = /^([A-Za-z0-9_.-]+)\s*:\s*.*$/.exec(trimmed);
    if (mappingMatch) {
      seeds.push({ fromService: currentService, toService: mappingMatch[1]!, syntax: "mapping" });
      continue;
    }

    unsupportedReferences += 1;
  }

  const sortedServices = [...services].sort(compareText);
  const uniqueSeeds: RelationshipSeed[] = [];
  const seen = new Set<string>();
  let duplicateRelationships = 0;
  for (const seed of seeds.sort((left, right) =>
    compareText(left.fromService, right.fromService)
    || compareText(left.toService, right.toService)
    || compareText(left.syntax, right.syntax))) {
    const key = `${seed.fromService}\0${seed.toService}`;
    if (seen.has(key)) {
      duplicateRelationships += 1;
      continue;
    }
    seen.add(key);
    uniqueSeeds.push(seed);
  }

  const relationshipsSeen = uniqueSeeds.length;
  const visibleSeeds = uniqueSeeds.slice(0, maxRelationships);
  const relationshipsHidden = relationshipsSeen - visibleSeeds.length;
  const relationships = visibleSeeds.map((seed): DockerComposeServiceRelationship => ({
    relationshipId: relationshipId(seed.fromService, seed.toService),
    kind: "depends-on",
    fromService: seed.fromService,
    toService: seed.toService,
    targetState: services.has(seed.toService) ? "present" : "missing",
    evidence: {
      field: "depends_on",
      syntax: seed.syntax,
    },
  }));
  const missingTargets = relationships.filter((relationship) => relationship.targetState === "missing").length;
  const partial = unsupportedReferences > 0 || relationshipsHidden > 0;
  const status = sortedServices.length === 0 ? "absent" : partial ? "partial" : "complete";

  return {
    schema: "solvelang.repository-audit.docker-compose-service-relationships.v0",
    mode: "analyze-only",
    status,
    services: sortedServices,
    relationships,
    summary: {
      servicesSeen: sortedServices.length,
      relationshipsSeen,
      relationshipsReturned: relationships.length,
      relationshipsHidden,
      missingTargets,
      unsupportedReferences,
      duplicateRelationships,
    },
    notices: [
      sortedServices.length === 0
        ? "No conventional Docker Compose services were identified in the supplied text."
        : "Only explicit static Docker Compose depends_on relationships are collected; Compose evaluation, interpolation, anchors, profiles, and runtime state are not evaluated.",
      ...(unsupportedReferences > 0
        ? [`${unsupportedReferences} dynamic or unsupported depends_on reference(s) were skipped instead of guessed.`]
        : []),
      ...(relationshipsHidden > 0
        ? [`${relationshipsHidden} additional depends_on relationship(s) were hidden by the deterministic relationship bound.`]
        : []),
      ...(missingTargets > 0
        ? [`${missingTargets} returned depends_on target(s) were not declared as services in the same bounded Compose text.`]
        : []),
    ],
    execution: {
      composeEvaluation: false,
      containerStart: false,
      networkAccess: false,
      writeAccess: false,
      maxComposeBytes: MAX_COMPOSE_BYTES,
      maxRelationships,
    },
  };
}
