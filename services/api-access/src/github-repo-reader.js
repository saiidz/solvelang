import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createAppJwt, createInstallationToken } from "./github-app.js";
import { ApiAccessError } from "./service.js";

// Repository reading for GitHub App audits: fetch a linked repository's
// tarball with an installation token and reduce it to a manifest —
// paths, sizes, sha256 — entirely in memory. Nothing is written to disk
// and nothing is executed; the analysis engine consumes the manifest in
// a later step. Hard caps bound every stage so a hostile or accidental
// archive cannot exhaust the Lambda: compressed size, decompressed
// size, file count, and per-file size (oversized files are skipped and
// recorded, never silently dropped).

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export const REPO_READ_LIMITS = {
  maxCompressedBytes: 25 * 1024 * 1024,
  maxExtractedBytes: 100 * 1024 * 1024,
  maxFiles: 5_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxSkipped: 1_000,
};

export class RepoReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RepoReadError";
    this.code = code;
  }
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "solvelang-api-access",
  };
}

function resolveLimits(limits) {
  const resolved = { ...REPO_READ_LIMITS };
  if (limits && typeof limits === "object") {
    for (const key of Object.keys(REPO_READ_LIMITS)) {
      if (limits[key] !== undefined) resolved[key] = limits[key];
    }
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Repository read limit ${key} is invalid.`);
  }
  return resolved;
}

// --- minimal tar reader -------------------------------------------------
// ustar layout: 512-byte header blocks; the file name may be split
// across the prefix field (155 bytes at offset 345) and the name field,
// or carried by a GNU longname ('L') / pax ('x') entry immediately
// before the file's own header. Sizes are octal, or base-256 when the
// high bit of the first size byte is set (GNU extension for >8GB).

function readTarString(block, offset, length) {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function readTarSize(block, offset) {
  if (block[offset] & 0x80) {
    let value = block[offset] & 0x7f;
    for (let index = offset + 1; index < offset + 12; index += 1) {
      value = value * 256 + block[index];
      if (!Number.isSafeInteger(value)) throw new RepoReadError("archive_invalid", "Tar entry size is not representable.");
    }
    return value;
  }
  const text = readTarString(block, offset, 12).trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new RepoReadError("archive_invalid", "Tar entry size is invalid.");
  return value;
}

function paxPath(data) {
  // pax extended header records: "<len> <key>=<value>\n"
  const text = data.toString("utf8");
  let cursor = 0;
  while (cursor < text.length) {
    const space = text.indexOf(" ", cursor);
    if (space === -1) return undefined;
    const length = Number.parseInt(text.slice(cursor, space), 10);
    if (!Number.isSafeInteger(length) || length <= 0) return undefined;
    const record = text.slice(space + 1, cursor + length - 1);
    if (record.startsWith("path=")) return record.slice("path=".length);
    cursor += length;
  }
  return undefined;
}

// Extracts a .tar buffer into a manifest. The first path segment of
// every entry is the archive root ("<repo>-<sha>/" from codeload) and
// is stripped. This function never touches the filesystem.
export function extractTar(buffer, limits = REPO_READ_LIMITS) {
  const caps = resolveLimits(limits);
  if (!Buffer.isBuffer(buffer)) throw new RepoReadError("archive_invalid", "Archive must be a buffer.");
  if (buffer.length > caps.maxExtractedBytes) {
    throw new RepoReadError("archive_too_large", "Repository archive exceeds the extracted size limit.");
  }
  const files = [];
  const skipped = [];
  let totalBytes = 0;
  let longName;
  let cursor = 0;
  const skip = (path, reason) => {
    if (skipped.length < caps.maxSkipped) skipped.push({ path, reason });
  };
  while (cursor + 512 <= buffer.length) {
    const header = buffer.subarray(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = readTarSize(header, 124);
    const type = String.fromCharCode(header[156]);
    const dataStart = cursor + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new RepoReadError("archive_invalid", "Tar entry overruns the archive.");
    const data = buffer.subarray(dataStart, dataEnd);
    cursor = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x") { longName = paxPath(data) ?? longName; continue; }
    if (type === "g") continue;

    const fromLongName = longName !== undefined;
    let path = longName ?? readTarString(header, 0, 100);
    longName = undefined;
    if (!fromLongName) {
      const prefix = readTarString(header, 345, 155);
      if (prefix) path = `${prefix}/${path}`;
    }
    if (type !== "0" && type !== "\0" && type !== "") continue; // directories and links are not files

    const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.length <= 1) continue; // the archive root itself
    const relative = segments.slice(1).join("/");
    if (segments.includes("..")) { skip(relative, "unsafe_path"); continue; }
    if (size > caps.maxFileBytes) { skip(relative, "file_too_large"); continue; }
    if (files.length >= caps.maxFiles) {
      throw new RepoReadError("too_many_files", "Repository archive exceeds the file count limit.");
    }
    const content = Buffer.from(data);
    files.push({
      path: relative,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    totalBytes += content.length;
  }
  return { files, skipped, totals: { files: files.length, bytes: totalBytes, skipped: skipped.length } };
}

export function extractTarGzip(compressed, limits = REPO_READ_LIMITS) {
  const caps = resolveLimits(limits);
  if (!Buffer.isBuffer(compressed)) throw new RepoReadError("archive_invalid", "Archive must be a buffer.");
  if (compressed.length > caps.maxCompressedBytes) {
    throw new RepoReadError("archive_too_large", "Repository archive exceeds the compressed size limit.");
  }
  let buffer;
  try {
    buffer = gunzipSync(compressed);
  } catch {
    throw new RepoReadError("archive_invalid", "Repository archive is not a valid gzip stream.");
  }
  return extractTar(buffer, caps);
}

// Fetches the repository metadata, the default branch head, and the
// branch tarball with the installation token, then reduces the archive
// to a manifest. commitSha comes from the branch payload — the one
// place GitHub states it unambiguously (the tarball root directory name
// also embeds it, but repo names may contain dashes, so it is never
// parsed back out).
export async function readRepositoryArchive({ token, owner, repo, fetchImpl = fetch, limits } = {}) {
  if (typeof token !== "string" || !token) throw new Error("GitHub installation token is required.");
  if (typeof owner !== "string" || !owner || typeof repo !== "string" || !repo) throw new Error("Repository owner and name are required.");
  const caps = resolveLimits(limits);
  const headers = githubHeaders(token);
  const repoPath = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const repoResponse = await fetchImpl(repoPath, { headers });
  const repoPayload = await repoResponse.json().catch(() => null);
  if (!repoResponse.ok || !repoPayload || typeof repoPayload.default_branch !== "string" || !repoPayload.default_branch) {
    throw new RepoReadError("repo_unavailable", "Repository metadata could not be read from GitHub.");
  }
  const defaultBranch = repoPayload.default_branch;

  const branchResponse = await fetchImpl(`${repoPath}/branches/${encodeURIComponent(defaultBranch)}`, { headers });
  const branchPayload = await branchResponse.json().catch(() => null);
  const commitSha = branchPayload?.commit?.sha;
  if (!branchResponse.ok || typeof commitSha !== "string" || !commitSha) {
    throw new RepoReadError("repo_unavailable", "Repository branch head could not be read from GitHub.");
  }

  const tarballResponse = await fetchImpl(`${repoPath}/tarball/${encodeURIComponent(defaultBranch)}`, {
    headers,
    redirect: "follow",
  });
  if (!tarballResponse.ok) throw new RepoReadError("repo_unavailable", "Repository archive could not be read from GitHub.");
  const declaredLength = Number(tarballResponse.headers?.get?.("content-length"));
  if (Number.isSafeInteger(declaredLength) && declaredLength > caps.maxCompressedBytes) {
    throw new RepoReadError("archive_too_large", "Repository archive exceeds the compressed size limit.");
  }
  const compressed = Buffer.from(await tarballResponse.arrayBuffer());
  const manifest = extractTarGzip(compressed, caps);
  return {
    repoFullName: typeof repoPayload.full_name === "string" ? repoPayload.full_name : `${owner}/${repo}`,
    defaultBranch,
    commitSha,
    files: manifest.files,
    skipped: manifest.skipped,
    totals: manifest.totals,
  };
}

// The audit read flow: the installation must be LINKED to the caller's
// account and the repository must be one the installation reports. The
// read itself either completes (a read_complete run record + the
// manifest totals) or fails after minting (a read_failed run record +
// a generic 502) — a failed read never masquerades as a completed
// audit, and no audit verdict is produced at this stage by design.
export async function runRepositoryAuditRead({ store, appId, privateKey, accountId, installationId, repoFullName, fetchImpl = fetch, now = Date.now, runId } = {}) {
  if (!store || typeof store.listInstallationsForAccount !== "function" || typeof store.putAuditRun !== "function") {
    throw new Error("GitHub installation store is required.");
  }
  if (typeof accountId !== "string" || !accountId
    || !Number.isSafeInteger(installationId) || installationId <= 0
    || typeof repoFullName !== "string" || !repoFullName) {
    throw new ApiAccessError(400, "github_audit_invalid", "The audit request is invalid.");
  }
  const linked = await store.listInstallationsForAccount(accountId);
  const installation = linked.find((entry) => entry.installationId === installationId);
  if (!installation) {
    throw new ApiAccessError(404, "github_installation_not_linked", "That GitHub installation is not linked to your account.");
  }
  if (installation.suspended) {
    throw new ApiAccessError(403, "github_installation_suspended", "That GitHub installation is suspended.");
  }
  const repository = (installation.repositories ?? []).find((entry) => entry.fullName === repoFullName);
  if (!repository) {
    throw new ApiAccessError(403, "github_repo_not_linked", "That repository is not part of the linked installation.");
  }
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo || repoFullName.split("/").length !== 2) {
    throw new ApiAccessError(400, "github_audit_invalid", "The audit request is invalid.");
  }

  const effectiveRunId = typeof runId === "string" && runId ? runId : `run_${randomBytes(12).toString("hex")}`;
  const createdAt = new Date(typeof now === "function" ? now() : now).toISOString();
  let manifest;
  try {
    const appJwt = createAppJwt({ appId, privateKey, now });
    const { token } = await createInstallationToken({ appJwt, installationId, fetchImpl });
    manifest = await readRepositoryArchive({ token, owner, repo, fetchImpl });
  } catch {
    await store.putAuditRun({
      accountId, runId: effectiveRunId, installationId, repoFullName,
      status: "read_failed", createdAt,
    });
    throw new ApiAccessError(502, "github_repo_read_failed", "The repository could not be read from GitHub.");
  }

  await store.putAuditRun({
    accountId, runId: effectiveRunId, installationId, repoFullName,
    status: "read_complete",
    manifest: { defaultBranch: manifest.defaultBranch, commitSha: manifest.commitSha, totals: manifest.totals },
    createdAt,
  });
  return { runId: effectiveRunId, status: "read_complete", totals: manifest.totals };
}
