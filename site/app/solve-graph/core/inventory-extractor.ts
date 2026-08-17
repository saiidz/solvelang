import {
  classifyRepositoryFile,
  type RepositorySnapshot,
} from "../../repository-audit/core/inventory";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "./canonical";
import type {
  SolveGraphDocument,
  SolveGraphEdge,
  SolveGraphNode,
  SolveGraphScanLimits,
  SolveGraphTruncationReason,
} from "./contracts";
import {
  defaultSolveGraphScanLimits,
  normalizeSolveGraphPath,
  planBoundedSolveGraphScan,
  validateSolveGraphScanLimits,
} from "./limits";

export const repositoryInventoryExtractor = Object.freeze({
  id: "repository-inventory",
  version: "1.0.0",
  deterministic: true as const,
});

export type ExtractRepositoryInventoryGraphOptions = {
  limits?: SolveGraphScanLimits;
  privateSource?: boolean;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directoryPaths(path: string): string[] {
  const parts = path.split("/");
  const directories: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }
  return directories;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

export async function extractRepositoryInventoryGraph(
  snapshot: RepositorySnapshot,
  options: ExtractRepositoryInventoryGraphOptions = {},
): Promise<SolveGraphDocument> {
  const limits = validateSolveGraphScanLimits(options.limits ?? defaultSolveGraphScanLimits);
  const plan = planBoundedSolveGraphScan(snapshot.files, limits);
  const filesByPath = new Map(snapshot.files.map((file) => [normalizeSolveGraphPath(file.path), file]));

  const nodes: SolveGraphNode[] = [];
  const edges: SolveGraphEdge[] = [];
  const directoryIds = new Map<string, string>();
  const truncationReasons = new Set<SolveGraphTruncationReason>(plan.truncationReasons);

  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: `repository:${snapshot.source.fingerprint}`,
    label: snapshot.source.displayName,
    evidence: [],
    metadata: {
      sourceKind: snapshot.source.kind,
      revision: snapshot.source.revision,
    },
  }, limits);
  nodes.push(repository);

  for (const plannedFile of plan.accepted) {
    const sourceFile = filesByPath.get(plannedFile.path);
    if (!sourceFile) throw new Error(`Solve Graph inventory source disappeared during extraction: ${plannedFile.path}`);

    const directories = directoryPaths(plannedFile.path);
    const missingDirectories = directories.filter((path) => !directoryIds.has(path));
    const requiredNodes = missingDirectories.length + 1;
    const requiredEdges = requiredNodes;

    if (nodes.length + requiredNodes > limits.maxNodes) {
      truncationReasons.add("node-count");
      continue;
    }
    if (edges.length + requiredEdges > limits.maxEdges) {
      truncationReasons.add("edge-count");
      continue;
    }

    let parentId = repository.id;
    for (const directoryPath of directories) {
      const existingId = directoryIds.get(directoryPath);
      if (existingId) {
        parentId = existingId;
        continue;
      }

      const directory = await createSolveGraphNode({
        kind: "directory",
        identity: `directory:${directoryPath}`,
        label: basename(directoryPath),
        evidence: [{ kind: "deterministic-analysis", path: directoryPath }],
        metadata: { path: directoryPath },
      }, limits);
      const contains = await createSolveGraphEdge({
        kind: "contains",
        from: parentId,
        to: directory.id,
        evidence: [{ kind: "deterministic-analysis", path: directoryPath }],
      }, limits);
      nodes.push(directory);
      edges.push(contains);
      directoryIds.set(directoryPath, directory.id);
      parentId = directory.id;
    }

    const metadata: Record<string, string | number | boolean> = {
      path: plannedFile.path,
      byteSize: plannedFile.byteSize,
      fileClass: classifyRepositoryFile(sourceFile),
    };
    if (sourceFile.generated !== undefined) metadata.generated = sourceFile.generated;
    if (sourceFile.sha256 !== undefined) metadata.contentSha256 = sourceFile.sha256;

    const file = await createSolveGraphNode({
      kind: "file",
      identity: `file:${plannedFile.path}`,
      label: basename(plannedFile.path),
      evidence: [{ kind: "deterministic-analysis", path: plannedFile.path }],
      metadata,
    }, limits);
    const contains = await createSolveGraphEdge({
      kind: "contains",
      from: parentId,
      to: file.id,
      evidence: [{ kind: "deterministic-analysis", path: plannedFile.path }],
    }, limits);
    nodes.push(file);
    edges.push(contains);
  }

  const orderedReasons = [...truncationReasons].sort(compareText);
  return createSolveGraphDocument({
    source: {
      kind: "repository",
      displayName: snapshot.source.displayName,
      fingerprint: snapshot.source.fingerprint,
      revision: snapshot.source.revision,
      private: options.privateSource ?? true,
    },
    extractors: [repositoryInventoryExtractor],
    limits,
    status: orderedReasons.length === 0 ? "complete" : "partial",
    truncationReasons: orderedReasons,
    nodes,
    edges,
  });
}
