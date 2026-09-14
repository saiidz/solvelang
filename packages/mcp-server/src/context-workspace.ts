import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildContextPack,
  contextEntryHandle,
  contextTaskTokens,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  MAX_CONTEXT_SOURCE_BYTES,
  MAX_CONTEXT_SOURCES,
  normalizeContextPath,
  sha256Text,
  type ContextPack,
  type ContextPackEntry,
  type ContextSource,
} from "./context-pack.js";
import {
  buildContextSelection,
  normalizeContextSelectionPath,
  type ContextSelection,
  type ContextSelectionMetadata,
} from "./context-selection.js";
import { parseSolveGraphText } from "./solve-graph.js";
import { readWorkspaceText, workspaceRoot } from "./workspace.js";

export const CONTEXT_PLAN_SCHEMA = "solvelang.context.plan.v0" as const;
export const CONTEXT_WORKSPACE_PACK_SCHEMA = "solvelang.context.workspace-pack.v0" as const;
export const CONTEXT_RETRIEVAL_SCHEMA = "solvelang.context.retrieval.v0" as const;
export const MAX_CONTEXT_EXPLICIT_PATHS = 128;
export const MAX_CONTEXT_DISCOVERY_ENTRIES = 20_000;
export const MAX_CONTEXT_DISCOVERY_CANDIDATES = 4_096;
export const MAX_CONTEXT_DISCOVERY_BYTES = 16 * 1024 * 1024;
export const MAX_CONTEXT_DISCOVERY_DEPTH = 12;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SENSITIVE_DIRECTORIES = new Set([".aws", ".gnupg", ".kube", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

const DISCOVERABLE_EXTENSIONS = new Set([
  ".bash", ".c", ".cc", ".cfg", ".cjs", ".conf", ".cpp", ".cs", ".css", ".csv",
  ".go", ".gql", ".graphql", ".h", ".hpp", ".htm", ".html", ".ini", ".java", ".js",
  ".json", ".jsx", ".kt", ".kts", ".less", ".md", ".mdx", ".mjs", ".php", ".proto",
  ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".solve", ".sql", ".svelte", ".swift",
  ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);

const DISCOVERABLE_BASENAMES = new Set([
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "Makefile",
  "Procfile",
  "Rakefile",
]);

interface DiscoveryCandidate {
  path: string;
  bytes: number;
  pathScore: number;
}

export interface ContextWorkspaceMetadata {
  mode: "explicit" | "discovery";
  scannedEntries: number;
  candidateFiles: number;
  selectedFiles: number;
  selectedSourceBytes: number;
  skippedSensitive: number;
  skippedUnsupported: number;
  skippedOversize: number;
  discoveryTruncated: boolean;
  selection?: ContextSelectionMetadata;
}

export interface ContextPlanEntry extends Omit<ContextPackEntry, "content"> {}

export interface ContextPlan {
  schema: typeof CONTEXT_PLAN_SCHEMA;
  workspace: ContextWorkspaceMetadata;
  pack: Omit<ContextPack, "entries"> & { entries: ContextPlanEntry[] };
}

export interface ContextWorkspacePack {
  schema: typeof CONTEXT_WORKSPACE_PACK_SCHEMA;
  workspace: ContextWorkspaceMetadata;
  pack: ContextPack;
}

export interface ContextRetrievalRequest {
  handle: string;
  path: string;
  startLine: number;
  endLine: number;
  sourceSha256: string;
  excerptSha256: string;
}

export interface ContextRetrieval {
  schema: typeof CONTEXT_RETRIEVAL_SCHEMA;
  handle: string;
  path: string;
  startLine: number;
  endLine: number;
  sourceSha256: string;
  excerptSha256: string;
  bytes: number;
  content: string;
}

function isSensitivePath(inputPath: string): boolean {
  const normalized = normalizeContextPath(inputPath);
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1)!;
  if (segments.some((segment) => SENSITIVE_DIRECTORIES.has(segment))) return true;
  if (SENSITIVE_FILENAMES.has(basename)) return true;
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  if (basename.endsWith(".key") || basename.endsWith(".p12") || basename.endsWith(".pfx") || basename.endsWith(".pem")) return true;
  return false;
}

function isDiscoverableTextPath(inputPath: string): boolean {
  const normalized = normalizeContextPath(inputPath);
  const basename = path.posix.basename(normalized);
  return DISCOVERABLE_BASENAMES.has(basename) || DISCOVERABLE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

function pathTaskScore(inputPath: string, tokens: string[]): number {
  const lower = inputPath.toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function hasBinarySentinel(text: string): boolean {
  return text.includes("\0");
}

async function loadExplicitSources(paths: string[]): Promise<{ sources: ContextSource[]; workspace: ContextWorkspaceMetadata }> {
  if (paths.length === 0) throw new Error("Explicit context paths must not be empty.");
  if (paths.length > MAX_CONTEXT_EXPLICIT_PATHS) {
    throw new Error(`Explicit context paths exceed the ${MAX_CONTEXT_EXPLICIT_PATHS} path safety limit.`);
  }

  const normalizedPaths = [...new Set(paths.map(normalizeContextPath))].sort();
  const sources: ContextSource[] = [];
  let selectedSourceBytes = 0;

  for (const inputPath of normalizedPaths) {
    if (isSensitivePath(inputPath)) throw new Error(`Context access to sensitive path ${inputPath} is denied.`);
    const { text } = await readWorkspaceText(inputPath);
    if (hasBinarySentinel(text)) throw new Error(`Context path ${inputPath} does not appear to be a text file.`);
    const bytes = Buffer.byteLength(text, "utf8");
    if (selectedSourceBytes + bytes > MAX_CONTEXT_DISCOVERY_BYTES) {
      throw new Error(`Explicit context sources exceed the ${MAX_CONTEXT_DISCOVERY_BYTES} byte aggregate safety limit.`);
    }
    sources.push({ path: inputPath, text });
    selectedSourceBytes += bytes;
  }

  return {
    sources,
    workspace: {
      mode: "explicit",
      scannedEntries: normalizedPaths.length,
      candidateFiles: normalizedPaths.length,
      selectedFiles: sources.length,
      selectedSourceBytes,
      skippedSensitive: 0,
      skippedUnsupported: 0,
      skippedOversize: 0,
      discoveryTruncated: false,
    },
  };
}

async function discoverCandidates(task: string): Promise<{ candidates: DiscoveryCandidate[]; metadata: Omit<ContextWorkspaceMetadata, "selectedFiles" | "selectedSourceBytes"> }> {
  const tokens = contextTaskTokens(task);
  const root = workspaceRoot();
  const candidates: DiscoveryCandidate[] = [];
  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [{ absolutePath: root, relativePath: "", depth: 0 }];
  let scannedEntries = 0;
  let skippedSensitive = 0;
  let skippedUnsupported = 0;
  let skippedOversize = 0;
  let discoveryTruncated = false;

  while (queue.length > 0) {
    if (scannedEntries >= MAX_CONTEXT_DISCOVERY_ENTRIES || candidates.length >= MAX_CONTEXT_DISCOVERY_CANDIDATES) {
      discoveryTruncated = true;
      break;
    }
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      discoveryTruncated = true;
      continue;
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > MAX_CONTEXT_DISCOVERY_ENTRIES) {
        discoveryTruncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
      const normalizedPath = normalizeContextPath(relativePath);
      const lowerName = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(lowerName)) continue;
        if (SENSITIVE_DIRECTORIES.has(lowerName) || isSensitivePath(`${normalizedPath}/placeholder.txt`)) {
          skippedSensitive += 1;
          continue;
        }
        if (current.depth >= MAX_CONTEXT_DISCOVERY_DEPTH) {
          discoveryTruncated = true;
          continue;
        }
        queue.push({ absolutePath: path.join(current.absolutePath, entry.name), relativePath: normalizedPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      if (isSensitivePath(normalizedPath)) {
        skippedSensitive += 1;
        continue;
      }
      if (!isDiscoverableTextPath(normalizedPath)) {
        skippedUnsupported += 1;
        continue;
      }
      try {
        const metadata = await stat(path.join(current.absolutePath, entry.name));
        if (metadata.size === 0 || metadata.size > MAX_CONTEXT_SOURCE_BYTES) {
          skippedOversize += 1;
          continue;
        }
        candidates.push({ path: normalizedPath, bytes: metadata.size, pathScore: pathTaskScore(normalizedPath, tokens) });
        if (candidates.length >= MAX_CONTEXT_DISCOVERY_CANDIDATES) {
          discoveryTruncated = true;
          break;
        }
      } catch {
        discoveryTruncated = true;
      }
    }
  }

  candidates.sort((left, right) => right.pathScore - left.pathScore || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    candidates,
    metadata: {
      mode: "discovery",
      scannedEntries,
      candidateFiles: candidates.length,
      skippedSensitive,
      skippedUnsupported,
      skippedOversize,
      discoveryTruncated,
    },
  };
}

async function loadDiscoveredSources(task: string, selection?: ContextSelection): Promise<{ sources: ContextSource[]; workspace: ContextWorkspaceMetadata }> {
  const { candidates, metadata } = await discoverCandidates(task);
  if (selection) {
    candidates.sort((left, right) =>
      (selection.hints.get(right.path)?.score ?? 0) - (selection.hints.get(left.path)?.score ?? 0)
      || right.pathScore - left.pathScore || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  }
  const sources: ContextSource[] = [];
  let selectedSourceBytes = 0;
  let discoveryTruncated = metadata.discoveryTruncated;
  let skippedOversize = metadata.skippedOversize;

  for (const candidate of candidates) {
    if (sources.length >= MAX_CONTEXT_SOURCES) {
      discoveryTruncated = true;
      break;
    }
    if (selectedSourceBytes + candidate.bytes > MAX_CONTEXT_DISCOVERY_BYTES) {
      discoveryTruncated = true;
      continue;
    }
    try {
      const { text } = await readWorkspaceText(candidate.path);
      if (hasBinarySentinel(text)) {
        skippedOversize += 1;
        continue;
      }
      const actualBytes = Buffer.byteLength(text, "utf8");
      if (selectedSourceBytes + actualBytes > MAX_CONTEXT_DISCOVERY_BYTES) {
        discoveryTruncated = true;
        continue;
      }
      sources.push({ path: candidate.path, text });
      selectedSourceBytes += actualBytes;
    } catch {
      discoveryTruncated = true;
    }
  }

  if (sources.length === 0) throw new Error("No eligible text sources were found in the configured workspace.");
  return {
    sources,
    workspace: {
      ...metadata,
      selectedFiles: sources.length,
      selectedSourceBytes,
      skippedOversize,
      discoveryTruncated,
    },
  };
}

export interface ContextWorkspaceOptions {
  paths?: string[];
  budgetBytes?: number;
  changedPaths?: string[];
  graphPath?: string;
}

async function loadContextSelection(options: ContextWorkspaceOptions): Promise<ContextSelection | undefined> {
  if (options.changedPaths === undefined) {
    if (options.graphPath !== undefined) throw new Error("Context graphPath requires explicit changedPaths.");
    return undefined;
  }
  const allowedPath = (inputPath: string) => !isSensitivePath(inputPath);
  // Validate the complete caller-controlled change list before opening the optional graph.
  const changed = buildContextSelection(options.changedPaths, undefined, allowedPath);
  if (options.graphPath === undefined) return changed;
  const graphPath = normalizeContextSelectionPath(options.graphPath);
  if (!allowedPath(graphPath)) throw new Error("Context graph access to sensitive paths is denied.");
  const { text } = await readWorkspaceText(graphPath);
  return buildContextSelection(options.changedPaths, {
    path: graphPath,
    sourceSha256: sha256Text(text),
    document: parseSolveGraphText(text),
  }, allowedPath);
}

export async function buildWorkspaceContextPack(
  task: string,
  options: ContextWorkspaceOptions = {},
): Promise<ContextWorkspacePack> {
  const selection = await loadContextSelection(options);
  const loaded = options.paths ? await loadExplicitSources(options.paths) : await loadDiscoveredSources(task, selection);
  if (selection) {
    loaded.workspace.selection = selection.metadata;
    loaded.sources = loaded.sources.map((source) => {
      const hint = selection.hints.get(source.path);
      return hint ? { ...source, selection: hint } : source;
    });
  }
  return {
    schema: CONTEXT_WORKSPACE_PACK_SCHEMA,
    workspace: loaded.workspace,
    pack: buildContextPack(task, loaded.sources, options.budgetBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES),
  };
}

export async function planWorkspaceContext(
  task: string,
  options: ContextWorkspaceOptions = {},
): Promise<ContextPlan> {
  const result = await buildWorkspaceContextPack(task, options);
  return {
    schema: CONTEXT_PLAN_SCHEMA,
    workspace: result.workspace,
    pack: {
      ...result.pack,
      entries: result.pack.entries.map(({ content: _content, ...entry }) => entry),
    },
  };
}

export async function retrieveWorkspaceContext(request: ContextRetrievalRequest): Promise<ContextRetrieval> {
  const normalizedPath = normalizeContextPath(request.path);
  if (isSensitivePath(normalizedPath)) throw new Error(`Context access to sensitive path ${normalizedPath} is denied.`);
  if (!/^ctx_[a-f0-9]{32}$/.test(request.handle)) throw new Error("The context handle is malformed.");
  if (!/^[a-f0-9]{64}$/.test(request.sourceSha256) || !/^[a-f0-9]{64}$/.test(request.excerptSha256)) {
    throw new Error("Context retrieval hashes must be lowercase SHA-256 values.");
  }
  if (!Number.isInteger(request.startLine) || !Number.isInteger(request.endLine) || request.startLine < 1 || request.endLine < request.startLine) {
    throw new Error("Context retrieval line bounds are invalid.");
  }

  const { text } = await readWorkspaceText(normalizedPath);
  const currentSourceSha256 = sha256Text(text);
  if (currentSourceSha256 !== request.sourceSha256) {
    throw new Error("The context source changed after the handle was created; rebuild the context pack.");
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (request.endLine > lines.length) throw new Error("The context retrieval range is outside the current source.");
  const content = lines.slice(request.startLine - 1, request.endLine).join("\n");
  const excerptSha256 = sha256Text(content);
  if (excerptSha256 !== request.excerptSha256) {
    throw new Error("The context excerpt hash does not match the current source range.");
  }
  const expectedHandle = contextEntryHandle(
    normalizedPath,
    request.sourceSha256,
    request.startLine,
    request.endLine,
    request.excerptSha256,
  );
  if (expectedHandle !== request.handle) throw new Error("The context handle does not match the requested source identity.");

  return {
    schema: CONTEXT_RETRIEVAL_SCHEMA,
    handle: request.handle,
    path: normalizedPath,
    startLine: request.startLine,
    endLine: request.endLine,
    sourceSha256: request.sourceSha256,
    excerptSha256,
    bytes: Buffer.byteLength(content, "utf8"),
    content,
  };
}
