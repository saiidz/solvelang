import { createHash } from "node:crypto";
import { extractTarGzip, RepoReadError, REPO_READ_LIMITS } from "./github-repo-reader.js";

// Repository reading for the non-GitHub platform doors (GitLab,
// Azure DevOps, Bitbucket, Forgejo / Gitea): the live audit legs
// behind the platform connections. Each reader fetches one
// repository from its platform's own API with the customer's
// stored access token and reduces it to the SAME manifest the
// GitHub leg produces — paths, sizes, sha256 of contents — under
// the same hard caps (github-repo-reader.js REPO_READ_LIMITS), so
// a run record means the same thing on every platform. Nothing is
// written to disk and nothing is executed.
//
// GitLab and Forgejo / Gitea publish a real archive download, so
// those readers reuse the GitHub leg's tar extractor unchanged.
// Azure DevOps and Bitbucket Cloud publish no archive endpoint:
// those readers walk the platform's recursive listing and fetch
// each file's real contents, hashing what was actually read (a
// listed size alone is never hashed or trusted — it is used only
// to skip an oversized file before fetching it).
//
// Every platform failure is a RepoReadError with code
// "repo_unavailable" (or an archive cap error from the shared
// extractor), exactly like the GitHub leg: a failed read is
// recorded read_failed by the caller and never masquerades as a
// completed audit.

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

async function fetchJson(fetchImpl, url, headers, platformLabel) {
  const response = await fetchImpl(url, { headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new RepoReadError("repo_unavailable", `Repository data could not be read from ${platformLabel}.`);
  }
  return payload;
}

async function fetchArchive(fetchImpl, url, headers, caps, platformLabel) {
  const response = await fetchImpl(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new RepoReadError("repo_unavailable", `Repository archive could not be read from ${platformLabel}.`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isSafeInteger(declaredLength) && declaredLength > caps.maxCompressedBytes) {
    throw new RepoReadError("archive_too_large", "Repository archive exceeds the compressed size limit.");
  }
  const compressed = Buffer.from(await response.arrayBuffer());
  return extractTarGzip(compressed, caps);
}

async function fetchContent(fetchImpl, url, headers, platformLabel) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new RepoReadError("repo_unavailable", `Repository file content could not be read from ${platformLabel}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Incremental manifest for the listing-based platforms, under the
// same caps and skip discipline as the tar extractor.
function createManifestBuilder(caps) {
  const files = [];
  const skipped = [];
  let totalBytes = 0;
  const skip = (path, reason) => {
    if (skipped.length < caps.maxSkipped) skipped.push({ path, reason });
  };
  return {
    get fileCount() {
      return files.length;
    },
    skip,
    async add(path, knownSize, loadContent) {
      const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
      if (segments.includes("..")) {
        skip(path, "unsafe_path");
        return;
      }
      if (knownSize !== null && knownSize > caps.maxFileBytes) {
        skip(path, "file_too_large");
        return;
      }
      if (files.length >= caps.maxFiles) {
        throw new RepoReadError("too_many_files", "Repository listing exceeds the file count limit.");
      }
      const content = await loadContent();
      if (content.length > caps.maxFileBytes) {
        skip(path, "file_too_large");
        return;
      }
      files.push({
        path,
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
      totalBytes += content.length;
      if (totalBytes > caps.maxExtractedBytes) {
        throw new RepoReadError("archive_too_large", "Repository contents exceed the extracted size limit.");
      }
    },
    result() {
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files, skipped, totals: { files: files.length, bytes: totalBytes, skipped: skipped.length } };
    },
  };
}

function requireTokenAndFetch(token, fetchImpl) {
  if (typeof token !== "string" || !token) throw new Error("Platform access token is required.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
}

// --- GitLab -------------------------------------------------------------
// REST v4: project metadata, branch head, and the repository
// archive download (tar.gz of a commit). A personal / project
// access token is accepted in the PRIVATE-TOKEN header or as a
// Bearer token; both are sent so either token kind works.
export async function readGitLabArchive({ token, baseUrl, projectPath, fetchImpl = fetch, limits } = {}) {
  requireTokenAndFetch(token, fetchImpl);
  if (typeof baseUrl !== "string" || !baseUrl || typeof projectPath !== "string" || !projectPath) {
    throw new Error("GitLab instance URL and project path are required.");
  }
  const caps = resolveLimits(limits);
  const base = baseUrl.replace(/\/+$/, "");
  const headers = {
    "private-token": token,
    authorization: `Bearer ${token}`,
    "user-agent": "solvelang-api-access",
  };
  const projectId = encodeURIComponent(projectPath);
  const project = await fetchJson(fetchImpl, `${base}/api/v4/projects/${projectId}`, headers, "GitLab");
  if (typeof project.default_branch !== "string" || !project.default_branch) {
    throw new RepoReadError("repo_unavailable", "Repository metadata could not be read from GitLab.");
  }
  const defaultBranch = project.default_branch;
  const branch = await fetchJson(
    fetchImpl,
    `${base}/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(defaultBranch)}`,
    headers,
    "GitLab",
  );
  const commitSha = branch?.commit?.id;
  if (typeof commitSha !== "string" || !commitSha) {
    throw new RepoReadError("repo_unavailable", "Repository branch head could not be read from GitLab.");
  }
  const manifest = await fetchArchive(
    fetchImpl,
    `${base}/api/v4/projects/${projectId}/repository/archive.tar.gz?sha=${encodeURIComponent(commitSha)}`,
    headers,
    caps,
    "GitLab",
  );
  return {
    repoFullName: typeof project.path_with_namespace === "string" ? project.path_with_namespace : projectPath,
    defaultBranch,
    commitSha,
    files: manifest.files,
    skipped: manifest.skipped,
    totals: manifest.totals,
  };
}

// --- Forgejo / Gitea ------------------------------------------------------
// One API family (/api/v1) serves both: repository metadata, the
// branch head, and the archive download for a ref (tar.gz). The
// token travels in the platform's own Authorization scheme.
export async function readForgeArchive({ token, baseUrl, owner, repo, fetchImpl = fetch, limits } = {}) {
  requireTokenAndFetch(token, fetchImpl);
  if (typeof baseUrl !== "string" || !baseUrl || typeof owner !== "string" || !owner || typeof repo !== "string" || !repo) {
    throw new Error("Forge instance URL and repository owner and name are required.");
  }
  const caps = resolveLimits(limits);
  const base = baseUrl.replace(/\/+$/, "");
  const headers = {
    accept: "application/json",
    authorization: `token ${token}`,
    "user-agent": "solvelang-api-access",
  };
  const repoPath = `${base}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await fetchJson(fetchImpl, repoPath, headers, "the Forgejo / Gitea instance");
  if (typeof repository.default_branch !== "string" || !repository.default_branch) {
    throw new RepoReadError("repo_unavailable", "Repository metadata could not be read from the Forgejo / Gitea instance.");
  }
  const defaultBranch = repository.default_branch;
  const branch = await fetchJson(
    fetchImpl,
    `${repoPath}/branches/${encodeURIComponent(defaultBranch)}`,
    headers,
    "the Forgejo / Gitea instance",
  );
  const commitSha = branch?.commit?.id;
  if (typeof commitSha !== "string" || !commitSha) {
    throw new RepoReadError("repo_unavailable", "Repository branch head could not be read from the Forgejo / Gitea instance.");
  }
  const manifest = await fetchArchive(
    fetchImpl,
    `${repoPath}/archive/${encodeURIComponent(commitSha)}.tar.gz`,
    headers,
    caps,
    "the Forgejo / Gitea instance",
  );
  return {
    repoFullName: typeof repository.full_name === "string" ? repository.full_name : `${owner}/${repo}`,
    defaultBranch,
    commitSha,
    files: manifest.files,
    skipped: manifest.skipped,
    totals: manifest.totals,
  };
}

// --- Azure DevOps -----------------------------------------------------------
// REST 7.1 on dev.azure.com. There is no archive download: the
// recursive items listing names every blob, and each blob's raw
// content is fetched individually and hashed. A personal access
// token is HTTP Basic with an empty user name.
export async function readAzureArchive({ token, organization, project, repository, fetchImpl = fetch, limits } = {}) {
  requireTokenAndFetch(token, fetchImpl);
  if (typeof organization !== "string" || !organization || typeof project !== "string" || !project
    || typeof repository !== "string" || !repository) {
    throw new Error("Azure DevOps organization, project, and repository are required.");
  }
  const caps = resolveLimits(limits);
  const headers = {
    authorization: `Basic ${Buffer.from(`:${token}`, "utf8").toString("base64")}`,
    "user-agent": "solvelang-api-access",
  };
  const base = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories`;
  const repo = await fetchJson(fetchImpl, `${base}/${encodeURIComponent(repository)}?api-version=7.1`, headers, "Azure DevOps");
  if (typeof repo.id !== "string" || !repo.id || typeof repo.defaultBranch !== "string" || !repo.defaultBranch) {
    throw new RepoReadError("repo_unavailable", "Repository metadata could not be read from Azure DevOps.");
  }
  const defaultBranch = repo.defaultBranch.replace(/^refs\/heads\//, "");
  const refs = await fetchJson(
    fetchImpl,
    `${base}/${repo.id}/refs?filter=${encodeURIComponent(`heads/${defaultBranch}`)}&api-version=7.1`,
    headers,
    "Azure DevOps",
  );
  const commitSha = Array.isArray(refs.value) ? refs.value[0]?.objectId : undefined;
  if (typeof commitSha !== "string" || !commitSha) {
    throw new RepoReadError("repo_unavailable", "Repository branch head could not be read from Azure DevOps.");
  }

  const builder = createManifestBuilder(caps);
  let continuationToken;
  do {
    const query = new URLSearchParams({
      scopePath: "/",
      recursionLevel: "Full",
      includeLinks: "false",
      // Pin the listing to the resolved head commit so the manifest
      // describes one commit even if the branch moves mid-read.
      "versionDescriptor.version": commitSha,
      "versionDescriptor.versionType": "commit",
      "api-version": "7.1",
    });
    if (continuationToken) query.set("continuationToken", continuationToken);
    const page = await fetchImpl(`${base}/${repo.id}/items?${query}`, { headers });
    const payload = await page.json().catch(() => null);
    if (!page.ok || !payload || !Array.isArray(payload.value)) {
      throw new RepoReadError("repo_unavailable", "Repository listing could not be read from Azure DevOps.");
    }
    for (const item of payload.value) {
      if (!item || item.isFolder || typeof item.path !== "string") continue;
      const path = item.path.replace(/^\//, "");
      if (!path) continue;
      const knownSize = Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null;
      const contentQuery = new URLSearchParams({
        path: item.path,
        "versionDescriptor.version": commitSha,
        "versionDescriptor.versionType": "commit",
        "api-version": "7.1",
      });
      await builder.add(path, knownSize, () => fetchContent(
        fetchImpl,
        `${base}/${repo.id}/items?${contentQuery}`,
        { ...headers, accept: "application/octet-stream" },
        "Azure DevOps",
      ));
    }
    continuationToken = page.headers?.get?.("x-ms-continuationtoken") || undefined;
  } while (continuationToken);

  const manifest = builder.result();
  return {
    repoFullName: typeof repo.name === "string" ? repo.name : repository,
    defaultBranch,
    commitSha,
    files: manifest.files,
    skipped: manifest.skipped,
    totals: manifest.totals,
  };
}

// --- Bitbucket Cloud --------------------------------------------------------
// REST 2.0 on api.bitbucket.org. There is no archive download: the
// src listing at the head commit names every file, and each file's
// raw content is fetched from its own self link and hashed. The
// connection's token is a repository / workspace access token,
// sent as a Bearer token.
export async function readBitbucketArchive({ token, workspace, repoSlug, fetchImpl = fetch, limits } = {}) {
  requireTokenAndFetch(token, fetchImpl);
  if (typeof workspace !== "string" || !workspace || typeof repoSlug !== "string" || !repoSlug) {
    throw new Error("Bitbucket workspace and repository slug are required.");
  }
  const caps = resolveLimits(limits);
  const headers = {
    authorization: `Bearer ${token}`,
    "user-agent": "solvelang-api-access",
  };
  const base = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
  const repository = await fetchJson(fetchImpl, base, headers, "Bitbucket");
  const defaultBranch = repository?.mainbranch?.name;
  if (typeof defaultBranch !== "string" || !defaultBranch) {
    throw new RepoReadError("repo_unavailable", "Repository metadata could not be read from Bitbucket.");
  }
  const commits = await fetchJson(
    fetchImpl,
    `${base}/commits/${encodeURIComponent(defaultBranch)}?pagelen=1`,
    headers,
    "Bitbucket",
  );
  const commitSha = Array.isArray(commits.values) ? commits.values[0]?.hash : undefined;
  if (typeof commitSha !== "string" || !commitSha) {
    throw new RepoReadError("repo_unavailable", "Repository branch head could not be read from Bitbucket.");
  }

  const builder = createManifestBuilder(caps);
  let next = `${base}/src/${encodeURIComponent(commitSha)}/?pagelen=100`;
  let pages = 0;
  while (next) {
    pages += 1;
    if (pages > 500) throw new RepoReadError("too_many_files", "Repository listing exceeds the page limit.");
    const page = await fetchJson(fetchImpl, next, headers, "Bitbucket");
    if (!Array.isArray(page.values)) {
      throw new RepoReadError("repo_unavailable", "Repository listing could not be read from Bitbucket.");
    }
    for (const entry of page.values) {
      if (!entry || entry.type !== "commit_file" || typeof entry.path !== "string" || !entry.path) continue;
      const knownSize = Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null;
      const selfHref = entry.links?.self?.href;
      if (typeof selfHref !== "string" || !selfHref) {
        builder.skip(entry.path, "content_unavailable");
        continue;
      }
      await builder.add(entry.path, knownSize, () => fetchContent(fetchImpl, selfHref, headers, "Bitbucket"));
    }
    next = typeof page.next === "string" && page.next ? page.next : undefined;
  }

  const manifest = builder.result();
  return {
    repoFullName: typeof repository.full_name === "string" ? repository.full_name : `${workspace}/${repoSlug}`,
    defaultBranch,
    commitSha,
    files: manifest.files,
    skipped: manifest.skipped,
    totals: manifest.totals,
  };
}

// Dispatches one stored repository entry of a connection to its
// platform's reader. `connection` is the stored connection record
// (identifiers only); `repository` is the one entry being read.
export async function readPlatformRepository({ platform, token, connection, repository, fetchImpl = fetch, limits } = {}) {
  if (!connection || typeof connection !== "object") throw new Error("A platform connection record is required.");
  if (platform === "gitlab") {
    return readGitLabArchive({ token, baseUrl: connection.baseUrl, projectPath: repository, fetchImpl, limits });
  }
  if (platform === "forge") {
    const parts = typeof repository === "string" ? repository.split("/") : [];
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Forge repository must be an owner/name pair.");
    return readForgeArchive({ token, baseUrl: connection.baseUrl, owner: parts[0], repo: parts[1], fetchImpl, limits });
  }
  if (platform === "azure") {
    return readAzureArchive({
      token,
      organization: connection.organization,
      project: connection.project,
      repository,
      fetchImpl,
      limits,
    });
  }
  if (platform === "bitbucket") {
    return readBitbucketArchive({ token, workspace: connection.workspace, repoSlug: repository, fetchImpl, limits });
  }
  throw new Error(`Platform ${platform} has no repository reader.`);
}
