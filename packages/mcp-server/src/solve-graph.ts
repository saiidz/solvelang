import { createHash } from "node:crypto";

export const SOLVE_GRAPH_SCHEMA = "solvelang.graph.v0" as const;
export const SOLVE_GRAPH_TOOL_API_VERSION = "1.0.0" as const;
export const MAX_SOLVE_GRAPH_BYTES = 2 * 1024 * 1024;
export const MAX_SOLVE_GRAPH_ROOTS = 128;

export const solveGraphNodeKinds = [
  "repository", "directory", "file", "module", "symbol", "function", "class", "type",
  "route", "test", "dependency", "workflow", "job", "resource", "permission", "document",
] as const;

export const solveGraphEdgeKinds = [
  "contains", "imports", "calls", "references", "reads", "writes", "exposes", "deploys",
  "grants", "tests", "depends-on", "triggers",
] as const;

export const defaultSolveGraphImpactEdgeKinds = [
  "imports", "calls", "references", "reads", "writes", "exposes", "deploys", "grants",
  "tests", "depends-on", "triggers",
] as const;

export type SolveGraphNodeKind = typeof solveGraphNodeKinds[number];
export type SolveGraphEdgeKind = typeof solveGraphEdgeKinds[number];

type SolveGraphEvidence = { path: string; [key: string]: unknown };
type SolveGraphMetadata = Record<string, string | number | boolean>;

export type SolveGraphNode = {
  id: string;
  kind: SolveGraphNodeKind;
  identity: string;
  label: string;
  evidence: SolveGraphEvidence[];
  metadata?: SolveGraphMetadata;
};

export type SolveGraphEdge = {
  id: string;
  kind: SolveGraphEdgeKind;
  from: string;
  to: string;
  qualifier?: string;
  evidence: SolveGraphEvidence[];
  metadata?: SolveGraphMetadata;
};

export type SolveGraphDocument = {
  schema: typeof SOLVE_GRAPH_SCHEMA;
  graphId: string;
  mode: "analyze-only";
  engine: { name: string; version: string; deterministic: true };
  source: { fingerprint: string; [key: string]: unknown };
  extractors: unknown[];
  limits: Record<string, unknown>;
  execution: { networkAccess: false; writeAccess: false; [key: string]: unknown };
  nodes: SolveGraphNode[];
  edges: SolveGraphEdge[];
  integrity: { canonicalJsonSha256: string; stableIds: true; ordering: "id-ascending" };
  [key: string]: unknown;
};

export type SolveGraphNodeQuery = {
  kinds?: readonly SolveGraphNodeKind[];
  text?: string;
  evidencePath?: string;
  limit?: number;
};

export type SolveGraphTraversalOptions = {
  edgeKinds?: readonly SolveGraphEdgeKind[];
  maxDepth?: number;
  maxResults?: number;
};

export type SolveGraphToolRequest =
  | { tool: "solve_graph.find_nodes"; query?: SolveGraphNodeQuery }
  | { tool: "solve_graph.dependencies"; rootIds: readonly string[]; options?: SolveGraphTraversalOptions }
  | { tool: "solve_graph.dependents"; rootIds: readonly string[]; options?: SolveGraphTraversalOptions }
  | { tool: "solve_graph.impact"; changedNodeIds: readonly string[]; options?: SolveGraphTraversalOptions };

export type SolveGraphToolNode = {
  id: string;
  kind: SolveGraphNodeKind;
  label: string;
  path?: string;
  packageName?: string;
};

export type SolveGraphToolTraversalEntry = {
  id: string;
  depth: number;
  rootId: string;
  parentId?: string;
  viaEdgeId?: string;
  viaEdgeKind?: SolveGraphEdgeKind;
  node: SolveGraphToolNode;
};

export type SolveGraphToolResponse =
  | {
      apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
      tool: "solve_graph.find_nodes";
      graphId: string;
      nodes: SolveGraphToolNode[];
      truncated: boolean;
    }
  | {
      apiVersion: typeof SOLVE_GRAPH_TOOL_API_VERSION;
      tool: "solve_graph.dependencies" | "solve_graph.dependents" | "solve_graph.impact";
      graphId: string;
      roots: string[];
      entries: SolveGraphToolTraversalEntry[];
      truncated: boolean;
      truncationReason?: "depth" | "result-count";
    };

const nodeKindSet = new Set<string>(solveGraphNodeKinds);
const edgeKindSet = new Set<string>(solveGraphEdgeKinds);
const NODE_ID_PATTERN = /^sgn_[a-f0-9]{32}$/;
const EDGE_ID_PATTERN = /^sge_[a-f0-9]{32}$/;
const GRAPH_ID_PATTERN = /^sg_[a-f0-9]{32}$/;
const MAX_QUERY_RESULTS = 10_000;
const MAX_QUERY_DEPTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalSolveGraphJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Solve Graph canonical JSON cannot encode undefined values.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSolveGraphJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSolveGraphJson(item)}`).join(",")}}`;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalSolveGraphJson(value), "utf8").digest("hex");
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Solve Graph ${label} is invalid.`);
  return value;
}

function requireEvidence(value: unknown, label: string): SolveGraphEvidence[] {
  if (!Array.isArray(value)) throw new Error(`Solve Graph ${label} evidence must be an array.`);
  return value.map((item) => {
    if (!isRecord(item) || typeof item.path !== "string" || item.path.length === 0) {
      throw new Error(`Solve Graph ${label} evidence is invalid.`);
    }
    return item as SolveGraphEvidence;
  });
}

function optionalMetadata(value: unknown, label: string): SolveGraphMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Solve Graph ${label} metadata must be an object.`);
  for (const item of Object.values(value)) {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
      throw new Error(`Solve Graph ${label} metadata contains an unsupported value.`);
    }
  }
  return value as SolveGraphMetadata;
}

function validateStableNodeId(node: SolveGraphNode): void {
  const expected = `sgn_${sha256Canonical({ schema: SOLVE_GRAPH_SCHEMA, kind: node.kind, identity: node.identity }).slice(0, 32)}`;
  if (node.id !== expected) throw new Error(`Solve Graph node ID does not match its identity: ${node.id}`);
}

function validateStableEdgeId(edge: SolveGraphEdge): void {
  const expected = `sge_${sha256Canonical({
    schema: SOLVE_GRAPH_SCHEMA,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
    qualifier: edge.qualifier ?? "",
  }).slice(0, 32)}`;
  if (edge.id !== expected) throw new Error(`Solve Graph edge ID does not match its identity: ${edge.id}`);
}

function parseNode(value: unknown): SolveGraphNode {
  if (!isRecord(value)) throw new Error("Solve Graph node must be an object.");
  const id = requireString(value, "id", "node ID");
  const kind = requireString(value, "kind", "node kind");
  if (!NODE_ID_PATTERN.test(id)) throw new Error(`Solve Graph node ID is invalid: ${id}`);
  if (!nodeKindSet.has(kind)) throw new Error(`Solve Graph node kind is invalid: ${kind}`);
  const node: SolveGraphNode = {
    id,
    kind: kind as SolveGraphNodeKind,
    identity: requireString(value, "identity", "node identity"),
    label: requireString(value, "label", "node label"),
    evidence: requireEvidence(value.evidence, "node"),
    ...(value.metadata === undefined ? {} : { metadata: optionalMetadata(value.metadata, "node") }),
  };
  validateStableNodeId(node);
  return node;
}

function parseEdge(value: unknown): SolveGraphEdge {
  if (!isRecord(value)) throw new Error("Solve Graph edge must be an object.");
  const id = requireString(value, "id", "edge ID");
  const kind = requireString(value, "kind", "edge kind");
  if (!EDGE_ID_PATTERN.test(id)) throw new Error(`Solve Graph edge ID is invalid: ${id}`);
  if (!edgeKindSet.has(kind)) throw new Error(`Solve Graph edge kind is invalid: ${kind}`);
  const qualifier = value.qualifier;
  if (qualifier !== undefined && typeof qualifier !== "string") throw new Error("Solve Graph edge qualifier is invalid.");
  const edge: SolveGraphEdge = {
    id,
    kind: kind as SolveGraphEdgeKind,
    from: requireString(value, "from", "edge source"),
    to: requireString(value, "to", "edge target"),
    ...(typeof qualifier === "string" ? { qualifier } : {}),
    evidence: requireEvidence(value.evidence, "edge"),
    ...(value.metadata === undefined ? {} : { metadata: optionalMetadata(value.metadata, "edge") }),
  };
  validateStableEdgeId(edge);
  return edge;
}

export function parseSolveGraphText(text: string): SolveGraphDocument {
  if (Buffer.byteLength(text, "utf8") > MAX_SOLVE_GRAPH_BYTES) throw new Error("The Solve Graph exceeds the 2 MB safety limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The Solve Graph JSON is malformed.");
  }
  if (!isRecord(parsed)) throw new Error("Solve Graph input must be a JSON object.");
  if (parsed.schema !== SOLVE_GRAPH_SCHEMA) throw new Error(`Unsupported Solve Graph schema: ${String(parsed.schema)}`);
  if (parsed.mode !== "analyze-only") throw new Error("Solve Graph MCP accepts analyze-only documents only.");
  if (!GRAPH_ID_PATTERN.test(String(parsed.graphId ?? ""))) throw new Error("Solve Graph graphId is invalid.");
  if (!isRecord(parsed.engine) || parsed.engine.deterministic !== true || typeof parsed.engine.version !== "string") {
    throw new Error("Solve Graph engine metadata is invalid.");
  }
  if (!isRecord(parsed.source) || typeof parsed.source.fingerprint !== "string") throw new Error("Solve Graph source metadata is invalid.");
  if (!Array.isArray(parsed.extractors) || !isRecord(parsed.limits)) throw new Error("Solve Graph extractor or limit metadata is invalid.");
  if (!isRecord(parsed.execution) || parsed.execution.networkAccess !== false || parsed.execution.writeAccess !== false) {
    throw new Error("Solve Graph MCP requires networkAccess=false and writeAccess=false.");
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("Solve Graph nodes and edges must be arrays.");
  if (!isRecord(parsed.integrity)
    || typeof parsed.integrity.canonicalJsonSha256 !== "string"
    || parsed.integrity.stableIds !== true
    || parsed.integrity.ordering !== "id-ascending") {
    throw new Error("Solve Graph integrity metadata is invalid.");
  }

  const { integrity, ...withoutIntegrity } = parsed;
  const expectedIntegrity = `sha256:${sha256Canonical({
    ...withoutIntegrity,
    integrity: { stableIds: true, ordering: "id-ascending" },
  })}`;
  if (integrity.canonicalJsonSha256 !== expectedIntegrity) throw new Error("Solve Graph integrity verification failed.");

  const expectedGraphId = `sg_${sha256Canonical({
    schema: SOLVE_GRAPH_SCHEMA,
    sourceFingerprint: parsed.source.fingerprint,
    engineVersion: parsed.engine.version,
    extractors: parsed.extractors,
    limits: parsed.limits,
  }).slice(0, 32)}`;
  if (parsed.graphId !== expectedGraphId) throw new Error("Solve Graph graphId does not match canonical source metadata.");

  const nodes = parsed.nodes.map(parseNode);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Solve Graph contains duplicate node ID: ${node.id}`);
    nodeIds.add(node.id);
  }
  const edges = parsed.edges.map(parseEdge);
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Solve Graph contains duplicate edge ID: ${edge.id}`);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Solve Graph edge ${edge.id} references a missing node.`);
    edgeIds.add(edge.id);
  }

  return { ...parsed, nodes, edges } as SolveGraphDocument;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return resolved;
}

function normalizedText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 2_048) throw new Error(`${label} is empty or too large.`);
  return normalized;
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

function requireKinds(values: readonly string[] | undefined, allowed: ReadonlySet<string>, label: string): Set<string> | undefined {
  if (values === undefined) return undefined;
  const result = new Set<string>();
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`Solve Graph ${label} is invalid: ${value}`);
    result.add(value);
  }
  return result;
}

function requireRoots(document: SolveGraphDocument, values: readonly string[], label: string): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`Solve Graph ${label} must contain at least one node ID.`);
  if (values.length > MAX_SOLVE_GRAPH_ROOTS) throw new Error(`Solve Graph ${label} exceeds ${MAX_SOLVE_GRAPH_ROOTS} roots.`);
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const roots = [...new Set(values)].sort(compareText);
  for (const id of roots) {
    if (!NODE_ID_PATTERN.test(id) || !nodeIds.has(id)) throw new Error(`Solve Graph traversal root does not exist: ${id}`);
  }
  return roots;
}

function findNodes(document: SolveGraphDocument, query: SolveGraphNodeQuery = {}): SolveGraphToolResponse {
  const kinds = requireKinds(query.kinds, nodeKindSet, "node kind");
  const text = normalizedText(query.text, "Solve Graph query text")?.toLocaleLowerCase("en-US");
  const evidencePath = normalizedText(query.evidencePath, "Solve Graph evidence path");
  const limit = boundedInteger(query.limit, 100, 1, MAX_QUERY_RESULTS, "Solve Graph query limit");
  const matches = document.nodes.filter((node) => {
    if (kinds && !kinds.has(node.kind)) return false;
    if (text && !`${node.label}\n${node.identity}`.normalize("NFC").toLocaleLowerCase("en-US").includes(text)) return false;
    if (evidencePath && !node.evidence.some((evidence) => evidence.path === evidencePath)) return false;
    return true;
  }).slice(0, limit);
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool: "solve_graph.find_nodes",
    graphId: document.graphId,
    nodes: matches.map(safeNode),
    truncated: matches.length >= limit && document.nodes.length > matches.length,
  };
}

type TraversalDirection = "dependencies" | "dependents";
type TraversalEntry = { id: string; depth: number; rootId: string; parentId?: string; viaEdgeId?: string };

function traverse(
  document: SolveGraphDocument,
  rootsInput: readonly string[],
  direction: TraversalDirection,
  options: SolveGraphTraversalOptions = {},
): { roots: string[]; entries: TraversalEntry[]; truncated: boolean; truncationReason?: "depth" | "result-count" } {
  const roots = requireRoots(document, rootsInput, "roots");
  const edgeKinds = requireKinds(options.edgeKinds, edgeKindSet, "edge kind");
  const maxDepth = boundedInteger(options.maxDepth, 8, 0, MAX_QUERY_DEPTH, "Solve Graph query maxDepth");
  const maxResults = boundedInteger(options.maxResults, 1_000, 1, MAX_QUERY_RESULTS, "Solve Graph traversal maxResults");
  const outgoing = new Map<string, SolveGraphEdge[]>();
  const incoming = new Map<string, SolveGraphEdge[]>();
  for (const node of document.nodes) { outgoing.set(node.id, []); incoming.set(node.id, []); }
  for (const edge of document.edges) { outgoing.get(edge.from)!.push(edge); incoming.get(edge.to)!.push(edge); }
  for (const edges of [...outgoing.values(), ...incoming.values()]) edges.sort((a, b) => compareText(a.id, b.id));

  const entries: TraversalEntry[] = [];
  const visited = new Set<string>();
  const queue: TraversalEntry[] = roots.map((id) => ({ id, depth: 0, rootId: id }));
  let depthBoundaryReached = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (entries.length >= maxResults) return { roots, entries, truncated: true, truncationReason: "result-count" };
    entries.push(current);
    const candidateEdges = (direction === "dependencies" ? outgoing.get(current.id)! : incoming.get(current.id)!)
      .filter((edge) => !edgeKinds || edgeKinds.has(edge.kind));
    const neighbor = (edge: SolveGraphEdge) => direction === "dependencies" ? edge.to : edge.from;
    if (current.depth >= maxDepth) {
      if (candidateEdges.some((edge) => !visited.has(neighbor(edge)))) depthBoundaryReached = true;
      continue;
    }
    for (const edge of candidateEdges) {
      const neighborId = neighbor(edge);
      if (visited.has(neighborId) || queue.some((entry) => entry.id === neighborId)) continue;
      queue.push({ id: neighborId, depth: current.depth + 1, rootId: current.rootId, parentId: current.id, viaEdgeId: edge.id });
    }
  }
  return { roots, entries, truncated: depthBoundaryReached, ...(depthBoundaryReached ? { truncationReason: "depth" as const } : {}) };
}

function traversalResponse(
  document: SolveGraphDocument,
  tool: "solve_graph.dependencies" | "solve_graph.dependents" | "solve_graph.impact",
  roots: readonly string[],
  direction: TraversalDirection,
  options: SolveGraphTraversalOptions,
): SolveGraphToolResponse {
  const result = traverse(document, roots, direction, options);
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(document.edges.map((edge) => [edge.id, edge]));
  return {
    apiVersion: SOLVE_GRAPH_TOOL_API_VERSION,
    tool,
    graphId: document.graphId,
    roots: result.roots,
    entries: result.entries.map((entry) => {
      const node = nodesById.get(entry.id)!;
      const edge = entry.viaEdgeId ? edgesById.get(entry.viaEdgeId) : undefined;
      return {
        id: entry.id,
        depth: entry.depth,
        rootId: entry.rootId,
        ...(entry.parentId ? { parentId: entry.parentId } : {}),
        ...(entry.viaEdgeId ? { viaEdgeId: entry.viaEdgeId } : {}),
        ...(edge ? { viaEdgeKind: edge.kind } : {}),
        node: safeNode(node),
      };
    }),
    truncated: result.truncated,
    ...(result.truncationReason ? { truncationReason: result.truncationReason } : {}),
  };
}

export function executeSolveGraphTool(document: SolveGraphDocument, request: SolveGraphToolRequest): SolveGraphToolResponse {
  if (request.tool === "solve_graph.find_nodes") return findNodes(document, request.query);
  if (request.tool === "solve_graph.dependencies") {
    return traversalResponse(document, request.tool, request.rootIds, "dependencies", request.options ?? {});
  }
  if (request.tool === "solve_graph.dependents") {
    return traversalResponse(document, request.tool, request.rootIds, "dependents", request.options ?? {});
  }
  return traversalResponse(document, request.tool, request.changedNodeIds, "dependents", {
    ...request.options,
    edgeKinds: request.options?.edgeKinds ?? defaultSolveGraphImpactEdgeKinds,
  });
}
