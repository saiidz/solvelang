import type {
  SolveGraphDocument,
  SolveGraphEdgeKind,
  SolveGraphNode,
} from "../../solve-graph/core/contracts";
import { createSolveGraphQueryIndex } from "../../solve-graph/core/query-impact";

export type RepositoryDeadCodeCandidate = {
  candidateId: string;
  nodeId: string;
  path: string;
  observedIncomingReferences: 0;
  observedOutgoingRelationships: number;
  basis: "no-observed-incoming-references";
};

export type RepositoryDeadCodeCandidateAnalysis = {
  schema: "solvelang.repository-audit.dead-code-candidates.v0";
  mode: "analyze-only";
  graphId: string;
  status: "complete" | "suppressed";
  suppressionReason?: "partial-graph" | "javascript-import-evidence-unavailable";
  candidates: RepositoryDeadCodeCandidate[];
  execution: {
    networkAccess: false;
    writeAccess: false;
    maxCandidates: number;
    candidatesTruncated: boolean;
    supportedExtensions: readonly string[];
    relationshipKinds: readonly SolveGraphEdgeKind[];
  };
};

export type RepositoryDeadCodeCandidateOptions = {
  maxCandidates?: number;
};

const supportedExtensions = Object.freeze(["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"] as const);
const supportedExtensionSet = new Set<string>(supportedExtensions);
const relationshipKinds = Object.freeze([
  "imports",
  "calls",
  "references",
  "tests",
  "depends-on",
] as const satisfies readonly SolveGraphEdgeKind[]);
const relationshipKindSet = new Set<SolveGraphEdgeKind>(relationshipKinds);
const entrypointBasenames = new Set([
  "app",
  "cli",
  "error",
  "index",
  "instrumentation",
  "layout",
  "loading",
  "main",
  "middleware",
  "not-found",
  "page",
  "route",
  "server",
  "template",
  "worker",
]);

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

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

function stem(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

function isFrameworkOrOperationalEntrypoint(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  if (entrypointBasenames.has(stem(lower))) return true;
  if (name.includes(".config.")) return true;
  if (name.endsWith(".d.ts")) return true;
  if (lower.startsWith("bin/") || lower.startsWith("scripts/") || lower.startsWith(".github/")) return true;
  return false;
}

function isEligibleSourceFile(node: SolveGraphNode): node is SolveGraphNode & { kind: "file" } {
  if (node.kind !== "file") return false;
  const path = pathForNode(node);
  if (!path || !supportedExtensionSet.has(extension(path))) return false;
  if (node.metadata?.fileClass !== "source") return false;
  if (node.metadata?.generated === true) return false;
  return !isFrameworkOrOperationalEntrypoint(path);
}

export async function createRepositoryDeadCodeCandidateAnalysis(
  document: SolveGraphDocument,
  options: RepositoryDeadCodeCandidateOptions = {},
): Promise<RepositoryDeadCodeCandidateAnalysis> {
  const maxCandidates = boundedInteger(options.maxCandidates, 100, 1, 1_000, "Repository dead-code maxCandidates");
  const index = await createSolveGraphQueryIndex(document);
  const base = {
    schema: "solvelang.repository-audit.dead-code-candidates.v0" as const,
    mode: "analyze-only" as const,
    graphId: document.graphId,
    execution: {
      networkAccess: false as const,
      writeAccess: false as const,
      maxCandidates,
      candidatesTruncated: false,
      supportedExtensions,
      relationshipKinds,
    },
  };

  if (document.execution.status !== "complete" || document.execution.truncated) {
    return {
      ...base,
      status: "suppressed",
      suppressionReason: "partial-graph",
      candidates: [],
    };
  }

  if (!document.extractors.some((extractor) => extractor.id === "javascript-imports")) {
    return {
      ...base,
      status: "suppressed",
      suppressionReason: "javascript-import-evidence-unavailable",
      candidates: [],
    };
  }

  const allCandidates = document.nodes
    .filter(isEligibleSourceFile)
    .map((node) => {
      const path = pathForNode(node)!;
      const incoming = (index.incomingByNodeId.get(node.id) ?? []).filter((edge) => relationshipKindSet.has(edge.kind));
      if (incoming.length > 0) return undefined;
      const outgoing = (index.outgoingByNodeId.get(node.id) ?? []).filter((edge) => relationshipKindSet.has(edge.kind));
      return {
        candidateId: `dead-code:${node.id}`,
        nodeId: node.id,
        path,
        observedIncomingReferences: 0 as const,
        observedOutgoingRelationships: outgoing.length,
        basis: "no-observed-incoming-references" as const,
      };
    })
    .filter((candidate): candidate is RepositoryDeadCodeCandidate => candidate !== undefined)
    .sort((left, right) => compareText(left.path, right.path) || compareText(left.nodeId, right.nodeId));

  return {
    ...base,
    status: "complete",
    candidates: allCandidates.slice(0, maxCandidates),
    execution: {
      ...base.execution,
      candidatesTruncated: allCandidates.length > maxCandidates,
    },
  };
}
