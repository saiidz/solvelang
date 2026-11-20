// Solve Context Index — persistent index format (Phase 7).
//
// The index is a content-derived document: it contains no timestamps and
// no random identifiers, so two runs that reach the same workspace state
// produce byte-identical index files. That property is what lets an
// incremental refresh be proven equal to a full build.
//
// Files (all inside the workspace's .solve/ directory by default):
//   context-index.json        this document (records + graph reference)
//   context-index.graph.json  the serialized Solve Graph document, exactly
//                             as the repository's own extractor produced it
//                             (serializeSolveGraphDocument); the builder
//                             verified the engine's integrity hash before
//                             writing it, and this document pins the file's
//                             SHA-256 so readers can verify the bytes.
//   context-index.state.json  a stat cache (size + mtime + hash per file)
//                             used by refresh as a change-detection fast
//                             path. It is a cache, not part of the index
//                             identity: losing it only costs a re-hash.

import { createHash } from "node:crypto";

export const CONTEXT_INDEX_SCHEMA = "solvelang.context.index.v1" as const;
export const CONTEXT_INDEX_STATE_SCHEMA = "solvelang.context.index-state.v1" as const;
export const CONTEXT_INDEX_FILE = "context-index.json";
export const CONTEXT_INDEX_GRAPH_FILE = "context-index.graph.json";
export const CONTEXT_INDEX_STATE_FILE = "context-index.state.json";
export const CONTEXT_INDEX_TOOL_NAME = "solvelang-context-index";
export const CONTEXT_INDEX_TOOL_VERSION = "0.1.0";

export interface ContextIndexRecord {
  /** Workspace-relative POSIX path. */
  path: string;
  /** SHA-256 of the file's bytes; null only for size-only entries above the walk read cap. */
  sha256: string | null;
  bytes: number;
  /** RepositoryFileClass from the repository-audit inventory classifier. */
  classification: string;
  /** Sorted unique content tokens (identifiers and their parts), capped. Empty for oversize records. */
  terms: string[];
  /** Sorted unique declared symbol names from a heuristic declaration scan. Empty for oversize records. */
  declarations: string[];
  /** Sorted unique workspace paths this file imports, projected from the Solve Graph. */
  imports: string[];
  /** True when the file exceeds the context-pack source cap (2 MB): it is indexed but never excerpted. */
  oversize: boolean;
}

export interface ContextIndexCounts {
  walkedFiles: number;
  records: number;
  skippedSensitive: number;
  skippedUnsupported: number;
  skippedEmpty: number;
  /** Paths of indexed-but-oversize files (above the 2 MB pack source cap), sorted. */
  skippedOversize: string[];
}

export interface ContextIndex {
  schema: typeof CONTEXT_INDEX_SCHEMA;
  tool: { name: string; version: string };
  source: { displayName: string; revision: string; fingerprint: string };
  graph: {
    file: string;
    sha256: string;
    graphId: string;
    status: "complete" | "partial";
    nodes: number;
    edges: number;
  };
  counts: ContextIndexCounts;
  records: ContextIndexRecord[];
  /** SHA-256 of canonicalContextIndexJson(index without this field). */
  indexSha256: string;
}

export interface ContextIndexStateEntry {
  bytes: number;
  mtimeMs: number;
  sha256: string | null;
}

export interface ContextIndexState {
  schema: typeof CONTEXT_INDEX_STATE_SCHEMA;
  files: Record<string, ContextIndexStateEntry>;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function canonicalRecord(record: ContextIndexRecord): ContextIndexRecord {
  return {
    path: record.path,
    sha256: record.sha256,
    bytes: record.bytes,
    classification: record.classification,
    terms: [...record.terms],
    declarations: [...record.declarations],
    imports: [...record.imports],
    oversize: record.oversize,
  };
}

/**
 * Canonical JSON for hashing: fixed key order, records sorted by path.
 * Used identically by the builder (to stamp indexSha256) and by readers
 * (to verify it). The MCP server's loader carries the same projection as
 * the schema contract; the CLI tests round-trip through that loader.
 */
export function canonicalContextIndexJson(index: Omit<ContextIndex, "indexSha256">): string {
  const records = [...index.records].map(canonicalRecord)
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return JSON.stringify({
    schema: index.schema,
    tool: { name: index.tool.name, version: index.tool.version },
    source: {
      displayName: index.source.displayName,
      revision: index.source.revision,
      fingerprint: index.source.fingerprint,
    },
    graph: {
      file: index.graph.file,
      sha256: index.graph.sha256,
      graphId: index.graph.graphId,
      status: index.graph.status,
      nodes: index.graph.nodes,
      edges: index.graph.edges,
    },
    counts: {
      walkedFiles: index.counts.walkedFiles,
      records: index.counts.records,
      skippedSensitive: index.counts.skippedSensitive,
      skippedUnsupported: index.counts.skippedUnsupported,
      skippedEmpty: index.counts.skippedEmpty,
      skippedOversize: [...index.counts.skippedOversize],
    },
    records,
  });
}

export function computeContextIndexSha256(index: Omit<ContextIndex, "indexSha256">): string {
  return sha256Hex(canonicalContextIndexJson(index));
}
