import {
  solveGraphNodeKinds,
  type SolveGraphNode,
  type SolveGraphNodeKind,
} from "./contracts";
import type { SolveGraphQueryIndex } from "./query-impact";

const nodeKindSet = new Set<string>(solveGraphNodeKinds);
const HARD_MAX_RESULTS = 1_000;
const MAX_QUERY_TEXT = 512;

export type SolveGraphRankedNodeMatchReason =
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

export type SolveGraphRankedNodeSearchOptions = {
  kinds?: readonly SolveGraphNodeKind[];
  limit?: number;
};

export type SolveGraphRankedNodeMatch = {
  node: SolveGraphNode;
  score: number;
  reasons: SolveGraphRankedNodeMatchReason[];
};

export type SolveGraphRankedNodeSearchResult = {
  schema: "solvelang.solve-graph.ranked-node-search.v0";
  mode: "analyze-only";
  graphId: string;
  query: string;
  matches: SolveGraphRankedNodeMatch[];
  truncated: boolean;
  execution: {
    networkAccess: false;
    writeAccess: false;
    limit: number;
    candidatesExamined: number;
  };
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function normalizedQuery(value: string): string {
  if (typeof value !== "string") throw new Error("Solve Graph ranked query must be a string.");
  const query = normalize(value);
  if (!query) throw new Error("Solve Graph ranked query must not be empty.");
  if (query.length > MAX_QUERY_TEXT) throw new Error(`Solve Graph ranked query must not exceed ${MAX_QUERY_TEXT} characters.`);
  return query;
}

function boundedLimit(value: number | undefined): number {
  const resolved = value ?? 50;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > HARD_MAX_RESULTS) {
    throw new Error(`Solve Graph ranked query limit must be an integer from 1 through ${HARD_MAX_RESULTS}.`);
  }
  return resolved;
}

function normalizedKinds(values: readonly SolveGraphNodeKind[] | undefined): Set<SolveGraphNodeKind> | undefined {
  if (values === undefined) return undefined;
  const result = new Set<SolveGraphNodeKind>();
  for (const value of values) {
    if (!nodeKindSet.has(value)) throw new Error(`Solve Graph ranked node kind is invalid: ${value}`);
    result.add(value);
  }
  return result;
}

function basename(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
}

function addReason(
  reasons: Set<SolveGraphRankedNodeMatchReason>,
  reason: SolveGraphRankedNodeMatchReason,
  score: number,
  state: { score: number },
): void {
  if (reasons.has(reason)) return;
  reasons.add(reason);
  state.score += score;
}

function scoreNode(node: SolveGraphNode, query: string): SolveGraphRankedNodeMatch | undefined {
  const reasons = new Set<SolveGraphRankedNodeMatchReason>();
  const state = { score: 0 };
  const label = normalize(node.label);
  const identity = normalize(node.identity);

  if (label === query) addReason(reasons, "exact-label", 100, state);
  else if (label.startsWith(query)) addReason(reasons, "label-prefix", 70, state);
  else if (label.includes(query)) addReason(reasons, "label-substring", 45, state);

  if (identity === query) addReason(reasons, "exact-identity", 95, state);
  else if (identity.startsWith(query)) addReason(reasons, "identity-prefix", 65, state);
  else if (identity.includes(query)) addReason(reasons, "identity-substring", 40, state);

  for (const evidence of node.evidence) {
    const path = normalize(evidence.path);
    if (path === query) addReason(reasons, "evidence-path-exact", 60, state);
    else if (normalize(basename(evidence.path)) === query) addReason(reasons, "evidence-path-basename", 50, state);
    else if (path.includes(query)) addReason(reasons, "evidence-path-substring", 25, state);
  }

  for (const value of Object.values(node.metadata ?? {})) {
    if (typeof value !== "string") continue;
    const metadata = normalize(value);
    if (metadata === query) addReason(reasons, "metadata-exact", 35, state);
    else if (metadata.includes(query)) addReason(reasons, "metadata-substring", 15, state);
  }

  if (reasons.size === 0) return undefined;
  return {
    node,
    score: state.score,
    reasons: [...reasons].sort(compareText),
  };
}

function compareMatches(left: SolveGraphRankedNodeMatch, right: SolveGraphRankedNodeMatch): number {
  return right.score - left.score
    || compareText(left.node.kind, right.node.kind)
    || compareText(left.node.label, right.node.label)
    || compareText(left.node.id, right.node.id);
}

export function searchSolveGraphNodesRanked(
  index: SolveGraphQueryIndex,
  text: string,
  options: SolveGraphRankedNodeSearchOptions = {},
): SolveGraphRankedNodeSearchResult {
  const query = normalizedQuery(text);
  const limit = boundedLimit(options.limit);
  const kinds = normalizedKinds(options.kinds);
  const candidates = index.document.nodes.filter((node) => !kinds || kinds.has(node.kind));
  const allMatches = candidates.flatMap((node) => {
    const match = scoreNode(node, query);
    return match ? [match] : [];
  }).sort(compareMatches);

  return {
    schema: "solvelang.solve-graph.ranked-node-search.v0",
    mode: "analyze-only",
    graphId: index.document.graphId,
    query,
    matches: allMatches.slice(0, limit),
    truncated: allMatches.length > limit,
    execution: {
      networkAccess: false,
      writeAccess: false,
      limit,
      candidatesExamined: candidates.length,
    },
  };
}
