import {
  classifyRepositoryFile,
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

export type RepositorySnapshotEntry = {
  path: string;
  kind: "file" | "directory" | "symlink";
  bytes?: Uint8Array;
  declaredByteSize?: number;
  generated?: boolean;
};

export type RepositoryIngestionLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
  maxArchiveBytes: number;
  maxDepth: number;
  maxTextBytes: number;
};

export type RepositoryHashProvider = (data: Uint8Array) => Promise<string>;

export type RepositoryIngestionResult = {
  snapshot: RepositorySnapshot;
  ingestion: {
    status: "complete";
    entriesSeen: number;
    filesIngested: number;
    directoriesIgnored: number;
    totalBytes: number;
    textFilesRetained: number;
    wrapperDirectoryRemoved?: string;
    networkAccess: false;
    writeAccess: false;
  };
};

export const defaultRepositoryIngestionLimits: RepositoryIngestionLimits = Object.freeze({
  maxEntries: 100_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 512 * 1024 * 1024,
  maxDepth: 64,
  maxTextBytes: 1024 * 1024,
});

const textExtensions = new Set([
  "c", "cc", "cfg", "conf", "config", "cpp", "cs", "css", "csv", "env", "go", "gradle", "graphql", "gql", "h", "hpp",
  "html", "ini", "java", "js", "json", "jsx", "key", "kt", "kts", "lock", "log", "md", "mdx", "mjs", "cjs", "pem",
  "php", "properties", "py", "rb", "rs", "rst", "scss", "sh", "sql", "svelte", "tf", "tfvars", "toml", "ts", "tsx", "txt",
  "vue", "xml", "yaml", "yml",
]);
const textNames = new Set([
  ".dockerignore", ".editorconfig", ".gitattributes", ".gitignore", ".npmrc", "dockerfile", "license", "makefile",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function validateLimits(overrides: Partial<RepositoryIngestionLimits>): RepositoryIngestionLimits {
  const limits = { ...defaultRepositoryIngestionLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) assertPositiveSafeInteger(value, name);
  if (limits.maxTextBytes > limits.maxEntryBytes) throw new Error("maxTextBytes cannot exceed maxEntryBytes.");
  return limits;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure SHA-256 support is unavailable in this environment.");
  const copied = new Uint8Array(data);
  const digest = await subtle.digest("SHA-256", copied.buffer);
  return bytesToHex(new Uint8Array(digest));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function isInspectableText(path: string): boolean {
  const name = basename(path).toLowerCase();
  return textNames.has(name) || /^\.env(?:\..+)?$/.test(name) || textExtensions.has(extension(path));
}

function decodeInspectableText(path: string, bytes: Uint8Array, maxTextBytes: number): string | undefined {
  if (bytes.byteLength > maxTextBytes || !isInspectableText(path)) return undefined;
  for (const value of bytes) if (value === 0) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function normalizeDisplayName(input: string, label: string): string {
  if (typeof input !== "string") throw new Error(`${label} must be a string.`);
  const value = input.trim();
  if (!value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeArchiveName(input: string): string {
  const value = normalizeDisplayName(input, "Archive name").replace(/\\/g, "/");
  const name = value.slice(value.lastIndexOf("/") + 1);
  if (!name || !/\.(?:zip|tar|tgz|tar\.gz)$/i.test(name)) throw new Error("Archive name must use a supported archive suffix.");
  return name;
}

function validateGitHubRepositoryName(input: string): string {
  const value = normalizeDisplayName(input, "GitHub repository name");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("GitHub repository name must use owner/repository form.");
  return value;
}

function validateGitCommit(input: string): string {
  if (typeof input !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(input)) {
    throw new Error("GitHub snapshot revision must be an immutable 40- or 64-character commit hash.");
  }
  return input.toLowerCase();
}

type NormalizedEntry = {
  path: string;
  kind: RepositorySnapshotEntry["kind"];
  bytes?: Uint8Array;
  generated?: boolean;
};

function normalizeEntries(entries: readonly RepositorySnapshotEntry[], limits: RepositoryIngestionLimits): NormalizedEntry[] {
  if (!Array.isArray(entries)) throw new Error("Snapshot entries must be an array.");
  if (entries.length > limits.maxEntries) throw new Error(`Snapshot exceeds the ${limits.maxEntries}-entry ingestion limit.`);

  const normalized: NormalizedEntry[] = [];
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") throw new Error(`Snapshot entry ${index + 1} is invalid.`);
    if (!(typeof entry.kind === "string" && ["file", "directory", "symlink"].includes(entry.kind))) {
      throw new Error(`Snapshot entry ${index + 1} has an unsupported kind.`);
    }
    const path = normalizeRepositoryPath(entry.path);
    if (entry.kind === "symlink") throw new Error(`Symbolic links are not accepted by Repository Audit ingestion: ${path}`);

    if (entry.kind === "directory") {
      if (entry.bytes !== undefined || entry.declaredByteSize !== undefined || entry.generated !== undefined) {
        throw new Error(`Directory entry contains unexpected file metadata: ${path}`);
      }
      normalized.push({ path, kind: "directory" });
      continue;
    }

    if (!(entry.bytes instanceof Uint8Array)) throw new Error(`File entry is missing Uint8Array content: ${path}`);
    const bytes = new Uint8Array(entry.bytes);
    if (entry.declaredByteSize !== undefined) {
      if (!Number.isSafeInteger(entry.declaredByteSize) || entry.declaredByteSize < 0) throw new Error(`Declared byte size is invalid: ${path}`);
      if (entry.declaredByteSize !== bytes.byteLength) throw new Error(`Declared byte size does not match extracted content: ${path}`);
    }
    if (bytes.byteLength > limits.maxEntryBytes) throw new Error(`File exceeds the ${limits.maxEntryBytes}-byte ingestion limit: ${path}`);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new Error(`Snapshot exceeds the ${limits.maxTotalBytes}-byte ingestion limit.`);
    }
    if (entry.generated !== undefined && typeof entry.generated !== "boolean") throw new Error(`Generated flag is invalid: ${path}`);
    normalized.push({ path, kind: "file", bytes, generated: entry.generated });
  }
  return normalized;
}

function validateDepth(entries: readonly NormalizedEntry[], limits: RepositoryIngestionLimits): void {
  for (const entry of entries) {
    if (entry.path.split("/").length > limits.maxDepth) {
      throw new Error(`Snapshot entry exceeds the ${limits.maxDepth}-segment depth limit: ${entry.path}`);
    }
  }
}

function sharedArchiveWrapper(entries: readonly NormalizedEntry[]): string | undefined {
  const files = entries.filter((entry) => entry.kind === "file");
  if (files.length === 0) return undefined;
  const first = files[0].path.split("/");
  if (first.length < 2) return undefined;
  const candidate = first[0];
  return files.every((entry) => {
    const parts = entry.path.split("/");
    return parts.length > 1 && parts[0] === candidate;
  }) ? candidate : undefined;
}

function stripArchiveWrapper(entries: readonly NormalizedEntry[]): {
  entries: NormalizedEntry[];
  wrapper?: string;
  removedDirectories: number;
} {
  const wrapper = sharedArchiveWrapper(entries);
  if (!wrapper) return { entries: [...entries], removedDirectories: 0 };
  const prefix = `${wrapper}/`;
  let removedDirectories = 0;
  const stripped = entries.flatMap((entry) => {
    if (entry.path === wrapper && entry.kind === "directory") {
      removedDirectories += 1;
      return [];
    }
    if (entry.path.startsWith(prefix)) return [{ ...entry, path: entry.path.slice(prefix.length) }];
    if (entry.kind === "directory") {
      removedDirectories += 1;
      return [];
    }
    throw new Error("Archive wrapper normalization became inconsistent.");
  });
  return { wrapper, entries: stripped, removedDirectories };
}

function rejectDuplicatePaths(entries: readonly NormalizedEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`Snapshot contains a duplicate normalized path: ${entry.path}`);
    seen.add(entry.path);
  }
}

async function buildSnapshot(
  source: Omit<RepositorySnapshot["source"], "fingerprint">,
  entries: readonly NormalizedEntry[],
  entriesSeen: number,
  preIgnoredDirectories: number,
  limits: RepositoryIngestionLimits,
  hashProvider: RepositoryHashProvider,
): Promise<RepositoryIngestionResult> {
  rejectDuplicatePaths(entries);
  const sorted = [...entries].sort((left, right) => compareText(left.path, right.path));
  const files: RepositoryFileInput[] = [];
  const descriptors: string[] = [];
  let directoriesIgnored = preIgnoredDirectories;
  let totalBytes = 0;
  let textFilesRetained = 0;

  for (const entry of sorted) {
    if (entry.kind === "directory") {
      directoriesIgnored += 1;
      continue;
    }
    const bytes = entry.bytes!;
    const sha256 = await hashProvider(bytes);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Hash provider returned an invalid SHA-256 value for ${entry.path}.`);
    const text = decodeInspectableText(entry.path, bytes, limits.maxTextBytes);
    if (text !== undefined) textFilesRetained += 1;
    totalBytes += bytes.byteLength;
    files.push({
      path: entry.path,
      byteSize: bytes.byteLength,
      sha256,
      ...(text === undefined ? {} : { text }),
      ...(entry.generated === undefined ? {} : { generated: entry.generated }),
    });
    descriptors.push(`file\0${entry.path}\0${bytes.byteLength}\0${sha256}\n`);
  }

  const fingerprint = await hashProvider(new TextEncoder().encode(descriptors.join("")));
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Hash provider returned an invalid source fingerprint.");
  return {
    snapshot: { source: { ...source, fingerprint: `sha256:${fingerprint}` }, files },
    ingestion: {
      status: "complete",
      entriesSeen,
      filesIngested: files.length,
      directoriesIgnored,
      totalBytes,
      textFilesRetained,
      networkAccess: false,
      writeAccess: false,
    },
  };
}

export async function ingestGitHubSnapshotEntries(input: {
  repositoryFullName: string;
  commitSha: string;
  entries: readonly RepositorySnapshotEntry[];
  limits?: Partial<RepositoryIngestionLimits>;
  hashProvider?: RepositoryHashProvider;
}): Promise<RepositoryIngestionResult> {
  const limits = validateLimits(input.limits ?? {});
  const repositoryFullName = validateGitHubRepositoryName(input.repositoryFullName);
  const commitSha = validateGitCommit(input.commitSha);
  const entries = normalizeEntries(input.entries, limits);
  validateDepth(entries, limits);
  return buildSnapshot(
    { kind: "github", displayName: repositoryFullName, revision: commitSha },
    entries,
    input.entries.length,
    0,
    limits,
    input.hashProvider ?? sha256Hex,
  );
}

export async function ingestArchiveSnapshotEntries(input: {
  archiveName: string;
  archiveBytes: Uint8Array;
  entries: readonly RepositorySnapshotEntry[];
  limits?: Partial<RepositoryIngestionLimits>;
  hashProvider?: RepositoryHashProvider;
}): Promise<RepositoryIngestionResult> {
  const limits = validateLimits(input.limits ?? {});
  const archiveName = normalizeArchiveName(input.archiveName);
  if (!(input.archiveBytes instanceof Uint8Array)) throw new Error("Archive bytes must be provided as a Uint8Array.");
  if (input.archiveBytes.byteLength === 0) throw new Error("Archive bytes cannot be empty.");
  if (input.archiveBytes.byteLength > limits.maxArchiveBytes) throw new Error(`Archive exceeds the ${limits.maxArchiveBytes}-byte upload limit.`);
  const normalized = normalizeEntries(input.entries, limits);
  const stripped = stripArchiveWrapper(normalized);
  validateDepth(stripped.entries, limits);
  const hashProvider = input.hashProvider ?? sha256Hex;
  const archiveSha256 = await hashProvider(new Uint8Array(input.archiveBytes));
  if (!/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error("Hash provider returned an invalid archive SHA-256 value.");
  const result = await buildSnapshot(
    { kind: "archive", displayName: archiveName, revision: `sha256:${archiveSha256}` },
    stripped.entries,
    input.entries.length,
    stripped.removedDirectories,
    limits,
    hashProvider,
  );
  if (stripped.wrapper) result.ingestion.wrapperDirectoryRemoved = stripped.wrapper;
  return result;
}

export function classifyIngestedFile(file: Pick<RepositoryFileInput, "path" | "generated">) {
  return classifyRepositoryFile(file);
}
