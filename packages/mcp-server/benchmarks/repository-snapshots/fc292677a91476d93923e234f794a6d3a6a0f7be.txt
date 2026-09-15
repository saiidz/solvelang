import {
  MAX_CONTEXT_SOURCES,
  normalizeContextPath,
  type ContextSourceSelection,
} from "./context-pack.js";
import type { SolveGraphDocument } from "./solve-graph.js";

export const MAX_CONTEXT_CHANGED_PATHS = 128;
export const MAX_CONTEXT_GRAPH_ROOTS = 128;
const RELATION_KINDS = new Set(["imports", "references", "calls", "tests", "depends-on"]);

export interface ContextSelectionGraph {
  path: string;
  sourceSha256: string;
  document: SolveGraphDocument;
}

export interface ContextSelectionMetadata {
  changedPaths: string[];
  prioritizedPaths: number;
  unmatchedChangedPaths: string[];
  graphRoots: number;
  rootsTruncated: boolean;
  candidatesTruncated: boolean;
  skippedGraphPaths: number;
  graph?: {
    path: string;
    sourceSha256: string;
    graphId: string;
    maxDepth: 1;
    workspaceFreshness: "not-verified";
  };
}

export interface ContextSelection {
  hints: Map<string, ContextSourceSelection>;
  metadata: ContextSelectionMetadata;
}

export function normalizeContextSelectionPath(value: string): string {
  if (typeof value !== "string" || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value) || /^[a-z]:/i.test(value)) {
    throw new Error("Context selection paths must be bounded workspace-relative paths.");
  }
  return normalizeContextPath(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Pure one-hop selection over an already integrity-validated snapshot; never executes Git or source. */
export function buildContextSelection(
  changedPaths: string[],
  graph?: ContextSelectionGraph,
  allowedPath: (inputPath: string) => boolean = () => true,
): ContextSelection {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0 || changedPaths.length > MAX_CONTEXT_CHANGED_PATHS) {
    throw new Error(`Context changedPaths must contain 1 through ${MAX_CONTEXT_CHANGED_PATHS} paths.`);
  }
  const changed = [...new Set(changedPaths.map(normalizeContextSelectionPath))].sort(compareText);
  if (changed.some((inputPath) => !allowedPath(inputPath))) {
    throw new Error("Context selection of sensitive paths is denied.");
  }
  const hints = new Map<string, ContextSourceSelection>(changed.map((inputPath) => [
    inputPath, { score: 128, reasons: ["explicit-changed-path"] },
  ]));
  const metadata: ContextSelectionMetadata = {
    changedPaths: changed,
    prioritizedPaths: hints.size,
    unmatchedChangedPaths: [],
    graphRoots: 0,
    rootsTruncated: false,
    candidatesTruncated: false,
    skippedGraphPaths: 0,
  };
  if (!graph) return { hints, metadata };
  if (!/^[a-f0-9]{64}$/.test(graph.sourceSha256)) throw new Error("Context graph source hash is invalid.");
  const graphPath = normalizeContextSelectionPath(graph.path);
  if (!allowedPath(graphPath)) throw new Error("Context graph access to sensitive paths is denied.");
  metadata.graph = {
    path: graphPath,
    sourceSha256: graph.sourceSha256,
    graphId: graph.document.graphId,
    maxDepth: 1,
    workspaceFreshness: "not-verified",
  };

  // Metadata paths are untrusted hints, not permission to open a file.
  // Workspace discovery/explicit allowlists and the existing reader remain authoritative.
  const nodePaths = new Map<string, string>();
  for (const node of graph.document.nodes) {
    if (typeof node.metadata?.path !== "string") continue;
    try {
      const inputPath = normalizeContextSelectionPath(node.metadata.path);
      if (!allowedPath(inputPath)) { metadata.skippedGraphPaths += 1; continue; }
      nodePaths.set(node.id, inputPath);
    } catch {
      metadata.skippedGraphPaths += 1;
    }
  }
  const changedSet = new Set(changed);
  const matchingRoots = [...nodePaths].filter(([, inputPath]) => changedSet.has(inputPath))
    .map(([id]) => id).sort(compareText);
  const roots = new Set(matchingRoots.slice(0, MAX_CONTEXT_GRAPH_ROOTS));
  const matchedPaths = new Set([...roots].map((id) => nodePaths.get(id)!));
  metadata.graphRoots = roots.size;
  metadata.rootsTruncated = matchingRoots.length > roots.size;
  metadata.unmatchedChangedPaths = changed.filter((inputPath) => !matchedPaths.has(inputPath));

  function offer(id: string, score: number, reason: string): void {
    const inputPath = nodePaths.get(id);
    if (!inputPath) return;
    const previous = hints.get(inputPath);
    if (previous && (previous.score > score || (previous.score === score && compareText(previous.reasons[0], reason) <= 0))) return;
    hints.set(inputPath, { score, reasons: [reason, `graph-sha256:${graph!.sourceSha256}`] });
  }

  for (const edge of graph.document.edges) {
    if (!RELATION_KINDS.has(edge.kind)) continue;
    if (roots.has(edge.from)) offer(edge.to, 64, `graph:dependency:${edge.kind}:${edge.id}`);
    if (roots.has(edge.to)) offer(edge.from, edge.kind === "tests" ? 96 : 48, `graph:dependent:${edge.kind}:${edge.id}`);
  }

  const ordered = [...hints].sort(([leftPath, left], [rightPath, right]) =>
    right.score - left.score || compareText(leftPath, rightPath));
  metadata.candidatesTruncated = ordered.length > MAX_CONTEXT_SOURCES;
  const bounded = new Map(ordered.slice(0, MAX_CONTEXT_SOURCES));
  metadata.prioritizedPaths = bounded.size;
  return { hints: bounded, metadata };
}
