export const SOLVE_GRAPH_SCHEMA = "solvelang.graph.v0" as const;
export const SOLVE_GRAPH_ENGINE = "SolveLang Solve Graph" as const;

export const solveGraphNodeKinds = [
  "repository",
  "directory",
  "file",
  "module",
  "symbol",
  "function",
  "class",
  "type",
  "route",
  "test",
  "dependency",
  "workflow",
  "job",
  "resource",
  "permission",
  "document",
] as const;

export const solveGraphEdgeKinds = [
  "contains",
  "imports",
  "calls",
  "references",
  "reads",
  "writes",
  "exposes",
  "deploys",
  "grants",
  "tests",
  "depends-on",
  "triggers",
] as const;

export const solveGraphEvidenceKinds = [
  "compiler",
  "parser",
  "manifest",
  "workflow",
  "configuration",
  "deterministic-analysis",
] as const;

export type SolveGraphNodeKind = typeof solveGraphNodeKinds[number];
export type SolveGraphEdgeKind = typeof solveGraphEdgeKinds[number];
export type SolveGraphEvidenceKind = typeof solveGraphEvidenceKinds[number];
export type SolveGraphMetadataValue = string | number | boolean;
export type SolveGraphMetadata = Readonly<Record<string, SolveGraphMetadataValue>>;

export type SolveGraphEvidence = {
  kind: SolveGraphEvidenceKind;
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  note?: string;
};

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

export type SolveGraphExtractor = {
  id: string;
  version: string;
  deterministic: true;
};

export type SolveGraphSource = {
  kind: "repository";
  displayName: string;
  fingerprint: string;
  revision: string;
  private: boolean;
};

export type SolveGraphScanLimits = {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  maxEvidencePerElement: number;
  maxMetadataEntries: number;
  maxMetadataStringBytes: number;
  maxIdentityBytes: number;
};

export type SolveGraphDocument = {
  schema: typeof SOLVE_GRAPH_SCHEMA;
  graphId: string;
  mode: "analyze-only";
  engine: {
    name: typeof SOLVE_GRAPH_ENGINE;
    version: string;
    deterministic: true;
  };
  source: SolveGraphSource;
  extractors: SolveGraphExtractor[];
  limits: SolveGraphScanLimits;
  execution: {
    status: "complete" | "partial";
    truncated: boolean;
    truncationReasons: SolveGraphTruncationReason[];
    networkAccess: false;
    writeAccess: false;
  };
  nodes: SolveGraphNode[];
  edges: SolveGraphEdge[];
  integrity: {
    canonicalJsonSha256: string;
    stableIds: true;
    ordering: "id-ascending";
  };
};

export type SolveGraphTruncationReason =
  | "file-count"
  | "total-bytes"
  | "file-size"
  | "depth"
  | "node-count"
  | "edge-count"
  | "evidence-count"
  | "metadata-count";

export type SolveGraphScanFile = {
  path: string;
  byteSize: number;
};

export type SolveGraphScanSkip = SolveGraphScanFile & {
  reason: "file-count" | "total-bytes" | "file-size" | "depth";
};

export type SolveGraphScanPlan = {
  status: "complete" | "partial";
  accepted: SolveGraphScanFile[];
  skipped: SolveGraphScanSkip[];
  totalAcceptedBytes: number;
  truncationReasons: Array<SolveGraphScanSkip["reason"]>;
};
