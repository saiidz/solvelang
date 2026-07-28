import { normalizeRepositoryPath } from "./inventory";
import {
  defaultRepositoryIngestionLimits,
  ingestGitHubSnapshotEntries,
  type RepositoryHashProvider,
  type RepositoryIngestionResult,
  type RepositorySnapshotEntry,
} from "./ingestion";

export type GitHubResolvedReference = {
  commitSha: string;
  treeSha: string;
};

export type GitHubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
};

export type GitHubRecursiveTree = {
  truncated: boolean;
  entries: GitHubTreeEntry[];
};

export type GitHubBlob = {
  sha: string;
  encoding: "base64" | string;
  content: string;
  byteSize?: number;
};

export interface RepositoryGitHubClient {
  resolveReference(input: { repositoryFullName: string; reference: string; signal?: AbortSignal }): Promise<GitHubResolvedReference>;
  listRecursiveTree(input: { repositoryFullName: string; treeSha: string; signal?: AbortSignal }): Promise<GitHubRecursiveTree>;
  getBlob(input: { repositoryFullName: string; blobSha: string; signal?: AbortSignal }): Promise<GitHubBlob>;
}

export type GitHubAcquisitionLimits = {
  maxTreeEntries: number;
  maxTotalBlobBytes: number;
  maxBlobBytes: number;
  maxDepth: number;
  maxTextBytes: number;
  maxApiRequests: number;
  maxConcurrentBlobRequests: number;
};

export type GitHubAcquisitionResult = {
  result: RepositoryIngestionResult;
  acquisition: {
    repositoryFullName: string;
    requestedReference: string;
    commitSha: string;
    treeSha: string;
    treeEntriesSeen: number;
    blobsDownloaded: number;
    totalBlobBytes: number;
    apiRequests: number;
    networkAccess: true;
    writeAccess: false;
  };
};

export const defaultGitHubAcquisitionLimits: GitHubAcquisitionLimits = Object.freeze({
  maxTreeEntries: 100_000,
  maxTotalBlobBytes: 512 * 1024 * 1024,
  maxBlobBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxTextBytes: 1024 * 1024,
  maxApiRequests: 100_002,
  maxConcurrentBlobRequests: 4,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function validateLimits(overrides: Partial<GitHubAcquisitionLimits>): GitHubAcquisitionLimits {
  const limits = { ...defaultGitHubAcquisitionLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) assertPositiveSafeInteger(value, name);
  if (limits.maxTextBytes > limits.maxBlobBytes) throw new Error("maxTextBytes cannot exceed maxBlobBytes.");
  if (limits.maxConcurrentBlobRequests > 32) throw new Error("maxConcurrentBlobRequests cannot exceed 32.");
  return limits;
}

function validateRepositoryFullName(input: string): string {
  if (typeof input !== "string") throw new Error("GitHub repository name must be a string.");
  const value = input.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("GitHub repository name must use owner/repository form.");
  return value;
}

function validateReference(input: string): string {
  if (typeof input !== "string") throw new Error("GitHub reference must be a string.");
  const value = input.trim();
  if (!value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("GitHub reference is invalid.");
  return value;
}

function validateGitObjectSha(input: string, label: string): string {
  if (typeof input !== "string" || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(input)) {
    throw new Error(`${label} must be a 40- or 64-character Git object hash.`);
  }
  return input.toLowerCase();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("GitHub repository acquisition was cancelled.", "AbortError");
}

function decodeBase64(input: string): Uint8Array {
  if (typeof input !== "string") throw new Error("GitHub blob content is invalid.");
  const compact = input.replace(/\s+/g, "");
  if (compact.length === 0) return new Uint8Array();
  if (compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error("GitHub blob content is not valid base64.");
  }
  if (typeof globalThis.atob !== "function") throw new Error("Base64 decoding is unavailable in this environment.");
  let decoded: string;
  try {
    decoded = globalThis.atob(compact);
  } catch {
    throw new Error("GitHub blob content is not valid base64.");
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

type PlannedBlob = {
  path: string;
  sha: string;
  byteSize: number;
  generated?: boolean;
};

type ValidatedTree = {
  entries: RepositorySnapshotEntry[];
  blobs: PlannedBlob[];
  totalBlobBytes: number;
};

function generatedHint(path: string): boolean | undefined {
  const segments = path.toLowerCase().split("/");
  return segments.some((segment) => [".next", "coverage", "dist", "generated", "out", "target"].includes(segment)) ? true : undefined;
}

function validateTree(tree: GitHubRecursiveTree, limits: GitHubAcquisitionLimits): ValidatedTree {
  if (!tree || typeof tree !== "object" || !Array.isArray(tree.entries)) throw new Error("GitHub returned an invalid recursive tree.");
  if (tree.truncated !== false) throw new Error("GitHub returned a truncated recursive tree; acquisition cannot prove a complete snapshot.");
  if (tree.entries.length > limits.maxTreeEntries) throw new Error(`GitHub tree exceeds the ${limits.maxTreeEntries}-entry acquisition limit.`);

  const normalized = tree.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`GitHub tree entry ${index + 1} is invalid.`);
    const path = normalizeRepositoryPath(entry.path);
    if (path.split("/").length > limits.maxDepth) throw new Error(`GitHub tree entry exceeds the ${limits.maxDepth}-segment depth limit: ${path}`);
    const sha = validateGitObjectSha(entry.sha, `GitHub tree object for ${path}`);
    if (typeof entry.mode !== "string" || !/^[0-7]{6}$/.test(entry.mode)) throw new Error(`GitHub tree mode is invalid: ${path}`);
    if (!(["blob", "tree", "commit"] as const).includes(entry.type)) throw new Error(`GitHub tree type is unsupported: ${path}`);
    return { ...entry, path, sha };
  }).sort((left, right) => compareText(left.path, right.path));

  const seen = new Set<string>();
  const entries: RepositorySnapshotEntry[] = [];
  const blobs: PlannedBlob[] = [];
  let totalBlobBytes = 0;
  for (const entry of normalized) {
    if (seen.has(entry.path)) throw new Error(`GitHub tree contains a duplicate normalized path: ${entry.path}`);
    seen.add(entry.path);

    if (entry.mode === "120000") throw new Error(`GitHub symbolic links are not accepted: ${entry.path}`);
    if (entry.type === "commit" || entry.mode === "160000") throw new Error(`Git submodules are not followed in Repository Audit v0: ${entry.path}`);
    if (entry.type === "tree") {
      if (entry.mode !== "040000") throw new Error(`GitHub directory mode is invalid: ${entry.path}`);
      entries.push({ path: entry.path, kind: "directory" });
      continue;
    }
    if (entry.type !== "blob" || !/^100(?:644|755)$/.test(entry.mode)) throw new Error(`GitHub regular-file mode is unsupported: ${entry.path}`);
    if (!Number.isSafeInteger(entry.size) || (entry.size ?? -1) < 0) throw new Error(`GitHub blob size is missing or invalid: ${entry.path}`);
    const byteSize = entry.size!;
    if (byteSize > limits.maxBlobBytes) throw new Error(`GitHub blob exceeds the ${limits.maxBlobBytes}-byte acquisition limit: ${entry.path}`);
    totalBlobBytes += byteSize;
    if (!Number.isSafeInteger(totalBlobBytes) || totalBlobBytes > limits.maxTotalBlobBytes) {
      throw new Error(`GitHub repository exceeds the ${limits.maxTotalBlobBytes}-byte acquisition limit.`);
    }
    blobs.push({ path: entry.path, sha: entry.sha, byteSize, generated: generatedHint(entry.path) });
  }
  return { entries, blobs, totalBlobBytes };
}

async function downloadBlob(
  client: RepositoryGitHubClient,
  repositoryFullName: string,
  planned: PlannedBlob,
  signal?: AbortSignal,
): Promise<RepositorySnapshotEntry> {
  throwIfAborted(signal);
  const response = await client.getBlob({ repositoryFullName, blobSha: planned.sha, signal });
  throwIfAborted(signal);
  if (!response || typeof response !== "object") throw new Error(`GitHub returned an invalid blob response for ${planned.path}.`);
  const responseSha = validateGitObjectSha(response.sha, `GitHub blob response for ${planned.path}`);
  if (responseSha !== planned.sha) throw new Error(`GitHub blob identity changed during acquisition: ${planned.path}`);
  if (response.encoding !== "base64") throw new Error(`GitHub blob encoding is unsupported: ${planned.path}`);
  const bytes = decodeBase64(response.content);
  if (response.byteSize !== undefined && (!Number.isSafeInteger(response.byteSize) || response.byteSize < 0 || response.byteSize !== bytes.byteLength)) {
    throw new Error(`GitHub blob response size is invalid: ${planned.path}`);
  }
  if (bytes.byteLength !== planned.byteSize) throw new Error(`GitHub blob size changed during acquisition: ${planned.path}`);
  return {
    path: planned.path,
    kind: "file",
    bytes,
    declaredByteSize: planned.byteSize,
    ...(planned.generated === undefined ? {} : { generated: planned.generated }),
  };
}

async function downloadBlobs(
  client: RepositoryGitHubClient,
  repositoryFullName: string,
  blobs: readonly PlannedBlob[],
  concurrency: number,
  signal?: AbortSignal,
): Promise<RepositorySnapshotEntry[]> {
  const downloaded: RepositorySnapshotEntry[] = [];
  for (let index = 0; index < blobs.length; index += concurrency) {
    throwIfAborted(signal);
    const batch = blobs.slice(index, index + concurrency);
    downloaded.push(...await Promise.all(batch.map((blob) => downloadBlob(client, repositoryFullName, blob, signal))));
  }
  return downloaded;
}

export async function acquireGitHubRepositorySnapshot(input: {
  client: RepositoryGitHubClient;
  repositoryFullName: string;
  reference: string;
  limits?: Partial<GitHubAcquisitionLimits>;
  hashProvider?: RepositoryHashProvider;
  signal?: AbortSignal;
}): Promise<GitHubAcquisitionResult> {
  if (!input.client || typeof input.client !== "object") throw new Error("A GitHub acquisition client is required.");
  const limits = validateLimits(input.limits ?? {});
  const repositoryFullName = validateRepositoryFullName(input.repositoryFullName);
  const reference = validateReference(input.reference);
  throwIfAborted(input.signal);

  const resolved = await input.client.resolveReference({ repositoryFullName, reference, signal: input.signal });
  throwIfAborted(input.signal);
  if (!resolved || typeof resolved !== "object") throw new Error("GitHub returned an invalid resolved reference.");
  const commitSha = validateGitObjectSha(resolved.commitSha, "Resolved GitHub commit");
  const treeSha = validateGitObjectSha(resolved.treeSha, "Resolved GitHub tree");

  const tree = await input.client.listRecursiveTree({ repositoryFullName, treeSha, signal: input.signal });
  throwIfAborted(input.signal);
  const validated = validateTree(tree, limits);
  const apiRequests = 2 + validated.blobs.length;
  if (apiRequests > limits.maxApiRequests) throw new Error(`GitHub acquisition exceeds the ${limits.maxApiRequests}-request limit.`);

  const files = await downloadBlobs(
    input.client,
    repositoryFullName,
    validated.blobs,
    limits.maxConcurrentBlobRequests,
    input.signal,
  );
  throwIfAborted(input.signal);
  const result = await ingestGitHubSnapshotEntries({
    repositoryFullName,
    commitSha,
    entries: [...validated.entries, ...files],
    limits: {
      maxEntries: limits.maxTreeEntries,
      maxTotalBytes: limits.maxTotalBlobBytes,
      maxEntryBytes: limits.maxBlobBytes,
      maxDepth: limits.maxDepth,
      maxTextBytes: limits.maxTextBytes,
      maxArchiveBytes: defaultRepositoryIngestionLimits.maxArchiveBytes,
    },
    hashProvider: input.hashProvider,
  });

  return {
    result,
    acquisition: {
      repositoryFullName,
      requestedReference: reference,
      commitSha,
      treeSha,
      treeEntriesSeen: tree.entries.length,
      blobsDownloaded: validated.blobs.length,
      totalBlobBytes: validated.totalBlobBytes,
      apiRequests,
      networkAccess: true,
      writeAccess: false,
    },
  };
}
