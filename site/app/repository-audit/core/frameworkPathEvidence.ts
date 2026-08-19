import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryFrameworkPathKind =
  | "angular-project-root"
  | "angular-source-root"
  | "angular-build-entrypoint"
  | "nest-source-root";

export type RepositoryFrameworkTargetState =
  | "present"
  | "outside-bounded-scan"
  | "missing";

export type RepositoryFrameworkPathEvidence = {
  evidenceId: string;
  kind: RepositoryFrameworkPathKind;
  framework: "angular" | "nest";
  fromPath: string;
  rawReference: string;
  targetPath: string;
  targetType: "file" | "directory";
  targetState: RepositoryFrameworkTargetState;
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryFrameworkPathEvidenceAnalysis = {
  schema: "solvelang.repository-audit.framework-path-evidence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  relationships: RepositoryFrameworkPathEvidence[];
  skipped: {
    missingText: number;
    oversizedText: number;
    invalidJson: number;
    dynamicReference: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxRelationships: number;
    maxConfigTextBytes: number;
    relationshipsTruncated: boolean;
    acceptedFiles: number;
    frameworkFilesExamined: number;
    graphTruncated: boolean;
  };
};

export type RepositoryFrameworkPathEvidenceOptions = {
  maxRelationships?: number;
  maxConfigTextBytes?: number;
};

type RelationshipValue = {
  kind: RepositoryFrameworkPathKind;
  framework: "angular" | "nest";
  field: string;
  rawReference: string;
  targetType: "file" | "directory";
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

function pathForNode(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function sameSource(snapshot: RepositorySnapshot, graph: SolveGraphDocument): boolean {
  return snapshot.source.displayName === graph.source.displayName
    && snapshot.source.revision === graph.source.revision
    && snapshot.source.fingerprint === graph.source.fingerprint;
}

function isDynamicReference(value: string): boolean {
  return value.length === 0
    || value === "."
    || value.includes("\0")
    || value.includes("\\")
    || value.includes("$")
    || /[*?!\[\]{}]/.test(value)
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function resolveLocalPath(baseDirectory: string, rawReference: string): string | undefined {
  const trimmed = rawReference.replace(/^\.\//, "").replace(/\/$/, "");
  if (isDynamicReference(trimmed)) return undefined;
  const parts = baseDirectory ? baseDirectory.split("/") : [];
  for (const segment of trimmed.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) return undefined;
  try {
    return normalizeRepositoryPath(parts.join("/"));
  } catch {
    return undefined;
  }
}

function pathObserved(
  paths: ReadonlySet<string>,
  targetPath: string,
  targetType: "file" | "directory",
): boolean {
  if (targetType === "file") return paths.has(targetPath);
  const prefix = `${targetPath}/`;
  for (const path of paths) {
    if (path === targetPath || path.startsWith(prefix)) return true;
  }
  return false;
}

function targetState(
  targetPath: string,
  targetType: "file" | "directory",
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryFrameworkTargetState {
  if (pathObserved(acceptedPaths, targetPath, targetType)) return "present";
  if (pathObserved(snapshotPaths, targetPath, targetType)) return "outside-bounded-scan";
  return "missing";
}

function evidenceId(
  kind: RepositoryFrameworkPathKind,
  fromPath: string,
  field: string,
  targetPath: string,
): string {
  return `framework-path:${kind}:${fromPath}:${field}:${targetPath}`;
}

function collectAngularValues(record: Record<string, unknown>): RelationshipValue[] {
  const projects = record.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return [];
  const values: RelationshipValue[] = [];

  for (const [projectName, projectValue] of Object.entries(projects as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))) {
    if (!projectValue || typeof projectValue !== "object" || Array.isArray(projectValue)) continue;
    const project = projectValue as Record<string, unknown>;
    if (typeof project.root === "string") {
      values.push({
        kind: "angular-project-root",
        framework: "angular",
        field: `projects.${projectName}.root`,
        rawReference: project.root,
        targetType: "directory",
      });
    }
    if (typeof project.sourceRoot === "string") {
      values.push({
        kind: "angular-source-root",
        framework: "angular",
        field: `projects.${projectName}.sourceRoot`,
        rawReference: project.sourceRoot,
        targetType: "directory",
      });
    }

    const targetsValue = project.architect ?? project.targets;
    if (!targetsValue || typeof targetsValue !== "object" || Array.isArray(targetsValue)) continue;
    const buildValue = (targetsValue as Record<string, unknown>).build;
    if (!buildValue || typeof buildValue !== "object" || Array.isArray(buildValue)) continue;
    const optionsValue = (buildValue as Record<string, unknown>).options;
    if (!optionsValue || typeof optionsValue !== "object" || Array.isArray(optionsValue)) continue;
    const options = optionsValue as Record<string, unknown>;

    for (const field of ["browser", "main", "server"] as const) {
      const value = options[field];
      if (typeof value !== "string") continue;
      values.push({
        kind: "angular-build-entrypoint",
        framework: "angular",
        field: `projects.${projectName}.build.options.${field}`,
        rawReference: value,
        targetType: "file",
      });
    }

    const index = options.index;
    if (typeof index === "string") {
      values.push({
        kind: "angular-build-entrypoint",
        framework: "angular",
        field: `projects.${projectName}.build.options.index`,
        rawReference: index,
        targetType: "file",
      });
    } else if (index && typeof index === "object" && !Array.isArray(index)) {
      const input = (index as Record<string, unknown>).input;
      if (typeof input === "string") {
        values.push({
          kind: "angular-build-entrypoint",
          framework: "angular",
          field: `projects.${projectName}.build.options.index.input`,
          rawReference: input,
          targetType: "file",
        });
      }
    }
  }

  return values;
}

function collectNestValues(record: Record<string, unknown>): RelationshipValue[] {
  if (typeof record.sourceRoot !== "string") return [];
  return [{
    kind: "nest-source-root",
    framework: "nest",
    field: "sourceRoot",
    rawReference: record.sourceRoot,
    targetType: "directory",
  }];
}

function parseFrameworkRelationships(
  path: string,
  text: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): {
  relationships: RepositoryFrameworkPathEvidence[];
  invalidJson: boolean;
  dynamicReference: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { relationships: [], invalidJson: true, dynamicReference: 0 };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { relationships: [], invalidJson: true, dynamicReference: 0 };
  }

  const record = parsed as Record<string, unknown>;
  const lowerName = basename(path).toLowerCase();
  const values = lowerName === "angular.json"
    ? collectAngularValues(record)
    : collectNestValues(record);
  const baseDirectory = dirname(path);
  let dynamicReference = 0;
  const relationships = values.flatMap((value) => {
    const targetPath = resolveLocalPath(baseDirectory, value.rawReference);
    if (!targetPath) {
      dynamicReference += 1;
      return [];
    }
    return [{
      evidenceId: evidenceId(value.kind, path, value.field, targetPath),
      kind: value.kind,
      framework: value.framework,
      fromPath: path,
      rawReference: value.rawReference,
      targetPath,
      targetType: value.targetType,
      targetState: targetState(targetPath, value.targetType, snapshotPaths, acceptedPaths),
      evidence: { path, field: value.field },
    }];
  });
  return { relationships, invalidJson: false, dynamicReference };
}

function isFrameworkConfig(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === "angular.json" || name === "nest-cli.json";
}

export async function createRepositoryFrameworkPathEvidenceAnalysis(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryFrameworkPathEvidenceOptions = {},
): Promise<RepositoryFrameworkPathEvidenceAnalysis> {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    250,
    1,
    2_000,
    "Repository framework path maxRelationships",
  );
  const maxConfigTextBytes = boundedInteger(
    options.maxConfigTextBytes,
    1024 * 1024,
    1,
    10 * 1024 * 1024,
    "Repository framework path maxConfigTextBytes",
  );

  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) {
    throw new Error("Repository framework path evidence source does not match the bounded Solve Graph source.");
  }

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) {
      throw new Error(`Repository framework path evidence received duplicate path: ${path}`);
    }
    filesByPath.set(path, { ...file, path });
  }
  const snapshotPaths = new Set(filesByPath.keys());
  const acceptedPaths = new Set(
    graph.nodes
      .filter((node) => node.kind === "file")
      .map(pathForNode)
      .filter((path): path is string => typeof path === "string" && path.length > 0)
      .map(normalizeRepositoryPath),
  );

  let missingText = 0;
  let oversizedText = 0;
  let invalidJson = 0;
  let dynamicReference = 0;
  let frameworkFilesExamined = 0;
  const allRelationships: RepositoryFrameworkPathEvidence[] = [];

  for (const path of [...acceptedPaths].sort(compareText)) {
    if (!isFrameworkConfig(path)) continue;
    frameworkFilesExamined += 1;
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Bounded Solve Graph references an unavailable repository file: ${path}`);
    if (typeof file.text !== "string") {
      missingText += 1;
      continue;
    }
    if (textBytes(file.text) > maxConfigTextBytes) {
      oversizedText += 1;
      continue;
    }

    const result = parseFrameworkRelationships(path, file.text, snapshotPaths, acceptedPaths);
    allRelationships.push(...result.relationships);
    invalidJson += result.invalidJson ? 1 : 0;
    dynamicReference += result.dynamicReference;
  }

  allRelationships.sort((left, right) => compareText(left.framework, right.framework)
    || compareText(left.kind, right.kind)
    || compareText(left.fromPath, right.fromPath)
    || compareText(left.evidence.field, right.evidence.field)
    || compareText(left.targetPath, right.targetPath)
    || compareText(left.evidenceId, right.evidenceId));
  const relationshipsTruncated = allRelationships.length > maxRelationships;
  const relationships = allRelationships.slice(0, maxRelationships);
  const graphTruncated = graph.execution.status === "partial" || graph.execution.truncated;
  const partial = graphTruncated
    || relationshipsTruncated
    || missingText > 0
    || oversizedText > 0
    || invalidJson > 0
    || dynamicReference > 0;

  return {
    schema: "solvelang.repository-audit.framework-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: partial ? "partial" : "complete",
    relationships,
    skipped: { missingText, oversizedText, invalidJson, dynamicReference },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships,
      maxConfigTextBytes,
      relationshipsTruncated,
      acceptedFiles: acceptedPaths.size,
      frameworkFilesExamined,
      graphTruncated,
    },
  };
}
