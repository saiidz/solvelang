import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryAngularTargetConfigTargetState =
  | "present"
  | "outside-bounded-scan"
  | "missing";

export type RepositoryAngularTargetConfigEvidence = {
  evidenceId: string;
  kind: "angular-target-tsconfig";
  framework: "angular";
  fromPath: string;
  project: string;
  target: string;
  rawReference: string;
  targetPath: string;
  targetState: RepositoryAngularTargetConfigTargetState;
  evidence: {
    path: string;
    field: string;
  };
};

export type RepositoryAngularTargetConfigEvidenceAnalysis = {
  schema: "solvelang.repository-audit.angular-target-config-evidence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  relationships: RepositoryAngularTargetConfigEvidence[];
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
    angularConfigsExamined: number;
    graphTruncated: boolean;
  };
};

export type RepositoryAngularTargetConfigEvidenceOptions = {
  maxRelationships?: number;
  maxConfigTextBytes?: number;
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

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function pathForNode(node: SolveGraphNode): string | undefined {
  const metadataPath = node.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) return metadataPath;
  return node.evidence[0]?.path;
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

function targetState(
  targetPath: string,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryAngularTargetConfigTargetState {
  if (acceptedPaths.has(targetPath)) return "present";
  if (snapshotPaths.has(targetPath)) return "outside-bounded-scan";
  return "missing";
}

function collectAngularTargetTsconfigValues(
  path: string,
  record: Record<string, unknown>,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { relationships: RepositoryAngularTargetConfigEvidence[]; dynamicReference: number } {
  const projects = record.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return { relationships: [], dynamicReference: 0 };
  }

  const baseDirectory = dirname(path);
  const relationships: RepositoryAngularTargetConfigEvidence[] = [];
  let dynamicReference = 0;

  for (const [projectName, projectValue] of Object.entries(projects as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))) {
    if (!projectValue || typeof projectValue !== "object" || Array.isArray(projectValue)) continue;
    const project = projectValue as Record<string, unknown>;
    const targetsValue = project.architect ?? project.targets;
    if (!targetsValue || typeof targetsValue !== "object" || Array.isArray(targetsValue)) continue;

    for (const [targetName, targetValue] of Object.entries(targetsValue as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))) {
      if (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue)) continue;
      const optionsValue = (targetValue as Record<string, unknown>).options;
      if (!optionsValue || typeof optionsValue !== "object" || Array.isArray(optionsValue)) continue;
      const tsConfig = (optionsValue as Record<string, unknown>).tsConfig;
      if (typeof tsConfig !== "string") continue;

      const resolved = resolveLocalPath(baseDirectory, tsConfig);
      if (!resolved) {
        dynamicReference += 1;
        continue;
      }
      const field = `projects.${projectName}.${targetName}.options.tsConfig`;
      relationships.push({
        evidenceId: `angular-target-tsconfig:${path}:${field}:${resolved}`,
        kind: "angular-target-tsconfig",
        framework: "angular",
        fromPath: path,
        project: projectName,
        target: targetName,
        rawReference: tsConfig,
        targetPath: resolved,
        targetState: targetState(resolved, snapshotPaths, acceptedPaths),
        evidence: { path, field },
      });
    }
  }

  return { relationships, dynamicReference };
}

export async function createRepositoryAngularTargetConfigEvidenceAnalysis(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryAngularTargetConfigEvidenceOptions = {},
): Promise<RepositoryAngularTargetConfigEvidenceAnalysis> {
  const maxRelationships = boundedInteger(
    options.maxRelationships,
    250,
    1,
    2_000,
    "Repository Angular target config maxRelationships",
  );
  const maxConfigTextBytes = boundedInteger(
    options.maxConfigTextBytes,
    1024 * 1024,
    1,
    10 * 1024 * 1024,
    "Repository Angular target config maxConfigTextBytes",
  );

  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) {
    throw new Error("Repository Angular target config evidence source does not match the bounded Solve Graph source.");
  }

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) {
      throw new Error(`Repository Angular target config evidence received duplicate path: ${path}`);
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
  let angularConfigsExamined = 0;
  const allRelationships: RepositoryAngularTargetConfigEvidence[] = [];

  for (const path of [...acceptedPaths].sort(compareText)) {
    if (basename(path).toLowerCase() !== "angular.json") continue;
    angularConfigsExamined += 1;
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text);
    } catch {
      invalidJson += 1;
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalidJson += 1;
      continue;
    }

    const result = collectAngularTargetTsconfigValues(
      path,
      parsed as Record<string, unknown>,
      snapshotPaths,
      acceptedPaths,
    );
    allRelationships.push(...result.relationships);
    dynamicReference += result.dynamicReference;
  }

  allRelationships.sort((left, right) => compareText(left.fromPath, right.fromPath)
    || compareText(left.project, right.project)
    || compareText(left.target, right.target)
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
    schema: "solvelang.repository-audit.angular-target-config-evidence.v0",
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
      angularConfigsExamined,
      graphTruncated,
    },
  };
}
