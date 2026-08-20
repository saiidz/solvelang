import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson } from "./canonical";
import type {
  SolveGraphQueryIndex,
  SolveGraphTraversalEntry,
  SolveGraphTraversalResult,
} from "./query-impact";

export type SolveGraphImpactArtifact = {
  schema: "solvelang.solve-graph.impact-artifact.v1";
  schemaVersion: "1.0.0";
  mode: "analyze-only";
  graphId: string;
  query: SolveGraphTraversalResult;
  execution: { networkAccess: false; writeAccess: false };
  integrity: { canonicalJsonSha256: string };
};

export type SolveGraphImpactDownload = {
  filename: string;
  mediaType: "application/json;charset=utf-8";
  content: string;
  artifact: SolveGraphImpactArtifact;
};

const HARD_MAX_QUERY_ENTRIES = 10_000;
const HARD_MAX_DEPTH = 64;
const encoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertResult(index: SolveGraphQueryIndex, query: SolveGraphTraversalResult): void {
  if (query.direction !== "dependents") {
    throw new Error("Solve Graph impact artifact requires dependent traversal evidence.");
  }
  if (query.roots.length === 0) {
    throw new Error("Solve Graph impact artifact requires at least one root.");
  }
  const normalizedRoots = [...new Set(query.roots)].sort(compareText);
  if (normalizedRoots.length !== query.roots.length
    || normalizedRoots.some((root, rootIndex) => root !== query.roots[rootIndex])) {
    throw new Error("Solve Graph impact artifact roots are not canonical.");
  }
  for (const root of query.roots) {
    if (!index.nodesById.has(root)) {
      throw new Error(`Solve Graph impact artifact root does not exist: ${root}`);
    }
  }
  if (query.entries.length === 0 || query.entries.length > HARD_MAX_QUERY_ENTRIES) {
    throw new Error("Solve Graph impact artifact query entry count is invalid.");
  }
  if (query.truncationReason !== undefined
    && query.truncationReason !== "depth"
    && query.truncationReason !== "result-count") {
    throw new Error("Solve Graph impact artifact truncation reason is invalid.");
  }
  if (query.truncated !== (query.truncationReason !== undefined)) {
    throw new Error("Solve Graph impact artifact truncation metadata is inconsistent.");
  }

  const entryById = new Map<string, SolveGraphTraversalEntry>();
  const edgeById = new Map(index.document.edges.map((edge) => [edge.id, edge] as const));
  const rootSet = new Set(query.roots);

  for (const entry of query.entries) {
    if (entryById.has(entry.id)) {
      throw new Error(`Solve Graph impact artifact contains duplicate traversal entry: ${entry.id}`);
    }
    if (!index.nodesById.has(entry.id)) {
      throw new Error(`Solve Graph impact artifact traversal node does not exist: ${entry.id}`);
    }
    if (!rootSet.has(entry.rootId)) {
      throw new Error("Solve Graph impact artifact traversal entry has an unknown root.");
    }
    if (!Number.isSafeInteger(entry.depth) || entry.depth < 0 || entry.depth > HARD_MAX_DEPTH) {
      throw new Error("Solve Graph impact artifact traversal depth is invalid.");
    }

    if (entry.depth === 0) {
      if (entry.id !== entry.rootId || entry.parentId !== undefined || entry.viaEdgeId !== undefined) {
        throw new Error("Solve Graph impact artifact root entry is malformed.");
      }
    } else {
      if (!entry.parentId || !entry.viaEdgeId) {
        throw new Error("Solve Graph impact artifact non-root entry is missing traversal evidence.");
      }
      const parent = entryById.get(entry.parentId);
      if (!parent || parent.depth + 1 !== entry.depth || parent.rootId !== entry.rootId) {
        throw new Error("Solve Graph impact artifact parent chain is invalid.");
      }
      const edge = edgeById.get(entry.viaEdgeId);
      if (!edge || edge.from !== entry.id || edge.to !== entry.parentId) {
        throw new Error("Solve Graph impact artifact edge traversal is invalid.");
      }
    }
    entryById.set(entry.id, entry);
  }

  for (const root of query.roots) {
    const entry = entryById.get(root);
    if (!entry || entry.depth !== 0 || entry.rootId !== root) {
      throw new Error("Solve Graph impact artifact is missing a canonical root entry.");
    }
  }
}

function unsignedArtifact(index: SolveGraphQueryIndex, query: SolveGraphTraversalResult) {
  assertResult(index, query);
  return {
    schema: "solvelang.solve-graph.impact-artifact.v1" as const,
    schemaVersion: "1.0.0" as const,
    mode: "analyze-only" as const,
    graphId: index.document.graphId,
    query: {
      direction: query.direction,
      roots: [...query.roots],
      entries: query.entries.map((entry) => ({ ...entry })),
      truncated: query.truncated,
      ...(query.truncationReason ? { truncationReason: query.truncationReason } : {}),
    },
    execution: { networkAccess: false as const, writeAccess: false as const },
  };
}

export async function createSolveGraphImpactArtifact(
  index: SolveGraphQueryIndex,
  query: SolveGraphTraversalResult,
): Promise<SolveGraphImpactArtifact> {
  const unsigned = unsignedArtifact(index, query);
  return {
    ...unsigned,
    integrity: {
      canonicalJsonSha256: `sha256:${await sha256Hex(encoder.encode(canonicalSolveGraphJson(unsigned)))}`,
    },
  };
}

export async function createSolveGraphImpactDownload(
  sourceName: string,
  index: SolveGraphQueryIndex,
  query: SolveGraphTraversalResult,
): Promise<SolveGraphImpactDownload> {
  const artifact = await createSolveGraphImpactArtifact(index, query);
  return {
    filename: `${sourceName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "solve-graph"}-impact.json`,
    mediaType: "application/json;charset=utf-8",
    content: `${canonicalSolveGraphJson(artifact)}\n`,
    artifact,
  };
}
