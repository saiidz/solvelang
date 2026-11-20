// Solve Context Index — query side (Phase 7).
//
// The persistent index (built by the solvelang-context-index CLI into
// .solve/context-index.json + .solve/context-index.graph.json) lets a
// task query be answered WITHOUT re-walking the workspace: candidate
// files are ranked from the index records, the top candidates are read
// and hash-verified against the index, and the excerpts are produced by
// the existing context-pack machinery (buildContextPack), so the pack
// format is byte-for-byte the format the rest of Solve Context emits.
//
// Ranking is lexical + graph-structure, stated plainly: path and content
// term scoring (the same style as the pack engine's own scoring),
// declaration identifier overlap (a task token naming a file's declared
// symbol is the strongest per-file signal), and a one-hop graph
// neighborhood boost from the stored Solve Graph (buildContextSelection
// over the index's graph). There are no embeddings, no vector store, no
// model calls, and no network access anywhere in this path.
//
// The graph file is verified against the SHA-256 recorded in the index
// (the builder verified the graph engine's own integrity hash before
// writing it) and parsed structurally. The 2 MB-capped MCP graph parser
// is deliberately not used here: index graphs of large repositories
// exceed that cap, and refusing them would make the index useless on
// exactly the repositories it exists for.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildContextPack,
  contextTaskTokens,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  MAX_CONTEXT_SOURCES,
  sha256Text,
  type ContextPack,
  type ContextSource,
} from "./context-pack.js";
import { buildContextSelection, type ContextSelection } from "./context-selection.js";
import type { SolveGraphDocument } from "./solve-graph.js";
import { readWorkspaceText, resolveWorkspaceFilePath } from "./workspace.js";

export const CONTEXT_INDEX_SCHEMA = "solvelang.context.index.v1" as const;
export const CONTEXT_INDEX_QUERY_SCHEMA = "solvelang.context.index-query.v1" as const;
export const CONTEXT_INDEX_DIR = ".solve";
export const CONTEXT_INDEX_FILE = "context-index.json";
export const CONTEXT_INDEX_GRAPH_FILE = "context-index.graph.json";
export const MAX_CONTEXT_INDEX_BYTES = 64 * 1024 * 1024;
export const MAX_CONTEXT_INDEX_GRAPH_BYTES = 64 * 1024 * 1024;

const MAX_INDEX_CANDIDATES = 160;
const MAX_INDEX_SEEDS = 48;
const MAX_INDEX_RANKED_REPORT = 25;
// Mirrors MAX_CONTEXT_DISCOVERY_BYTES in context-workspace.ts: the most
// source bytes a single selection pass will read.
const MAX_INDEX_READ_BYTES = 16 * 1024 * 1024;

export interface ContextIndexRecord {
  path: string;
  sha256: string | null;
  bytes: number;
  classification: string;
  terms: string[];
  declarations: string[];
  imports: string[];
  oversize: boolean;
}

export interface ContextIndexDocument {
  schema: typeof CONTEXT_INDEX_SCHEMA;
  tool: { name: string; version: string };
  source: { displayName: string; revision: string; fingerprint: string };
  graph: { file: string; sha256: string; graphId: string; status: "complete" | "partial"; nodes: number; edges: number };
  counts: {
    walkedFiles: number;
    records: number;
    skippedSensitive: number;
    skippedUnsupported: number;
    skippedEmpty: number;
    skippedOversize: string[];
  };
  records: ContextIndexRecord[];
  indexSha256: string;
}

export interface LoadedContextIndex {
  index: ContextIndexDocument;
  graph: SolveGraphDocument;
  indexBytes: number;
  graphBytes: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const next = haystack.indexOf(needle, offset);
    if (next < 0) return count;
    count += 1;
    offset = next + needle.length;
  }
}

// The canonical projection is the schema contract shared with the
// builder (packages/context-index/src/index-format.ts): fixed key order,
// records sorted by path. It is duplicated here deliberately — the MCP
// server is a self-contained published package and cannot import the
// private builder package; the CLI tests round-trip through this loader
// so the two implementations cannot drift silently.
export function canonicalContextIndexJson(index: Omit<ContextIndexDocument, "indexSha256">): string {
  const records = [...index.records]
    .map((record) => ({
      path: record.path,
      sha256: record.sha256,
      bytes: record.bytes,
      classification: record.classification,
      terms: [...record.terms],
      declarations: [...record.declarations],
      imports: [...record.imports],
      oversize: record.oversize,
    }))
    .sort((left, right) => compareText(left.path, right.path));
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

async function readIndexFile(relativePath: string, maxBytes: number, label: string): Promise<{ text: string; bytes: number }> {
  const absolutePath = await resolveWorkspaceFilePath(relativePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error(`The Solve Context ${label} is not a file.`);
  if (metadata.size > maxBytes) throw new Error(`The Solve Context ${label} exceeds the ${maxBytes} byte safety limit.`);
  const text = await readFile(absolutePath, "utf8");
  return { text, bytes: metadata.size };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIndexDocument(parsed: unknown): ContextIndexDocument {
  if (!isRecord(parsed)) throw new Error("The Solve Context index must be a JSON object.");
  if (parsed.schema !== CONTEXT_INDEX_SCHEMA) {
    throw new Error(`Unsupported Solve Context index schema: ${String(parsed.schema)}`);
  }
  if (!isRecord(parsed.tool) || typeof parsed.tool.name !== "string" || typeof parsed.tool.version !== "string") {
    throw new Error("The Solve Context index tool metadata is invalid.");
  }
  if (!isRecord(parsed.source) || typeof parsed.source.revision !== "string" || typeof parsed.source.fingerprint !== "string") {
    throw new Error("The Solve Context index source metadata is invalid.");
  }
  if (!isRecord(parsed.graph) || typeof parsed.graph.sha256 !== "string" || typeof parsed.graph.graphId !== "string"
    || typeof parsed.graph.file !== "string" || path.basename(parsed.graph.file) !== parsed.graph.file) {
    throw new Error("The Solve Context index graph reference is invalid.");
  }
  if (!Array.isArray(parsed.records)) throw new Error("The Solve Context index records must be an array.");
  for (const record of parsed.records) {
    if (!isRecord(record) || typeof record.path !== "string" || typeof record.bytes !== "number"
      || !(typeof record.sha256 === "string" || record.sha256 === null)
      || !Array.isArray(record.terms) || !Array.isArray(record.declarations) || !Array.isArray(record.imports)
      || typeof record.oversize !== "boolean" || typeof record.classification !== "string") {
      throw new Error("The Solve Context index contains an invalid record.");
    }
  }
  if (typeof parsed.indexSha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.indexSha256)) {
    throw new Error("The Solve Context index hash is invalid.");
  }
  const { indexSha256, ...withoutHash } = parsed as unknown as ContextIndexDocument;
  if (sha256Text(canonicalContextIndexJson(withoutHash)) !== indexSha256) {
    throw new Error("The Solve Context index hash does not match its contents; rebuild the index.");
  }
  return parsed as unknown as ContextIndexDocument;
}

function parseIndexGraph(text: string, expectedSha256: string): SolveGraphDocument {
  if (sha256Text(text) !== expectedSha256) {
    throw new Error("The Solve Context index graph does not match the hash recorded in the index; rebuild the index.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The Solve Context index graph JSON is malformed.");
  }
  if (!isRecord(parsed)) throw new Error("The Solve Context index graph must be a JSON object.");
  if (parsed.schema !== "solvelang.graph.v0") throw new Error("The Solve Context index graph schema is unsupported.");
  if (parsed.mode !== "analyze-only") throw new Error("The Solve Context index graph must be analyze-only.");
  if (!isRecord(parsed.execution) || parsed.execution.networkAccess !== false || parsed.execution.writeAccess !== false) {
    throw new Error("The Solve Context index graph must declare networkAccess=false and writeAccess=false.");
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error("The Solve Context index graph nodes and edges must be arrays.");
  }
  return parsed as unknown as SolveGraphDocument;
}

export async function loadContextIndex(): Promise<LoadedContextIndex> {
  const indexPath = `${CONTEXT_INDEX_DIR}/${CONTEXT_INDEX_FILE}`;
  let indexFile: { text: string; bytes: number };
  try {
    indexFile = await readIndexFile(indexPath, MAX_CONTEXT_INDEX_BYTES, "index");
  } catch {
    throw new Error(
      `No Solve Context index found at ${indexPath}. Build one with the solvelang-context-index CLI (build), then refresh it as the code changes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(indexFile.text);
  } catch {
    throw new Error("The Solve Context index JSON is malformed; rebuild the index.");
  }
  const index = validateIndexDocument(parsed);
  const graphPath = `${CONTEXT_INDEX_DIR}/${index.graph.file}`;
  const graphFile = await readIndexFile(graphPath, MAX_CONTEXT_INDEX_GRAPH_BYTES, "index graph");
  const graph = parseIndexGraph(graphFile.text, index.graph.sha256);
  return { index, graph, indexBytes: indexFile.bytes, graphBytes: graphFile.bytes };
}

export interface ContextIndexStatus {
  present: boolean;
  indexDir: string;
  schema?: string;
  tool?: { name: string; version: string };
  source?: ContextIndexDocument["source"];
  graph?: ContextIndexDocument["graph"] & { fileBytes: number; hashMatches: boolean };
  counts?: ContextIndexDocument["counts"];
  indexSha256?: string;
  indexHashValid?: boolean;
  indexBytes?: number;
  buildHint: string;
}

const BUILD_HINT = "Build with the solvelang-context-index CLI: `solvelang-context-index build` in the workspace root, then `refresh` as code changes.";

export async function contextIndexStatus(): Promise<ContextIndexStatus> {
  const indexPath = `${CONTEXT_INDEX_DIR}/${CONTEXT_INDEX_FILE}`;
  let absolutePath: string;
  try {
    absolutePath = await resolveWorkspaceFilePath(indexPath);
  } catch {
    return { present: false, indexDir: CONTEXT_INDEX_DIR, buildHint: BUILD_HINT };
  }
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size > MAX_CONTEXT_INDEX_BYTES) {
    return { present: false, indexDir: CONTEXT_INDEX_DIR, buildHint: BUILD_HINT };
  }
  const text = await readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { present: false, indexDir: CONTEXT_INDEX_DIR, buildHint: BUILD_HINT };
  }
  if (!isRecord(parsed) || parsed.schema !== CONTEXT_INDEX_SCHEMA) {
    return { present: false, indexDir: CONTEXT_INDEX_DIR, buildHint: BUILD_HINT };
  }
  const index = parsed as unknown as ContextIndexDocument;
  const { indexSha256, ...withoutHash } = index;
  let graphInfo: ContextIndexStatus["graph"];
  try {
    const graphFile = await readIndexFile(`${CONTEXT_INDEX_DIR}/${index.graph.file}`, MAX_CONTEXT_INDEX_GRAPH_BYTES, "index graph");
    graphInfo = { ...index.graph, fileBytes: graphFile.bytes, hashMatches: sha256Text(graphFile.text) === index.graph.sha256 };
  } catch {
    graphInfo = { ...index.graph, fileBytes: 0, hashMatches: false };
  }
  return {
    present: true,
    indexDir: CONTEXT_INDEX_DIR,
    schema: index.schema,
    tool: index.tool,
    source: index.source,
    graph: graphInfo,
    counts: index.counts,
    indexSha256,
    indexHashValid: sha256Text(canonicalContextIndexJson(withoutHash)) === indexSha256,
    indexBytes: metadata.size,
    buildHint: BUILD_HINT,
  };
}

interface RankedRecord {
  record: ContextIndexRecord;
  score: number;
  reasons: string[];
}

function declarationTokens(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return [name.toLowerCase(), ...spaced.split(/[\s_]+/).map((part) => part.toLowerCase())].filter((part) => part.length >= 2);
}

function scoreRecord(record: ContextIndexRecord, tokens: string[]): RankedRecord {
  const lowerPath = record.path.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  for (const token of tokens) {
    const pathHits = countOccurrences(lowerPath, token);
    if (pathHits > 0) {
      score += 6 * pathHits;
      reasons.push(`path:${token}`);
    }
  }
  const termSet = new Set(record.terms);
  const declarationSet = new Set<string>();
  for (const declaration of record.declarations) {
    for (const token of declarationTokens(declaration)) declarationSet.add(token);
  }
  for (const token of tokens) {
    if (declarationSet.has(token)) {
      score += 16;
      reasons.push(`declaration:${token}`);
    } else if (termSet.has(token)) {
      score += 2;
      reasons.push(`term:${token}`);
    }
  }
  return { record, score, reasons };
}

export interface ContextIndexQuery {
  schema: typeof CONTEXT_INDEX_QUERY_SCHEMA;
  index: {
    indexSha256: string;
    graphId: string;
    graphStatus: "complete" | "partial";
    sourceRevision: string;
    records: number;
  };
  selection: {
    candidateFiles: number;
    readFiles: number;
    graphHintsUsed: boolean;
    indexStale: boolean;
    stalePaths: string[];
    skippedOversize: string[];
    ranked: Array<{ path: string; score: number; reasons: string[] }>;
  };
  pack: ContextPack | null;
  packNote?: string;
}

export async function queryContextIndex(
  task: string,
  options: { budgetBytes?: number } = {},
): Promise<ContextIndexQuery> {
  const { index, graph } = await loadContextIndex();
  const tokens = contextTaskTokens(task);
  const recordsByPath = new Map(index.records.map((record) => [record.path, record]));

  const ranked = index.records
    .map((record) => scoreRecord(record, tokens))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareText(left.record.path, right.record.path));

  // One-hop graph neighborhood of the strongest lexical seeds, using the
  // pack machinery's own selection builder over the stored graph.
  let selection: ContextSelection | undefined;
  const seeds = ranked.slice(0, MAX_INDEX_SEEDS).map((entry) => entry.record.path);
  if (seeds.length > 0) {
    try {
      selection = buildContextSelection(seeds, {
        path: `${CONTEXT_INDEX_DIR}/${index.graph.file}`,
        sourceSha256: index.graph.sha256,
        document: graph,
      });
    } catch {
      selection = undefined;
    }
  }

  const candidatePaths = new Set<string>();
  for (const entry of ranked.slice(0, MAX_INDEX_CANDIDATES)) candidatePaths.add(entry.record.path);
  if (selection) {
    for (const hintedPath of selection.hints.keys()) {
      if (recordsByPath.has(hintedPath)) candidatePaths.add(hintedPath);
    }
  }
  if (candidatePaths.size === 0) {
    // No lexical or graph match: mirror discovery behavior and offer the
    // index's files in stable path order; the pack builder still decides
    // what (if anything) is excerpted.
    for (const record of index.records) candidatePaths.add(record.path);
  }

  const rankedByPath = new Map(ranked.map((entry) => [entry.record.path, entry]));
  const orderedCandidates = [...candidatePaths].sort((left, right) => {
    const hintDelta = (selection?.hints.get(right)?.score ?? 0) - (selection?.hints.get(left)?.score ?? 0);
    if (hintDelta !== 0) return hintDelta;
    const scoreDelta = (rankedByPath.get(right)?.score ?? 0) - (rankedByPath.get(left)?.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return compareText(left, right);
  });

  const sources: ContextSource[] = [];
  const stalePaths: string[] = [];
  const skippedOversize: string[] = [];
  let readBytes = 0;
  for (const candidatePath of orderedCandidates) {
    if (sources.length >= MAX_CONTEXT_SOURCES) break;
    const record = recordsByPath.get(candidatePath)!;
    if (record.oversize || record.bytes > MAX_INDEX_READ_BYTES) {
      skippedOversize.push(candidatePath);
      continue;
    }
    if (readBytes + record.bytes > MAX_INDEX_READ_BYTES) continue;
    let text: string;
    try {
      ({ text } = await readWorkspaceText(candidatePath));
    } catch {
      stalePaths.push(candidatePath);
      continue;
    }
    if (record.sha256 !== null && sha256Text(text) !== record.sha256) {
      stalePaths.push(candidatePath);
      continue;
    }
    readBytes += Buffer.byteLength(text, "utf8");
    const hint = selection?.hints.get(candidatePath);
    sources.push(hint ? { path: candidatePath, text, selection: hint } : { path: candidatePath, text });
  }

  const budgetBytes = options.budgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES;
  const pack = sources.length > 0 ? buildContextPack(task, sources, budgetBytes) : null;

  return {
    schema: CONTEXT_INDEX_QUERY_SCHEMA,
    index: {
      indexSha256: index.indexSha256,
      graphId: index.graph.graphId,
      graphStatus: index.graph.status,
      sourceRevision: index.source.revision,
      records: index.records.length,
    },
    selection: {
      candidateFiles: candidatePaths.size,
      readFiles: sources.length,
      graphHintsUsed: selection !== undefined,
      indexStale: stalePaths.length > 0,
      stalePaths: stalePaths.sort(compareText),
      skippedOversize: skippedOversize.sort(compareText),
      ranked: ranked.slice(0, MAX_INDEX_RANKED_REPORT).map((entry) => ({
        path: entry.record.path,
        score: entry.score,
        reasons: entry.reasons.slice(0, 8),
      })),
    },
    pack,
    ...(pack === null
      ? { packNote: "No index candidate could be read and hash-verified, so no pack was built. Refresh the index if the workspace changed." }
      : {}),
  };
}
