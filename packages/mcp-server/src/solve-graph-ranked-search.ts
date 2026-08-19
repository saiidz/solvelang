import {
  SOLVE_GRAPH_TOOL_API_VERSION,
  solveGraphNodeKinds,
  type SolveGraphDocument,
  type SolveGraphNode,
  type SolveGraphNodeKind,
  type SolveGraphToolNode,
} from "./solve-graph.js";

export const MAX_SOLVE_GRAPH_RANKED_QUERY_BYTES = 512;
export const MAX_SOLVE_GRAPH_RANKED_RESULTS = 1_000;

export type SolveGraphRankedMatchReason =
  | "exact-label"
  | "exact-identity"
  | "label-prefix"
  | "identity-prefix"
  | "label-substring"
  | "identity-substring"
  | "evidence-path-exact"
  | "evidence-path-basename"
  | "evidence-path-substring"
  | "metadata-exact"
  | "metadata-substring";

export type SolveGraphRankedSearchResponse = {
  apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
  tool: "solve_graph.search_nodes";
  graphId: string;
  query: string;
  matches: Array<{
    node: SolveGraphToolNode;
    score: number;
    reasons: SolveGraphRankedMatchReason[];
  }>;
  truncated: boolean;
  execution: {
    networkAccess: false;
    writeAccess: false;
    candidatesExamined: number;
    limit: number;
  };
};

const nodeKindSet = new Set<string>(solveGraphNodeKinds);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function safeNode(node: SolveGraphNode): SolveGraphToolNode {
  const path = node.metadata?.path;
  const packageName = node.metadata?.packageName;
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof packageName === "string" ? { packageName } : {}),
  };
}

function boundedLimit(value: number | undefined): number {
  const resolved = value ?? 50;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_SOLVE_GRAPH_RANKED_RESULTS) {
    throw new Error(`Solve Graph ranked search limit must be an integer from 1 through ${MAX_SOLVE_GRAPH_RANKED_RESULTS}.`);
  }
  return resolved;
}

function normalizedQuery(value: string): string {
  if (typeof value !== "string") throw new Error("Solve Graph ranked search query must be a string.");
  const query = normalize(value);
  if (!query) throw new Error("Solve Graph ranked search query must not be empty.");
  if (Buffer.byteLength(query, "utf8") > MAX_SOLVE_GRAPH_RANKED_QUERY_BYTES) {
    throw new Error(`Solve Graph ranked search query exceeds ${MAX_SOLVE_GRAPH_RANKED_QUERY_BYTES} bytes.`);
  }
  return query;
}

function normalizedKinds(values: readonly SolveGraphNodeKind[] | undefined): Set<SolveGraphNodeKind> | undefined {
  if (values === undefined) return undefined;
  const result = new Set<SolveGraphNodeKind>();
  for (const value of values) {
    if (!nodeKindSet.has(value)) throw new Error(`Solve Graph ranked search node kind is invalid: ${value}`);
    result.add(value);
  }
  return result;
}

function scoreNode(node: SolveGraphNode, query: string) {
  const scores = new Map<SolveGraphRankedMatchReason, number>();
  const label = normalize(node.label);
  const identity = normalize(node.identity);

  if (label === query) scores.set("exact-label", 100);
  else if (label.startsWith(query)) scores.set("label-prefix", 70);
  else if (label.includes(query)) scores.set("label-substring", 45);

  if (identity === query) scores.set("exact-identity", 95);
  else if (identity.startsWith(query)) scores.set("identity-prefix", 65);
  else if (identity.includes(query)) scores.set("identity-substring", 40);

  for (const evidence of node.evidence) {
    const path = normalize(evidence.path);
    if (path === query) scores.set("evidence-path-exact", 60);
    else if (normalize(basename(evidence.path)) === query) scores.set("evidence-path-basename", 50);
    else if (path.includes(query)) scores.set("evidence-path-substring", 25);
  }

  for (const value of Object.values(node.metadata ?? {})) {
    if (typeof value !== "string") continue;
    const metadata = normalize(value);
    if (metadata === query) scores.set("metadata-exact", 35);
    else if (metadata.includes(query)) scores.set("metadata-substring", 15);
  }

  if (scores.size === 0) return undefined;
  return {
    node: safeNode(node),
    score: [...scores.values()].reduce((sum, value) => sum + value, 0),
    reasons: [...scores.keys()].sort(compareText),
  };
}

export function searchSolveGraphNodesRanked(
  document: SolveGraphDocument,
  queryText: string,
  options: { kinds?: readonly SolveGraphNodeKind[]; limit?: number } = {},
): SolveGraphRankedSearchResponse {
  if (document.mode !== "analyze-only" || document.execution.networkAccess !== false || document.execution.writeAccess !== false) {
    throw new Error("Solve Graph ranked search requires an analyze-only document with networkAccess=false and writeAccess=false.");
  }
  const query = normalizedQuery(queryText);
  const limit = boundedLimit(options.limit);
  const kinds = normalizedKinds(options.kinds);
  const candidates = document.nodes.filter((node) => !kinds || kinds.has(node.kind));
  const allMatches = candidates.flatMap((node) => {
    const match = scoreNode(node, query);
    return match ? [match] : [];
  }).sort((left, right) => right.score - left.score
    || compareText(left.node.kind, right.node.kind)
    || compareText(left.node.label, right.node.label)
    || compareText(left.node.id, right.node.id));

  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.search_nodes",
    graphId: document.graphId,
    query,
    matches: allMatches.slice(0, limit),
    truncated: allMatches.length > limit,
    execution: {
      networkAccess: false,
      writeAccess: false,
      candidatesExamined: candidates.length,
      limit,
    },
  };
}
