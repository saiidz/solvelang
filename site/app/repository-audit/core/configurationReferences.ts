import type { SolveGraphDocument, SolveGraphNode } from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";
import {
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositoryConfigurationReferenceKind =
  | "package-entrypoint"
  | "github-local-action";

export type RepositoryConfigurationTargetState =
  | "present"
  | "outside-bounded-scan"
  | "missing";

export type RepositoryConfigurationReference = {
  referenceId: string;
  kind: RepositoryConfigurationReferenceKind;
  fromPath: string;
  rawReference: string;
  targetPath?: string;
  targetState: RepositoryConfigurationTargetState;
  evidence: {
    path: string;
    line?: number;
    field?: string;
  };
};

export type RepositoryConfigurationReferenceAnalysis = {
  schema: "solvelang.repository-audit.configuration-references.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "partial";
  references: RepositoryConfigurationReference[];
  skipped: {
    missingText: number;
    oversizedText: number;
    invalidJson: number;
  };
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxReferences: number;
    maxConfigTextBytes: number;
    referencesTruncated: boolean;
    acceptedFiles: number;
    configurationFilesExamined: number;
    graphTruncated: boolean;
  };
};

export type RepositoryConfigurationReferenceOptions = {
  maxReferences?: number;
  maxConfigTextBytes?: number;
};

const packageEntrypointFields = ["main", "module", "types", "typings"] as const;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
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

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function isWorkflowPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith(".github/workflows/") && (lower.endsWith(".yml") || lower.endsWith(".yaml"));
}

function resolveRelativePath(baseDirectory: string, rawReference: string): string | undefined {
  if (!rawReference || rawReference.includes("\0") || rawReference.includes("\\")) return undefined;
  if (rawReference.startsWith("/") || /^[A-Za-z]:/.test(rawReference) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawReference)) return undefined;
  const parts = baseDirectory ? baseDirectory.split("/") : [];
  for (const segment of rawReference.split("/")) {
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

function sameSource(snapshot: RepositorySnapshot, graph: SolveGraphDocument): boolean {
  return snapshot.source.displayName === graph.source.displayName
    && snapshot.source.revision === graph.source.revision
    && snapshot.source.fingerprint === graph.source.fingerprint;
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function makeReferenceId(kind: RepositoryConfigurationReferenceKind, fromPath: string, rawReference: string, field?: string): string {
  return `config-ref:${kind}:${fromPath}:${field ?? "line"}:${rawReference}`;
}

function targetState(targetPath: string, snapshotPaths: ReadonlySet<string>, acceptedPaths: ReadonlySet<string>): RepositoryConfigurationTargetState {
  if (acceptedPaths.has(targetPath)) return "present";
  if (snapshotPaths.has(targetPath)) return "outside-bounded-scan";
  return "missing";
}

function packageReferences(
  path: string,
  file: RepositoryFileInput,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): { references: RepositoryConfigurationReference[]; invalidJson: boolean } {
  let parsed: unknown;
  try { parsed = JSON.parse(file.text ?? ""); } catch { return { references: [], invalidJson: true }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { references: [], invalidJson: true };
  const record = parsed as Record<string, unknown>;
  const values: Array<{ field: string; value: string }> = [];
  for (const field of packageEntrypointFields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) values.push({ field, value });
  }
  const bin = record.bin;
  if (typeof bin === "string" && bin.length > 0) values.push({ field: "bin", value: bin });
  else if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    for (const [name, value] of Object.entries(bin as Record<string, unknown>).sort(([left], [right]) => compareText(left, right))) {
      if (typeof value === "string" && value.length > 0) values.push({ field: `bin.${name}`, value });
    }
  }
  const baseDirectory = dirname(path);
  return {
    invalidJson: false,
    references: values.flatMap(({ field, value }) => {
      const targetPath = resolveRelativePath(baseDirectory, value);
      if (!targetPath) return [];
      return [{
        referenceId: makeReferenceId("package-entrypoint", path, value, field),
        kind: "package-entrypoint" as const,
        fromPath: path,
        rawReference: value,
        targetPath,
        targetState: targetState(targetPath, snapshotPaths, acceptedPaths),
        evidence: { path, field },
      }];
    }),
  };
}

function workflowReferences(
  path: string,
  file: RepositoryFileInput,
  snapshotPaths: ReadonlySet<string>,
  acceptedPaths: ReadonlySet<string>,
): RepositoryConfigurationReference[] {
  const references: RepositoryConfigurationReference[] = [];
  const lines = (file.text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*(?:-\s*)?uses:\s*["']?(\.\/[^"'#\s]+)["']?\s*(?:#.*)?$/.exec(lines[index]);
    if (!match) continue;
    const rawReference = match[1];
    const directory = resolveRelativePath("", rawReference);
    if (!directory) continue;
    const actionCandidates = [`${directory}/action.yml`, `${directory}/action.yaml`];
    const targetPath = actionCandidates.find((candidate) => snapshotPaths.has(candidate));
    references.push({
      referenceId: makeReferenceId("github-local-action", path, rawReference, `line-${index + 1}`),
      kind: "github-local-action",
      fromPath: path,
      rawReference,
      ...(targetPath ? { targetPath } : {}),
      targetState: targetPath ? targetState(targetPath, snapshotPaths, acceptedPaths) : "missing",
      evidence: { path, line: index + 1 },
    });
  }
  return references;
}

export async function createRepositoryConfigurationReferenceAnalysis(
  snapshot: RepositorySnapshot,
  graph: SolveGraphDocument,
  options: RepositoryConfigurationReferenceOptions = {},
): Promise<RepositoryConfigurationReferenceAnalysis> {
  const maxReferences = boundedInteger(options.maxReferences, 250, 1, 2_000, "Repository configuration maxReferences");
  const maxConfigTextBytes = boundedInteger(options.maxConfigTextBytes, 1024 * 1024, 1, 10 * 1024 * 1024, "Repository configuration maxConfigTextBytes");
  await createSolveGraphQueryIndex(graph);
  if (!sameSource(snapshot, graph)) throw new Error("Repository configuration evidence source does not match the bounded Solve Graph source.");

  const filesByPath = new Map<string, RepositoryFileInput>();
  for (const file of snapshot.files) {
    const path = normalizeRepositoryPath(file.path);
    if (filesByPath.has(path)) throw new Error(`Repository configuration evidence received duplicate path: ${path}`);
    filesByPath.set(path, { ...file, path });
  }
  const snapshotPaths = new Set(filesByPath.keys());
  const acceptedPaths = new Set(graph.nodes.filter((node) => node.kind === "file").map(pathForNode).filter((path): path is string => typeof path === "string" && path.length > 0).map(normalizeRepositoryPath));

  let missingText = 0;
  let oversizedText = 0;
  let invalidJson = 0;
  let configurationFilesExamined = 0;
  const allReferences: RepositoryConfigurationReference[] = [];

  for (const path of [...acceptedPaths].sort(compareText)) {
    if (basename(path).toLowerCase() !== "package.json" && !isWorkflowPath(path)) continue;
    configurationFilesExamined += 1;
    const file = filesByPath.get(path);
    if (!file) throw new Error(`Bounded Solve Graph references an unavailable repository file: ${path}`);
    if (typeof file.text !== "string") { missingText += 1; continue; }
    if (textBytes(file.text) > maxConfigTextBytes) { oversizedText += 1; continue; }
    if (basename(path).toLowerCase() === "package.json") {
      const result = packageReferences(path, file, snapshotPaths, acceptedPaths);
      if (result.invalidJson) invalidJson += 1;
      allReferences.push(...result.references);
    } else allReferences.push(...workflowReferences(path, file, snapshotPaths, acceptedPaths));
  }

  allReferences.sort((left, right) => compareText(left.fromPath, right.fromPath) || compareText(left.kind, right.kind) || compareText(left.rawReference, right.rawReference) || compareText(left.referenceId, right.referenceId));
  return {
    schema: "solvelang.repository-audit.configuration-references.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: graph.execution.truncated || graph.execution.status === "partial" ? "partial" : "complete",
    references: allReferences.slice(0, maxReferences),
    skipped: { missingText, oversizedText, invalidJson },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxReferences,
      maxConfigTextBytes,
      referencesTruncated: allReferences.length > maxReferences,
      acceptedFiles: acceptedPaths.size,
      configurationFilesExamined,
      graphTruncated: graph.execution.truncated,
    },
  };
}
