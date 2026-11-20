// Solve Context Index — build and incremental refresh (Phase 7).
//
// Build walks a workspace once, with no caller planning and no task
// string: it ingests the tree with the repository-audit ingestion engine,
// builds the Solve Graph with the repository's own multi-language
// dependency extractor, and derives one index record per pack-eligible
// file (classification from the inventory classifier, content tokens and
// declared symbols from the file itself, imports projected from the
// graph). The result is written next to the serialized graph under
// .solve/ (see index-format.ts).
//
// Refresh is an explicit operation, not a manual full rebuild:
//   1. change detection is by content hash (a stat cache — size + mtime —
//      is only a fast path; any stat difference is hash-verified, and a
//      touched-but-identical file is not a change);
//   2. the affected scope is the changed files plus their dependents in
//      the stored graph (analyzeSolveGraphImpact over the previous
//      document), plus any caller-named paths (hash-verified like the
//      rest);
//   3. records inside the affected scope are recomputed from content;
//      records outside it are carried over untouched — and because a
//      record is a pure function of (path, bytes, classification,
//      projected imports), a refresh that reaches a tree state produces
//      an index identical to a full build of that state;
//   4. the graph document is re-derived with the repository's own
//      extractor on every refresh (never a second graph engine), and
//      records whose projected imports changed under the new graph are
//      updated and reported as edge-shifted.
// Oversize and binary handling follows the Phase 2 discipline: files are
// measured before they are read for excerpt purposes, and anything above
// a cap is skipped and listed, never fatal.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { ingestGitHubSnapshotEntries, type RepositorySnapshotEntry } from "../../../site/app/repository-audit/core/ingestion";
import { classifyRepositoryFile } from "../../../site/app/repository-audit/core/inventory";
import { extractRepositoryMultiLanguageDependencyGraph } from "../../../site/app/solve-graph/core/dependency-extractor";
import { serializeSolveGraphDocument, verifySolveGraphIntegrity } from "../../../site/app/solve-graph/core/canonical";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "../../../site/app/solve-graph/core/query-impact";
import type { SolveGraphDocument } from "../../../site/app/solve-graph/core/contracts";

import {
  CONTEXT_INDEX_FILE,
  CONTEXT_INDEX_GRAPH_FILE,
  CONTEXT_INDEX_SCHEMA,
  CONTEXT_INDEX_STATE_FILE,
  CONTEXT_INDEX_STATE_SCHEMA,
  CONTEXT_INDEX_TOOL_NAME,
  CONTEXT_INDEX_TOOL_VERSION,
  computeContextIndexSha256,
  sha256Hex,
  type ContextIndex,
  type ContextIndexRecord,
  type ContextIndexState,
} from "./index-format";

// Mirrors MAX_CONTEXT_SOURCE_BYTES in packages/mcp-server/src/context-pack.ts:
// the largest file the context-pack machinery will ever excerpt.
const PACK_FILE_MAX_BYTES = 2 * 1024 * 1024;
// Mirrors MAX_WALK_BYTES_PER_FILE in packages/pr-gate/src/cli.ts: files
// above this are carried as size-only entries (never read into memory).
const MAX_WALK_READ_BYTES = 8 * 1024 * 1024;
const MAX_TERMS_PER_FILE = 384;
const MAX_DECLARATIONS_PER_FILE = 256;

// Union of the directory sets the context discovery walk and the PR Gate
// walk refuse to descend into, so the index covers exactly the tree the
// pack machinery could ever see, minus the index's own output directory.
const SKIPPED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", ".next", ".nuxt", ".turbo", ".venv", "__pycache__",
  "build", "coverage", "dist", "node_modules", "out", "target", "vendor",
  ".pr-gate",
]);

// Mirrors isSensitivePath in packages/mcp-server/src/context-workspace.ts:
// sensitive paths are excluded from the snapshot and the records entirely
// (counted, never named), so secret material cannot leak into the index.
const SENSITIVE_DIRECTORIES = new Set([".aws", ".gnupg", ".kube", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json",
  "id_dsa", "id_ecdsa", "id_ed25519", "id_rsa", "secrets.json",
]);

export function isSensitiveContextPath(inputPath: string): boolean {
  const segments = inputPath.toLowerCase().split("/");
  const basename = segments[segments.length - 1];
  if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))) return true;
  if (SENSITIVE_FILENAMES.has(basename)) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  return basename.endsWith(".key") || basename.endsWith(".p12") || basename.endsWith(".pfx") || basename.endsWith(".pem");
}

// Mirrors DISCOVERABLE_EXTENSIONS / DISCOVERABLE_BASENAMES in
// packages/mcp-server/src/context-workspace.ts: the files the pack
// machinery treats as excerptable text sources.
const DISCOVERABLE_EXTENSIONS = new Set([
  ".bash", ".c", ".cc", ".cfg", ".cjs", ".conf", ".cpp", ".cs", ".css", ".csv",
  ".go", ".gql", ".graphql", ".h", ".hpp", ".htm", ".html", ".ini", ".java", ".js",
  ".json", ".jsx", ".kt", ".kts", ".less", ".md", ".mdx", ".mjs", ".php", ".proto",
  ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".solve", ".sql", ".svelte", ".swift",
  ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);
const DISCOVERABLE_BASENAMES = new Set(["Dockerfile", "Gemfile", "Justfile", "Makefile", "Procfile", "Rakefile"]);

function isDiscoverableTextPath(inputPath: string): boolean {
  const basename = inputPath.split("/").pop() ?? inputPath;
  if (DISCOVERABLE_BASENAMES.has(basename)) return true;
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && DISCOVERABLE_EXTENSIONS.has(basename.slice(dot).toLowerCase());
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface WalkedFile {
  path: string;
  absolute: string;
  bytes: number;
  mtimeMs: number;
  symlink: boolean;
}

async function walkWorkspace(root: string, outDirAbsolute: string): Promise<WalkedFile[]> {
  const walked: WalkedFile[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(child.name)) continue;
        if (absolute === outDirAbsolute) continue;
        pending.push(absolute);
        continue;
      }
      const relative = toPosix(path.relative(root, absolute));
      if (child.isSymbolicLink()) {
        walked.push({ path: relative, absolute, bytes: 0, mtimeMs: 0, symlink: true });
        continue;
      }
      if (!child.isFile()) continue;
      const stats = await lstat(absolute);
      walked.push({ path: relative, absolute, bytes: stats.size, mtimeMs: stats.mtimeMs, symlink: false });
    }
  }
  walked.sort((a, b) => compareText(a.path, b.path));
  return walked;
}

function gitOutput(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

// Mirrors resolveRepoName / resolveRevision in packages/pr-gate/src/cli.ts.
function resolveRepoName(root: string, explicit: string | undefined): string {
  if (explicit) return explicit;
  const remote = gitOutput(root, ["remote", "get-url", "origin"]);
  const match = remote?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;
  return "local/context-index";
}

function resolveRevision(root: string, explicit: string | undefined, fileHashes: Map<string, string>): string {
  if (explicit) return explicit;
  const head = gitOutput(root, ["rev-parse", "HEAD"]);
  if (head && /^[a-f0-9]{40}$/i.test(head)) return head;
  const hash = createHash("sha256");
  for (const [filePath, fileHash] of [...fileHashes].sort()) hash.update(`${filePath}:${fileHash}\n`);
  return hash.digest("hex");
}

const DECLARATION_PATTERNS: RegExp[] = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*class\s+([A-Za-z_]\w*)/,
  /(?:^|\s)(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/,
  /^\s*(?:pub\s+)?(?:fn|struct|enum|trait|type)\s+([A-Za-z_]\w*)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
];

function extractDeclarations(text: string): string[] {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    for (const pattern of DECLARATION_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        found.add(match[1]);
        break;
      }
    }
    if (found.size >= MAX_DECLARATIONS_PER_FILE) break;
  }
  return [...found].sort(compareText);
}

function extractTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const add = (token: string) => {
    if (token.length >= 2) counts.set(token, (counts.get(token) ?? 0) + 1);
  };
  for (const match of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const raw = match[0];
    add(raw.toLowerCase());
    const spaced = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    for (const part of spaced.split(" ")) add(part.toLowerCase());
    for (const part of raw.split("_")) add(part.toLowerCase());
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, MAX_TERMS_PER_FILE)
    .map(([token]) => token)
    .sort(compareText);
}

/** Project per-file import edges out of an extracted Solve Graph document. */
export function projectGraphImports(document: SolveGraphDocument): Map<string, string[]> {
  const pathById = new Map<string, string>();
  for (const node of document.nodes) {
    if (node.kind !== "file") continue;
    const nodePath = node.metadata?.path;
    if (typeof nodePath === "string") pathById.set(node.id, nodePath);
  }
  const collected = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    if (edge.kind !== "imports") continue;
    const from = pathById.get(edge.from);
    const to = pathById.get(edge.to);
    if (!from || !to || from === to) continue;
    let set = collected.get(from);
    if (!set) {
      set = new Set<string>();
      collected.set(from, set);
    }
    set.add(to);
  }
  return new Map([...collected].map(([from, targets]) => [from, [...targets].sort(compareText)]));
}

function computeRecord(
  walked: WalkedFile,
  text: string | undefined,
  sha256: string | null,
  projectedImports: string[],
): ContextIndexRecord | undefined {
  if (!isDiscoverableTextPath(walked.path)) return undefined;
  if (walked.bytes === 0) return undefined;
  const classification = classifyRepositoryFile({ path: walked.path });
  if (walked.bytes > PACK_FILE_MAX_BYTES) {
    return {
      path: walked.path,
      sha256,
      bytes: walked.bytes,
      classification,
      terms: [],
      declarations: [],
      imports: projectedImports,
      oversize: true,
    };
  }
  if (text === undefined) return undefined; // binary content under a text extension
  return {
    path: walked.path,
    sha256,
    bytes: walked.bytes,
    classification,
    terms: extractTerms(text),
    declarations: extractDeclarations(text),
    imports: projectedImports,
    oversize: false,
  };
}

interface AssembledSnapshot {
  entries: RepositorySnapshotEntry[];
  /** Decoded text per path for files that are readable text at or under the pack cap. */
  texts: Map<string, string>;
  /** SHA-256 per walked file (null for size-only entries). */
  hashes: Map<string, string | null>;
  skippedSensitive: number;
  skippedUnsupported: number;
  skippedEmpty: number;
}

async function assembleSnapshot(walked: WalkedFile[]): Promise<AssembledSnapshot> {
  const entries: RepositorySnapshotEntry[] = [];
  const texts = new Map<string, string>();
  const hashes = new Map<string, string | null>();
  let skippedSensitive = 0;
  let skippedUnsupported = 0;
  let skippedEmpty = 0;

  for (const file of walked) {
    if (file.symlink) {
      entries.push({ path: file.path, kind: "symlink" });
      hashes.set(file.path, null);
      continue;
    }
    if (isSensitiveContextPath(file.path)) {
      skippedSensitive += 1;
      hashes.set(file.path, null);
      continue;
    }
    if (file.bytes > MAX_WALK_READ_BYTES) {
      entries.push({ path: file.path, kind: "file", declaredByteSize: file.bytes });
      hashes.set(file.path, null);
      continue;
    }
    const bytes = await readFile(file.absolute);
    const sha256 = sha256Hex(bytes);
    hashes.set(file.path, sha256);
    entries.push({ path: file.path, kind: "file", bytes: new Uint8Array(bytes) });
    if (file.bytes === 0) {
      skippedEmpty += 1;
      continue;
    }
    if (bytes.includes(0)) {
      skippedUnsupported += 1;
      continue;
    }
    if (isDiscoverableTextPath(file.path) && file.bytes <= PACK_FILE_MAX_BYTES) {
      texts.set(file.path, bytes.toString("utf8"));
    }
  }
  entries.sort((a, b) => compareText(a.path, b.path));
  return { entries, texts, hashes, skippedSensitive, skippedUnsupported, skippedEmpty };
}

interface ExtractedGraph {
  document: SolveGraphDocument;
  graphText: string;
  graphSha256: string;
}

async function extractGraph(
  root: string,
  assembled: AssembledSnapshot,
  options: { repo?: string; revision?: string },
): Promise<ExtractedGraph> {
  const hashView = new Map<string, string>();
  for (const [filePath, sha256] of assembled.hashes) if (sha256) hashView.set(filePath, sha256);
  const repo = resolveRepoName(root, options.repo);
  const revision = resolveRevision(root, options.revision, hashView);
  const { snapshot } = await ingestGitHubSnapshotEntries({
    repositoryFullName: repo,
    commitSha: revision,
    entries: assembled.entries,
  });
  const document = await extractRepositoryMultiLanguageDependencyGraph(snapshot, { privateSource: true });
  const integrityVerified = await verifySolveGraphIntegrity(document);
  if (!integrityVerified) throw new Error("Solve Graph integrity verification failed for the generated document.");
  const graphText = serializeSolveGraphDocument(document);
  return { document, graphText, graphSha256: sha256Hex(graphText) };
}

function buildIndexDocument(
  extracted: ExtractedGraph,
  walked: WalkedFile[],
  records: ContextIndexRecord[],
  assembled: AssembledSnapshot,
): ContextIndex {
  const skippedOversize = records.filter((record) => record.oversize).map((record) => record.path).sort(compareText);
  const withoutHash: Omit<ContextIndex, "indexSha256"> = {
    schema: CONTEXT_INDEX_SCHEMA,
    tool: { name: CONTEXT_INDEX_TOOL_NAME, version: CONTEXT_INDEX_TOOL_VERSION },
    source: {
      displayName: extracted.document.source.displayName,
      revision: extracted.document.source.revision,
      fingerprint: extracted.document.source.fingerprint,
    },
    graph: {
      file: CONTEXT_INDEX_GRAPH_FILE,
      sha256: extracted.graphSha256,
      graphId: extracted.document.graphId,
      status: extracted.document.execution.status,
      nodes: extracted.document.nodes.length,
      edges: extracted.document.edges.length,
    },
    counts: {
      walkedFiles: walked.length,
      records: records.length,
      skippedSensitive: assembled.skippedSensitive,
      skippedUnsupported: assembled.skippedUnsupported,
      skippedEmpty: assembled.skippedEmpty,
      skippedOversize,
    },
    records: [...records].sort((a, b) => compareText(a.path, b.path)),
  };
  return { ...withoutHash, indexSha256: computeContextIndexSha256(withoutHash) };
}

function buildState(walked: WalkedFile[], hashes: Map<string, string | null>): ContextIndexState {
  const files: ContextIndexState["files"] = {};
  for (const file of walked) {
    files[file.path] = { bytes: file.bytes, mtimeMs: file.mtimeMs, sha256: hashes.get(file.path) ?? null };
  }
  return { schema: CONTEXT_INDEX_STATE_SCHEMA, files };
}

async function writeAtomic(absolutePath: string, content: string): Promise<void> {
  const temporary = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, absolutePath);
}

async function writeIndexFiles(
  outDir: string,
  index: ContextIndex,
  graphText: string,
  state: ContextIndexState,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeAtomic(path.join(outDir, CONTEXT_INDEX_GRAPH_FILE), graphText);
  await writeAtomic(path.join(outDir, CONTEXT_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  await writeAtomic(path.join(outDir, CONTEXT_INDEX_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export interface ContextIndexBuildOptions {
  outDir?: string;
  repo?: string;
  revision?: string;
}

export interface ContextIndexBuildReport {
  index: ContextIndex;
  outDir: string;
  graphBytes: number;
  indexBytes: number;
  timingsMs: { walk: number; assemble: number; extract: number; records: number; write: number };
}

export async function buildContextIndex(root: string, options: ContextIndexBuildOptions = {}): Promise<ContextIndexBuildReport> {
  const target = path.resolve(root);
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(target, ".solve");
  const timingsMs = { walk: 0, assemble: 0, extract: 0, records: 0, write: 0 };

  let started = Date.now();
  const walked = await walkWorkspace(target, outDir);
  timingsMs.walk = Date.now() - started;

  started = Date.now();
  const assembled = await assembleSnapshot(walked);
  timingsMs.assemble = Date.now() - started;

  started = Date.now();
  const extracted = await extractGraph(target, assembled, options);
  timingsMs.extract = Date.now() - started;

  started = Date.now();
  const projected = projectGraphImports(extracted.document);
  const records: ContextIndexRecord[] = [];
  for (const file of walked) {
    if (file.symlink || isSensitiveContextPath(file.path)) continue;
    const record = computeRecord(file, assembled.texts.get(file.path), assembled.hashes.get(file.path) ?? null, projected.get(file.path) ?? []);
    if (record) records.push(record);
  }
  timingsMs.records = Date.now() - started;

  const index = buildIndexDocument(extracted, walked, records, assembled);
  const state = buildState(walked, assembled.hashes);

  started = Date.now();
  await writeIndexFiles(outDir, index, extracted.graphText, state);
  timingsMs.write = Date.now() - started;

  return {
    index,
    outDir,
    graphBytes: Buffer.byteLength(extracted.graphText, "utf8"),
    indexBytes: Buffer.byteLength(`${JSON.stringify(index, null, 2)}\n`, "utf8"),
    timingsMs,
  };
}

export interface ContextIndexRefreshOptions extends ContextIndexBuildOptions {
  /** Caller-named changed paths (still hash-verified; they join the affected scope and the impact roots). */
  changedPaths?: string[];
}

export interface ContextIndexRefreshReport {
  index: ContextIndex;
  outDir: string;
  changed: boolean;
  addedPaths: string[];
  modifiedPaths: string[];
  deletedPaths: string[];
  /** Changed + caller-named + graph-impact dependents: the scope whose records were eligible for recomputation. */
  affectedPaths: string[];
  recomputedRecordPaths: string[];
  /** Carried records whose projected imports changed under the re-extracted graph. */
  edgeShiftedPaths: string[];
  carriedRecords: number;
  /** True when the previous graph could not be used for impact scoping and every record was recomputed. */
  impactFallback: boolean;
  timingsMs: { walk: number; detect: number; assemble: number; extract: number; records: number; write: number };
}

async function loadExistingIndex(outDir: string): Promise<ContextIndex | undefined> {
  const indexPath = path.join(outDir, CONTEXT_INDEX_FILE);
  if (!existsSync(indexPath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as ContextIndex;
    return parsed.schema === CONTEXT_INDEX_SCHEMA ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function loadExistingState(outDir: string): Promise<ContextIndexState | undefined> {
  const statePath = path.join(outDir, CONTEXT_INDEX_STATE_FILE);
  if (!existsSync(statePath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as ContextIndexState;
    return parsed.schema === CONTEXT_INDEX_STATE_SCHEMA ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function loadPriorGraph(outDir: string): Promise<SolveGraphDocument | undefined> {
  const graphPath = path.join(outDir, CONTEXT_INDEX_GRAPH_FILE);
  if (!existsSync(graphPath)) return undefined;
  try {
    const document = JSON.parse(await readFile(graphPath, "utf8")) as SolveGraphDocument;
    return (await verifySolveGraphIntegrity(document)) ? document : undefined;
  } catch {
    return undefined;
  }
}

export async function refreshContextIndex(root: string, options: ContextIndexRefreshOptions = {}): Promise<ContextIndexRefreshReport> {
  const target = path.resolve(root);
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(target, ".solve");
  const timingsMs = { walk: 0, detect: 0, assemble: 0, extract: 0, records: 0, write: 0 };

  const priorIndex = await loadExistingIndex(outDir);
  if (!priorIndex) {
    throw new Error(`No Solve Context index found at ${path.join(outDir, CONTEXT_INDEX_FILE)} — run a full build first.`);
  }
  const priorState = await loadExistingState(outDir);
  const priorRecords = new Map(priorIndex.records.map((record) => [record.path, record]));
  const explicitChanged = [...new Set((options.changedPaths ?? []).map((value) => value.replace(/^\.\//, "").split("\\").join("/")))].sort(compareText);

  let started = Date.now();
  const walked = await walkWorkspace(target, outDir);
  timingsMs.walk = Date.now() - started;

  // Change detection: the stat cache is a fast path only. A file whose
  // size and mtime both match its cache entry is carried as unchanged;
  // anything else is read and hash-verified before it is called changed.
  started = Date.now();
  const walkedPaths = new Set(walked.map((file) => file.path));
  const detectedHashes = new Map<string, string | null>();
  const addedPaths: string[] = [];
  const modifiedPaths: string[] = [];
  for (const file of walked) {
    if (file.symlink) {
      detectedHashes.set(file.path, null);
      continue;
    }
    const cached = priorState?.files[file.path];
    if (cached && cached.bytes === file.bytes && cached.mtimeMs === file.mtimeMs) {
      detectedHashes.set(file.path, cached.sha256);
      continue;
    }
    if (file.bytes > MAX_WALK_READ_BYTES) {
      detectedHashes.set(file.path, null);
      const known = priorRecords.get(file.path) ?? (cached ? { bytes: cached.bytes } : undefined);
      if (!known) addedPaths.push(file.path);
      else if (known.bytes !== file.bytes) modifiedPaths.push(file.path);
      continue;
    }
    const bytes = await readFile(file.absolute);
    const sha256 = sha256Hex(bytes);
    detectedHashes.set(file.path, sha256);
    const knownHash = priorRecords.get(file.path)?.sha256 ?? cached?.sha256;
    if (knownHash === undefined) addedPaths.push(file.path);
    else if (knownHash !== sha256) modifiedPaths.push(file.path);
  }
  const priorGraph = await loadPriorGraph(outDir);
  const knownPaths = new Set<string>([
    ...priorRecords.keys(),
    ...(priorState ? Object.keys(priorState.files) : []),
    ...(priorGraph
      ? priorGraph.nodes.flatMap((node) => {
        const nodePath = node.metadata?.path;
        return node.kind === "file" && typeof nodePath === "string" ? [nodePath] : [];
      })
      : []),
  ]);
  const deletedPaths = [...knownPaths].filter((filePath) => !walkedPaths.has(filePath)).sort(compareText);
  addedPaths.sort(compareText);
  modifiedPaths.sort(compareText);
  const changedPaths = [...new Set([...addedPaths, ...modifiedPaths, ...deletedPaths])].sort(compareText);
  timingsMs.detect = Date.now() - started;

  if (changedPaths.length === 0 && explicitChanged.length === 0) {
    // Nothing changed: the index and graph stay byte-identical on disk;
    // only the stat cache is refreshed (touched-but-identical files get
    // their current mtimes recorded so the next refresh stays cheap).
    started = Date.now();
    const state = buildState(walked, detectedHashes);
    await mkdir(outDir, { recursive: true });
    await writeAtomic(path.join(outDir, CONTEXT_INDEX_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
    timingsMs.write = Date.now() - started;
    return {
      index: priorIndex,
      outDir,
      changed: false,
      addedPaths,
      modifiedPaths,
      deletedPaths,
      affectedPaths: [],
      recomputedRecordPaths: [],
      edgeShiftedPaths: [],
      carriedRecords: priorIndex.records.length,
      impactFallback: false,
      timingsMs,
    };
  }

  // Affected scope: changed + caller-named + dependents of the changed
  // files in the previously stored graph.
  let impactFallback = false;
  const affected = new Set<string>([...changedPaths, ...explicitChanged]);
  if (priorGraph) {
    try {
      const queryIndex = await createSolveGraphQueryIndex(priorGraph);
      const idByPath = new Map<string, string>();
      const pathById = new Map<string, string>();
      for (const node of priorGraph.nodes) {
        const nodePath = node.metadata?.path;
        if (node.kind === "file" && typeof nodePath === "string") {
          idByPath.set(nodePath, node.id);
          pathById.set(node.id, nodePath);
        }
      }
      const roots = [...affected].map((filePath) => idByPath.get(filePath)).filter((id): id is string => typeof id === "string");
      if (roots.length > 0) {
        const impact = analyzeSolveGraphImpact(queryIndex, roots);
        for (const entry of impact.entries) {
          if (entry.depth < 1) continue;
          const impactedPath = pathById.get(entry.id);
          if (impactedPath) affected.add(impactedPath);
        }
      }
    } catch {
      impactFallback = true;
    }
  } else {
    impactFallback = true;
  }
  if (impactFallback || priorIndex.tool.version !== CONTEXT_INDEX_TOOL_VERSION) {
    for (const recordPath of priorRecords.keys()) affected.add(recordPath);
    impactFallback = true;
  }
  const affectedPaths = [...affected].sort(compareText);

  started = Date.now();
  const assembled = await assembleSnapshot(walked);
  timingsMs.assemble = Date.now() - started;

  started = Date.now();
  const extracted = await extractGraph(target, assembled, options);
  timingsMs.extract = Date.now() - started;

  started = Date.now();
  const projected = projectGraphImports(extracted.document);
  const records: ContextIndexRecord[] = [];
  const recomputedRecordPaths: string[] = [];
  const edgeShiftedPaths: string[] = [];
  let carriedRecords = 0;
  for (const file of walked) {
    if (file.symlink || isSensitiveContextPath(file.path)) continue;
    const prior = priorRecords.get(file.path);
    const projectedImports = projected.get(file.path) ?? [];
    if (prior && !affected.has(file.path)) {
      if (JSON.stringify(prior.imports) !== JSON.stringify(projectedImports)) {
        records.push({ ...prior, imports: projectedImports });
        edgeShiftedPaths.push(file.path);
      } else {
        records.push(prior);
        carriedRecords += 1;
      }
      continue;
    }
    const record = computeRecord(file, assembled.texts.get(file.path), assembled.hashes.get(file.path) ?? null, projectedImports);
    if (record) {
      records.push(record);
      if (prior) recomputedRecordPaths.push(file.path);
    }
  }
  recomputedRecordPaths.sort(compareText);
  edgeShiftedPaths.sort(compareText);
  timingsMs.records = Date.now() - started;

  const index = buildIndexDocument(extracted, walked, records, assembled);
  const state = buildState(walked, assembled.hashes);

  started = Date.now();
  await writeIndexFiles(outDir, index, extracted.graphText, state);
  timingsMs.write = Date.now() - started;

  return {
    index,
    outDir,
    changed: true,
    addedPaths,
    modifiedPaths,
    deletedPaths,
    affectedPaths,
    recomputedRecordPaths,
    edgeShiftedPaths,
    carriedRecords,
    impactFallback,
    timingsMs,
  };
}
