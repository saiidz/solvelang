import type { SelfDrivingPatchMaterialization } from "./selfDrivingPatchMaterialization";
import type {
  SelfDrivingPrWriteBranchRequest,
  SelfDrivingPrWriteCommitRequest,
  SelfDrivingPrWritePullRequestRequest,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_GITHUB_REST_REQUEST_SCHEMA =
  "solvelang.self-driving.github-rest-request.v0" as const;
export const SELF_DRIVING_GITHUB_API_ORIGIN = "https://api.github.com" as const;
export const SELF_DRIVING_GITHUB_API_VERSION = "2026-03-10" as const;
export const SELF_DRIVING_GITHUB_ACCEPT = "application/vnd.github+json" as const;

export const SELF_DRIVING_GITHUB_REST_OPERATIONS = [
  "get-base-branch",
  "get-base-rules",
  "get-head-ref",
  "get-base-commit",
  "get-base-tree-recursive",
  "get-base-blob",
  "create-head-ref",
  "create-tree",
  "create-commit",
  "update-head-ref",
  "open-pull-request",
] as const;
export type SelfDrivingGitHubRestOperation = (typeof SELF_DRIVING_GITHUB_REST_OPERATIONS)[number];

export type SelfDrivingGitHubFileMode = "100644" | "100755";
export type SelfDrivingGitHubFileModeEvidence = Readonly<{
  path: string;
  blobSha: string;
  mode: SelfDrivingGitHubFileMode;
}>;

export type SelfDrivingGitHubRestPermission =
  | "metadata:read"
  | "contents:read"
  | "contents:write"
  | "pull-requests:write";

export type SelfDrivingGitHubRestRequestPlan = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_REST_REQUEST_SCHEMA;
  operation: SelfDrivingGitHubRestOperation;
  method: "GET" | "POST" | "PATCH";
  origin: typeof SELF_DRIVING_GITHUB_API_ORIGIN;
  path: string;
  url: string;
  headers: Readonly<{
    Accept: typeof SELF_DRIVING_GITHUB_ACCEPT;
    "X-GitHub-Api-Version": typeof SELF_DRIVING_GITHUB_API_VERSION;
  }>;
  body?: Readonly<Record<string, unknown>>;
  expectedStatuses: readonly number[];
  maxResponseBytes: number;
  requiredPermission: SelfDrivingGitHubRestPermission;
  policy: Readonly<{
    authorizationHeaderIncluded: false;
    credentialMaterialIncluded: false;
    redirectsAllowed: false;
    retries: 0;
    automaticMergeAllowed: false;
    forcePushAllowed: false;
    directProtectedBaseWriteAllowed: false;
  }>;
}>;

export const defaultSelfDrivingGitHubRestPlannerLimits = Object.freeze({
  maxBranchResponseBytes: 262_144,
  maxRulesResponseBytes: 524_288,
  maxRefResponseBytes: 131_072,
  maxCommitResponseBytes: 262_144,
  maxTreeResponseBytes: 8_388_608,
  maxBlobResponseBytes: 1_572_864,
  maxWriteResponseBytes: 262_144,
  maxPullRequestResponseBytes: 524_288,
  maxFiles: 50,
  maxCommitMessageLength: 256,
  maxPullRequestTitleLength: 256,
  maxPullRequestBodyLength: 2048,
});

const credentialLikePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  if (credentialLikePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${name} contains credential-like material.`);
  }
  return normalized;
}

function normalizeRepository(value: string): { repository: string; owner: string; repo: string } {
  const repository = normalizeText(value, "repository", 201);
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("repository must use exact owner/name syntax.");
  }
  const [owner, repo] = repository.split("/");
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("repository contains an unsafe owner or name.");
  }
  return { repository, owner, repo };
}

function normalizeBranch(value: string, name: string): string {
  const branch = normalizeText(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch)) {
    throw new Error(`${name} contains unsupported branch characters.`);
  }
  if (
    branch.startsWith("refs/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.includes("..")
    || branch.includes("//")
    || branch.includes("@{")
    || branch.split("/").some((segment) => segment === "." || segment === ".." || segment.endsWith(".lock"))
  ) {
    throw new Error(`${name} is not a canonical safe branch name.`);
  }
  return branch;
}

function normalizeGitSha(value: string, name: string): string {
  const sha = normalizeText(value, name, 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${name} must be an exact 40-hex Git SHA.`);
  return sha;
}

function normalizePath(value: string, name: string): string {
  const path = normalizeText(value, name, 512);
  if (path.startsWith("/") || path.includes("\\") || path.includes("//")) {
    throw new Error(`${name} must be a canonical repository-relative path.`);
  }
  if (path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${name} contains an unsafe path segment.`);
  }
  return path;
}

function encodeBranch(branch: string): string {
  return encodeURIComponent(branch);
}

function encodeRef(branch: string): string {
  return `heads/${branch.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function request(
  operation: SelfDrivingGitHubRestOperation,
  method: SelfDrivingGitHubRestRequestPlan["method"],
  path: string,
  expectedStatuses: readonly number[],
  maxResponseBytes: number,
  requiredPermission: SelfDrivingGitHubRestPermission,
  body?: Record<string, unknown>,
): SelfDrivingGitHubRestRequestPlan {
  if (!path.startsWith("/") || path.includes("?") && !path.endsWith("?recursive=1")) {
    throw new Error("GitHub REST planner produced an unsupported path/query shape.");
  }
  const url = `${SELF_DRIVING_GITHUB_API_ORIGIN}${path}`;
  const serialized = JSON.stringify(body ?? {});
  if (credentialLikePatterns.some((pattern) => pattern.test(url) || pattern.test(serialized))) {
    throw new Error("GitHub REST request plan contains credential-like material.");
  }
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_REST_REQUEST_SCHEMA,
    operation,
    method,
    origin: SELF_DRIVING_GITHUB_API_ORIGIN,
    path,
    url,
    headers: Object.freeze({
      Accept: SELF_DRIVING_GITHUB_ACCEPT,
      "X-GitHub-Api-Version": SELF_DRIVING_GITHUB_API_VERSION,
    }),
    ...(body ? { body: Object.freeze(body) } : {}),
    expectedStatuses: Object.freeze([...expectedStatuses]),
    maxResponseBytes,
    requiredPermission,
    policy: Object.freeze({
      authorizationHeaderIncluded: false as const,
      credentialMaterialIncluded: false as const,
      redirectsAllowed: false as const,
      retries: 0 as const,
      automaticMergeAllowed: false as const,
      forcePushAllowed: false as const,
      directProtectedBaseWriteAllowed: false as const,
    }),
  });
}

function repoPrefix(repository: string): { prefix: string; repository: string } {
  const parsed = normalizeRepository(repository);
  return {
    prefix: `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
    repository: parsed.repository,
  };
}

export function planSelfDrivingGitHubLivePreflightRequests(
  plan: SelfDrivingPrWriteExecutionPlan,
): readonly SelfDrivingGitHubRestRequestPlan[] {
  const { prefix } = repoPrefix(plan.repository);
  const base = normalizeBranch(plan.baseBranch, "baseBranch");
  const head = normalizeBranch(plan.headBranch, "headBranch");
  const revision = normalizeGitSha(plan.baseRevision, "baseRevision");
  if (base === head) throw new Error("GitHub REST planner forbids a PR head equal to the protected base branch.");

  return Object.freeze([
    request(
      "get-base-branch",
      "GET",
      `${prefix}/branches/${encodeBranch(base)}`,
      [200],
      defaultSelfDrivingGitHubRestPlannerLimits.maxBranchResponseBytes,
      "contents:read",
    ),
    request(
      "get-base-rules",
      "GET",
      `${prefix}/rules/branches/${encodeBranch(base)}`,
      [200],
      defaultSelfDrivingGitHubRestPlannerLimits.maxRulesResponseBytes,
      "metadata:read",
    ),
    request(
      "get-head-ref",
      "GET",
      `${prefix}/git/ref/${encodeRef(head)}`,
      [200, 404],
      defaultSelfDrivingGitHubRestPlannerLimits.maxRefResponseBytes,
      "contents:read",
    ),
    request(
      "get-base-commit",
      "GET",
      `${prefix}/git/commits/${revision}`,
      [200],
      defaultSelfDrivingGitHubRestPlannerLimits.maxCommitResponseBytes,
      "contents:read",
    ),
  ]);
}

export function planSelfDrivingGitHubBaseTreeRequest(
  repository: string,
  treeSha: string,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(repository);
  const tree = normalizeGitSha(treeSha, "treeSha");
  return request(
    "get-base-tree-recursive",
    "GET",
    `${prefix}/git/trees/${tree}?recursive=1`,
    [200],
    defaultSelfDrivingGitHubRestPlannerLimits.maxTreeResponseBytes,
    "contents:read",
  );
}

export function planSelfDrivingGitHubBaseBlobRequest(
  repository: string,
  blobSha: string,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(repository);
  const blob = normalizeGitSha(blobSha, "blobSha");
  return request(
    "get-base-blob",
    "GET",
    `${prefix}/git/blobs/${blob}`,
    [200],
    defaultSelfDrivingGitHubRestPlannerLimits.maxBlobResponseBytes,
    "contents:read",
  );
}

export function planSelfDrivingGitHubCreateBranchRequest(
  value: SelfDrivingPrWriteBranchRequest,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(value.repository);
  const head = normalizeBranch(value.headBranch, "headBranch");
  const revision = normalizeGitSha(value.baseRevision, "baseRevision");
  return request(
    "create-head-ref",
    "POST",
    `${prefix}/git/refs`,
    [201],
    defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    "contents:write",
    {
      ref: `refs/heads/${head}`,
      sha: revision,
    },
  );
}

function normalizeModes(
  commitRequest: SelfDrivingPrWriteCommitRequest,
  modes: readonly SelfDrivingGitHubFileModeEvidence[],
  materialization: SelfDrivingPatchMaterialization,
): readonly Readonly<{ path: string; mode: SelfDrivingGitHubFileMode; content: string }>[] {
  if (!Array.isArray(modes) || modes.length !== commitRequest.files.length) {
    throw new Error("GitHub tree mode evidence must cover every planned file exactly once.");
  }
  if (!materialization || materialization.status !== "materialized" || materialization.planId !== commitRequest.planId) {
    throw new Error("GitHub tree planning requires materialization for the exact execution plan.");
  }
  const planned = new Map(commitRequest.files.map((file) => [file.path, file.baseBlobSha]));
  const materialized = new Map(materialization.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const entries: Array<Readonly<{ path: string; mode: SelfDrivingGitHubFileMode; content: string }>> = [];
  for (let index = 0; index < modes.length; index += 1) {
    const evidence = modes[index];
    const path = normalizePath(evidence.path, `modes[${index}].path`);
    if (seen.has(path)) throw new Error(`GitHub tree mode evidence duplicates path ${path}.`);
    seen.add(path);
    const expectedBlob = planned.get(path);
    if (!expectedBlob) throw new Error(`GitHub tree mode evidence contains unplanned path ${path}.`);
    if (normalizeGitSha(evidence.blobSha, `modes[${index}].blobSha`) !== expectedBlob) {
      throw new Error(`GitHub tree mode evidence blob does not match the reviewed plan for ${path}.`);
    }
    if (evidence.mode !== "100644" && evidence.mode !== "100755") {
      throw new Error(`GitHub tree mode for ${path} is not a supported regular-file mode.`);
    }
    const result = materialized.get(path);
    if (!result || result.baseBlobSha !== expectedBlob) {
      throw new Error(`Materialized content does not match the reviewed base blob for ${path}.`);
    }
    entries.push(Object.freeze({ path, mode: evidence.mode, content: result.content }));
  }
  entries.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze(entries);
}

export function planSelfDrivingGitHubCreateTreeRequest(
  value: SelfDrivingPrWriteCommitRequest,
  baseTreeSha: string,
  modes: readonly SelfDrivingGitHubFileModeEvidence[],
  materialization: SelfDrivingPatchMaterialization,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(value.repository);
  const baseTree = normalizeGitSha(baseTreeSha, "baseTreeSha");
  const entries = normalizeModes(value, modes, materialization);
  return request(
    "create-tree",
    "POST",
    `${prefix}/git/trees`,
    [201],
    defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    "contents:write",
    {
      base_tree: baseTree,
      tree: entries.map((entry) => ({
        path: entry.path,
        mode: entry.mode,
        type: "blob",
        content: entry.content,
      })),
    },
  );
}

export function planSelfDrivingGitHubCreateCommitRequest(
  value: SelfDrivingPrWriteCommitRequest,
  treeSha: string,
  message = "Solve Self-Driving: reviewed validated change",
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(value.repository);
  const tree = normalizeGitSha(treeSha, "treeSha");
  const parent = normalizeGitSha(value.expectedParentRevision, "expectedParentRevision");
  const commitMessage = normalizeText(message, "commitMessage", defaultSelfDrivingGitHubRestPlannerLimits.maxCommitMessageLength);
  return request(
    "create-commit",
    "POST",
    `${prefix}/git/commits`,
    [201],
    defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    "contents:write",
    {
      message: commitMessage,
      tree,
      parents: [parent],
    },
  );
}

export function planSelfDrivingGitHubUpdateHeadRefRequest(
  value: SelfDrivingPrWriteCommitRequest,
  commitSha: string,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(value.repository);
  const head = normalizeBranch(value.headBranch, "headBranch");
  const commit = normalizeGitSha(commitSha, "commitSha");
  return request(
    "update-head-ref",
    "PATCH",
    `${prefix}/git/refs/${encodeRef(head)}`,
    [200],
    defaultSelfDrivingGitHubRestPlannerLimits.maxWriteResponseBytes,
    "contents:write",
    {
      sha: commit,
      force: false,
    },
  );
}

export function planSelfDrivingGitHubOpenPullRequestRequest(
  value: SelfDrivingPrWritePullRequestRequest,
): SelfDrivingGitHubRestRequestPlan {
  const { prefix } = repoPrefix(value.repository);
  const base = normalizeBranch(value.baseBranch, "baseBranch");
  const head = normalizeBranch(value.headBranch, "headBranch");
  if (base === head) throw new Error("GitHub REST planner forbids opening a pull request from the protected base branch to itself.");
  const title = normalizeText(value.title, "pullRequestTitle", defaultSelfDrivingGitHubRestPlannerLimits.maxPullRequestTitleLength);
  const body = normalizeText(value.body, "pullRequestBody", defaultSelfDrivingGitHubRestPlannerLimits.maxPullRequestBodyLength);
  normalizeGitSha(value.headRevision, "headRevision");
  return request(
    "open-pull-request",
    "POST",
    `${prefix}/pulls`,
    [201],
    defaultSelfDrivingGitHubRestPlannerLimits.maxPullRequestResponseBytes,
    "pull-requests:write",
    {
      title,
      body,
      head,
      base,
      draft: false,
      maintainer_can_modify: false,
    },
  );
}
