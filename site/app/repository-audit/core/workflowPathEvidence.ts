import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryWorkflowPathReferenceKind =
  | "working-directory"
  | "cache-dependency-path";

export type RepositoryWorkflowPathTargetState =
  | "present"
  | "outside-bounded-scan"
  | "missing";

export type RepositoryWorkflowPathReference = {
  referenceId: string;
  workflowPath: string;
  kind: RepositoryWorkflowPathReferenceKind;
  rawReference: string;
  targetPath: string;
  targetState: RepositoryWorkflowPathTargetState;
  evidence: {
    path: string;
    line: number;
  };
};

export type RepositoryWorkflowPathImpact = {
  targetPath: string;
  workflows: string[];
  referenceKinds: RepositoryWorkflowPathReferenceKind[];
};

export type RepositoryWorkflowPathEvidenceAnalysis = {
  schema: "solvelang.repository-audit.workflow-path-evidence.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  references: RepositoryWorkflowPathReference[];
  impacts: RepositoryWorkflowPathImpact[];
  skipped: {
    missingText: number;
    oversizedText: number;
    dynamicReferences: number;
    multilineReferences: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxReferences: number;
    maxWorkflowTextBytes: number;
    referencesTruncated: boolean;
    acceptedFiles: number;
    workflowFilesExamined: number;
    graphTruncated: boolean;
  };
};

export type RepositoryWorkflowPathEvidenceOptions = {
  maxReferences?: number;
  maxWorkflowTextBytes?: number;
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

function sameSource(snapshot: RepositorySnapshot, graph: SolveGraphDocument): boolean {
  return snapshot.source.displayName === graph.source.displayName
    && snapshot.source.revision === graph.source.revision
    && snapshot.source.fingerprint === graph.source.fingerprint;
}

function isWorkflowPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith(".github/workflows/") && (lower.endsWith(".yml") || lower.endsWith(".yaml"));
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function isDynamicOrPatternReference(value: string): boolean {
  return value.length === 0
    || value.includes("${{")
    || value.includes("$(")
    || /[*?{}[\]]/.test(value)
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function normalizeWorkflowReference(value: string): string | undefined {
  const stripped = stripOptionalQuotes(value);
  if (isDynamicOrPatternReference(stripped)) return undefined;
  try {
    return normalizeRepositoryPath(stripped);
  } catch {
    return undefined;
  }
}

function makeReferenceId(
  workflowPath: string,
  kind: RepositoryWorkflowPathReferenceKind,
  targetPath: string,
  line: number,
): string {
  return `workflow-path:${workflowPath}:${kind}:${line}:${targetPath}`;
}

function targetState(
  targetPath: string,
  kind: RepositoryWorkflowPathReferenceKind,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryWorkflowPathTargetState {
  if (kind === "cache-dependency-path") {
    if (acceptedPaths.has(targetPath)) return "present";
    if (snapshotPaths.has(targetPath)) return "outside-bounded-scan";
    return "missing";
  }

  const prefix = `${targetPath}/`;
  if ([...acceptedPaths].some((path) => path === targetPath || path.startsWith(prefix))) return "present";
  if ([...snapshotPaths].some((path) => path === targetPath || path.startsWith(prefix))) return "outside-bounded-scan";
  return "missing";
}

function parseWorkflowReferences(
  workflowPath: string,
  file: RepositoryFileInput,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): {
  references: RepositoryWorkflowPathReference[];
  dynamicReferences: number;
  multilineReferences: number;
} {
  const references: RepositoryWorkflowPathReference[] = [];
  let dynamicReferences = 0;
  let multilineReferences = 0;
  const lines = (file.text ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(working-directory|cache-dependency-path):\s*(.*?)\s*(?:#.*)?$/.exec(lines[index]);
    if (!match) continue;
    const kind = match[1] as RepositoryWorkflowPathReferenceKind;
    const rawValue = match[2].trim();
    if (["|", ">", "|-", ">-", "|+", ">+"].includes(rawValue)) {
      multilineReferences += 1;
      continue;
    }
    const targetPath = normalizeWorkflowReference(rawValue);
    if (!targetPath) {
      dynamicReferences += 1;
      continue;
    }
    const line = index + 1;
    references.push({
      referenceId: makeReferenceId(workflowPath, kind, targetPath, line),
      workflowPath,
      kind,
      rawReference: stripOptionalQuotes(rawValue),
      targetPath,
      targetState: targetState(targetPath, kind, snapshotPaths, acceptedPaths),
      evidence: { path: workflowPath, line },
    });
  }

  return { references, dynamicReferences, multilineReferences };
}

function createImpactIndex(references: readonly RepositoryWorkflowPathReference[]): RepositoryWorkflowPathImpact[] {
  const byTarget = new Map<string, { workflows: Set<string>; kinds: Set<RepositoryWorkflowPathReferenceKind> }>();
  for (const reference of references) {
    const current = byTarget.get(reference.targetPath) ?? {
      workflows: new Set<string>(),
      kinds: new Set<RepositoryWorkflowPathReferenceKind>(),
    };
    current.workflows.add(reference.workflowPath);
    current.kinds.add(reference.kind);
    byTarget.set(reference.targetPath, current);
  }

  return [...byTarget.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([targetPath, value]) => ({
      targetPath,
      workflows: [...value.workflows].sort(compareText),
      referenceKinds: [...value.kinds].sort(compareText),
    }));
}

export async function createRepositoryWorkflowPathEvidence(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryWorkflowPathEvidenceOptions = {},
): Promise<RepositoryWorkflowPathEvidenceAnalysis> {
  const maxReferences = boundedInteger(options.maxReferences, 250, 1, 2_000, "Repository workflow maxReferences");
  const maxWorkflowTextBytes = boundedInteger(
    options.maxWorkflowTextBytes,
    512 * 1024,
    1,
    5 * 1024 * 1024,
    "Repository workflow maxWorkflowTextBytes",
  );

  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) {
    throw new Error("Repository workflow path evidence source does not match the bounded Solve Graph source.");
  }

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) throw new Error(`Repository workflow path evidence received duplicate path: ${path}`);
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
  let dynamicReferences = 0;
  let multilineReferences = 0;
  let workflowFilesExamined = 0;
  const allReferences: RepositoryWorkflowPathReference[] = [];

  for (const workflowPath of [...acceptedPaths].filter(isWorkflowPath).sort(compareText)) {
    workflowFilesExamined += 1;
    const file = filesByPath.get(workflowPath);
    if (!file) throw new Error(`Bounded Solve Graph references an unavailable workflow file: ${workflowPath}`);
    if (typeof file.text !== "string") {
      missingText += 1;
      continue;
    }
    if (textBytes(file.text) > maxWorkflowTextBytes) {
      oversizedText += 1;
      continue;
    }

    const parsed = parseWorkflowReferences(workflowPath, file, snapshotPaths, acceptedPaths);
    dynamicReferences += parsed.dynamicReferences;
    multilineReferences += parsed.multilineReferences;
    allReferences.push(...parsed.references);
  }

  allReferences.sort((left, right) =>
    compareText(left.workflowPath, right.workflowPath)
    || left.evidence.line - right.evidence.line
    || compareText(left.kind, right.kind)
    || compareText(left.targetPath, right.targetPath));
  const references = allReferences.slice(0, maxReferences);

  return {
    schema: "solvelang.repository-audit.workflow-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: graph.execution.truncated || graph.execution.status === "partial" ? "partial" : "complete",
    references,
    impacts: createImpactIndex(references),
    skipped: { missingText, oversizedText, dynamicReferences, multilineReferences },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxReferences,
      maxWorkflowTextBytes,
      referencesTruncated: allReferences.length > maxReferences,
      acceptedFiles: acceptedPaths.size,
      workflowFilesExamined,
      graphTruncated: graph.execution.truncated,
    },
  };
}
