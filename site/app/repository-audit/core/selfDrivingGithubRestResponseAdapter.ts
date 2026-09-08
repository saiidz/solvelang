import {
  planSelfDrivingGitHubBaseBlobRequest,
  planSelfDrivingGitHubBaseTreeRequest,
  planSelfDrivingGitHubCreateBranchRequest,
  planSelfDrivingGitHubCreateCommitRequest,
  planSelfDrivingGitHubOpenPullRequestRequest,
  planSelfDrivingGitHubUpdateHeadRefRequest,
  type SelfDrivingGitHubFileModeEvidence,
  type SelfDrivingGitHubRestOperation,
  type SelfDrivingGitHubRestRequestPlan,
} from "./selfDrivingGithubRestPlanner";
import {
  SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA,
  type SelfDrivingGitHubRestSuccess,
} from "./selfDrivingGithubRestTransport";
import {
  defaultSelfDrivingPatchMaterializationLimits,
  type SelfDrivingPatchBaseFileInput,
} from "./selfDrivingPatchMaterialization";
import {
  SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
  type SelfDrivingPrWriteBranchRequest,
  type SelfDrivingPrWriteCommitRequest,
  type SelfDrivingPrWriteLivePreflight,
  type SelfDrivingPrWritePullRequestRequest,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_GITHUB_REST_PREFLIGHT_EVIDENCE_SCHEMA =
  "solvelang.self-driving.github-rest-preflight-evidence.v0" as const;

export type SelfDrivingGitHubRestPreflightResponses = Readonly<{
  baseBranch: SelfDrivingGitHubRestSuccess;
  baseRules: SelfDrivingGitHubRestSuccess;
  headRef: SelfDrivingGitHubRestSuccess;
  baseCommit: SelfDrivingGitHubRestSuccess;
  baseTree: SelfDrivingGitHubRestSuccess;
  baseBlobs: readonly SelfDrivingGitHubRestSuccess[];
}>;

export type SelfDrivingGitHubRestPreflightEvidence = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_REST_PREFLIGHT_EVIDENCE_SCHEMA;
  status: "ready";
  livePreflight: SelfDrivingPrWriteLivePreflight;
  baseTreeSha: string;
  fileModes: readonly SelfDrivingGitHubFileModeEvidence[];
  baseFiles: readonly SelfDrivingPatchBaseFileInput[];
  policy: Readonly<{
    exactTransportResponsesRequired: true;
    exactBaseRevisionVerified: true;
    activePullRequestRuleRequired: true;
    nonFastForwardRuleRequired: true;
    requiredChecksNotWeakened: true;
    requiredApprovalsNotWeakened: true;
    pathSpecificReviewerRulesRejected: true;
    recursiveTreeMustNotBeTruncated: true;
    exactBaseBlobShasVerified: true;
    regularFileModesOnly: true;
    base64Utf8BlobDecodingOnly: true;
    networkAccess: false;
    credentialAccess: false;
    repositoryWriteAccess: false;
    externalSideEffects: false;
  }>;
}>;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as JsonRecord;
}

function asArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function asString(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${name} must be bounded non-empty text.`);
  if (/\u0000/.test(normalized)) throw new Error(`${name} contains a NUL byte.`);
  return normalized;
}

function asInteger(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${name} must be a safe integer in range.`);
  }
  return value as number;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean.`);
  return value;
}

function normalizeGitSha(value: unknown, name: string): string {
  const normalized = asString(value, name, 40).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error(`${name} must be an exact 40-hex Git SHA.`);
  return normalized;
}

function normalizeUtc(value: string, name: string): string {
  const normalized = asString(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertResponseForPlan(
  response: SelfDrivingGitHubRestSuccess,
  request: SelfDrivingGitHubRestRequestPlan,
  operation: SelfDrivingGitHubRestOperation,
): void {
  if (!response || response.schema !== SELF_DRIVING_GITHUB_REST_RESPONSE_SCHEMA || response.status !== "success") {
    throw new Error(`${operation} requires a successful bounded GitHub REST response.`);
  }
  if (request.operation !== operation || response.operation !== operation) {
    throw new Error(`${operation} response operation binding drifted.`);
  }
  if (response.url !== request.url) throw new Error(`${operation} response URL does not match the exact request plan.`);
  if (!request.expectedStatuses.includes(response.httpStatus)) {
    throw new Error(`${operation} response status is outside the exact request contract.`);
  }
  if (!Number.isSafeInteger(response.responseBytes) || response.responseBytes < 0 || response.responseBytes > request.maxResponseBytes) {
    throw new Error(`${operation} response byte evidence exceeds the exact request bound.`);
  }
  if (
    response.policy.authorizationMaterialReturned !== false
    || response.policy.credentialMaterialReturned !== false
    || response.policy.redirectsFollowed !== false
    || response.policy.transportCalls !== 1
    || response.policy.retries !== 0
  ) {
    throw new Error(`${operation} response policy is not the canonical bounded transport policy.`);
  }
}

function parseRules(
  plan: SelfDrivingPrWriteExecutionPlan,
  body: unknown,
): SelfDrivingPrWriteLivePreflight["branchProtection"] {
  const rules = asArray(body, "baseRules.body");
  let pullRequestRuleSeen = false;
  let nonFastForwardSeen = false;
  let requiredApprovals = 0;
  const requiredChecks = new Set<string>();

  for (let index = 0; index < rules.length; index += 1) {
    const rule = asRecord(rules[index], `baseRules.body[${index}]`);
    const type = asString(rule.type, `baseRules.body[${index}].type`, 64);
    if (type === "pull_request") {
      pullRequestRuleSeen = true;
      const parameters = asRecord(rule.parameters, `baseRules.body[${index}].parameters`);
      const count = asInteger(
        parameters.required_approving_review_count,
        `baseRules.body[${index}].parameters.required_approving_review_count`,
        0,
        100,
      );
      requiredApprovals = Math.max(requiredApprovals, count);
      if (parameters.required_reviewers !== undefined) {
        const reviewers = asArray(parameters.required_reviewers, `baseRules.body[${index}].parameters.required_reviewers`);
        if (reviewers.length > 0) {
          throw new Error("Path-specific required reviewers are not representable in live-preflight v0 and must fail closed.");
        }
      }
    } else if (type === "required_status_checks") {
      const parameters = asRecord(rule.parameters, `baseRules.body[${index}].parameters`);
      const checks = asArray(parameters.required_status_checks, `baseRules.body[${index}].parameters.required_status_checks`);
      for (let checkIndex = 0; checkIndex < checks.length; checkIndex += 1) {
        const check = asRecord(checks[checkIndex], `required_status_checks[${checkIndex}]`);
        requiredChecks.add(asString(check.context, `required_status_checks[${checkIndex}].context`, 256));
      }
    } else if (type === "non_fast_forward") {
      nonFastForwardSeen = true;
    }
  }

  if (!pullRequestRuleSeen) throw new Error("Live GitHub rules no longer require pull requests for the protected base branch.");
  if (!nonFastForwardSeen) throw new Error("Live GitHub rules no longer prohibit force pushes to the protected base branch.");
  if (requiredApprovals < plan.branchProtectionEvidence.requiredApprovals) {
    throw new Error("Live GitHub rules require fewer approvals than the reviewed execution plan.");
  }
  for (const required of plan.branchProtectionEvidence.requiredChecks) {
    if (!requiredChecks.has(required)) throw new Error(`Live GitHub rules are missing required check ${required}.`);
  }

  return Object.freeze({
    protectedBranches: Object.freeze([plan.baseBranch]),
    requiresPullRequest: true as const,
    allowsForcePush: false as const,
    requiredApprovals,
    requiredChecks: Object.freeze([...requiredChecks].sort(compareText)),
  });
}

function decodeGitHubBlob(body: unknown, expectedSha: string): string {
  const blob = asRecord(body, `baseBlob[${expectedSha}]`);
  const sha = normalizeGitSha(blob.sha, `baseBlob[${expectedSha}].sha`);
  if (sha !== expectedSha) throw new Error(`Base blob response SHA drifted for ${expectedSha}.`);
  if (asString(blob.encoding, `baseBlob[${expectedSha}].encoding`, 16).toLowerCase() !== "base64") {
    throw new Error(`Base blob ${expectedSha} must use GitHub base64 encoding.`);
  }
  const size = asInteger(blob.size, `baseBlob[${expectedSha}].size`, 0, defaultSelfDrivingPatchMaterializationLimits.maxBaseBytesPerFile);
  const encoded = asString(blob.content, `baseBlob[${expectedSha}].content`, 2_200_000).replace(/\s+/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`Base blob ${expectedSha} contains malformed base64.`);
  }
  const decode = globalThis.atob;
  if (typeof decode !== "function") throw new Error("Base64 decoding support is required for GitHub blob evidence.");
  let binary: string;
  try {
    binary = decode(encoded);
  } catch {
    throw new Error(`Base blob ${expectedSha} could not be decoded from base64.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== size) throw new Error(`Base blob ${expectedSha} decoded byte size does not match GitHub size evidence.`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Base blob ${expectedSha} is not valid UTF-8 text.`);
  }
}

export function assembleSelfDrivingGitHubRestPreflightEvidence(
  plan: SelfDrivingPrWriteExecutionPlan,
  observedAtInput: string,
  responses: SelfDrivingGitHubRestPreflightResponses,
): SelfDrivingGitHubRestPreflightEvidence {
  const observedAt = normalizeUtc(observedAtInput, "observedAt");
  const preflightRequests = planSelfDrivingGitHubLivePreflightRequests(plan);
  const [branchRequest, rulesRequest, headRequest, commitRequest] = preflightRequests;
  assertResponseForPlan(responses.baseBranch, branchRequest, "get-base-branch");
  assertResponseForPlan(responses.baseRules, rulesRequest, "get-base-rules");
  assertResponseForPlan(responses.headRef, headRequest, "get-head-ref");
  assertResponseForPlan(responses.baseCommit, commitRequest, "get-base-commit");

  const branchBody = asRecord(responses.baseBranch.body, "baseBranch.body");
  if (asString(branchBody.name, "baseBranch.body.name", 128) !== plan.baseBranch) {
    throw new Error("Live base branch name does not match the execution plan.");
  }
  if (asBoolean(branchBody.protected, "baseBranch.body.protected") !== true) {
    throw new Error("Live base branch is not protected.");
  }
  const branchCommit = asRecord(branchBody.commit, "baseBranch.body.commit");
  if (normalizeGitSha(branchCommit.sha, "baseBranch.body.commit.sha") !== plan.baseRevision) {
    throw new Error("Live base branch revision does not match the execution plan.");
  }

  const branchProtection = parseRules(plan, responses.baseRules.body);

  if (responses.headRef.httpStatus !== 404) {
    throw new Error("Planned GitHub PR head branch already exists.");
  }

  const commitBody = asRecord(responses.baseCommit.body, "baseCommit.body");
  if (normalizeGitSha(commitBody.sha, "baseCommit.body.sha") !== plan.baseRevision) {
    throw new Error("Live base commit object does not match the execution plan revision.");
  }
  const commitTree = asRecord(commitBody.tree, "baseCommit.body.tree");
  const baseTreeSha = normalizeGitSha(commitTree.sha, "baseCommit.body.tree.sha");

  const treeRequest = planSelfDrivingGitHubBaseTreeRequest(plan.repository, baseTreeSha);
  assertResponseForPlan(responses.baseTree, treeRequest, "get-base-tree-recursive");
  const treeBody = asRecord(responses.baseTree.body, "baseTree.body");
  if (normalizeGitSha(treeBody.sha, "baseTree.body.sha") !== baseTreeSha) {
    throw new Error("Recursive base tree response does not match the exact base commit tree.");
  }
  if (asBoolean(treeBody.truncated, "baseTree.body.truncated") !== false) {
    throw new Error("Recursive base tree response is truncated and cannot prove exact file identity.");
  }
  const treeEntries = asArray(treeBody.tree, "baseTree.body.tree");
  const treeByPath = new Map<string, JsonRecord>();
  for (let index = 0; index < treeEntries.length; index += 1) {
    const entry = asRecord(treeEntries[index], `baseTree.body.tree[${index}]`);
    const path = asString(entry.path, `baseTree.body.tree[${index}].path`, 512);
    if (treeByPath.has(path)) throw new Error(`Recursive base tree contains duplicate path ${path}.`);
    treeByPath.set(path, entry);
  }

  const fileModes: SelfDrivingGitHubFileModeEvidence[] = [];
  for (const file of plan.files) {
    const entry = treeByPath.get(file.path);
    if (!entry) throw new Error(`Recursive base tree is missing planned path ${file.path}.`);
    if (asString(entry.type, `tree[${file.path}].type`, 16) !== "blob") {
      throw new Error(`Planned path ${file.path} is not a regular Git blob.`);
    }
    const mode = asString(entry.mode, `tree[${file.path}].mode`, 16);
    if (mode !== "100644" && mode !== "100755") {
      throw new Error(`Planned path ${file.path} has unsupported symlink/submodule/tree mode ${mode}.`);
    }
    const blobSha = normalizeGitSha(entry.sha, `tree[${file.path}].sha`);
    if (blobSha !== file.baseBlobSha) throw new Error(`Live tree blob changed for ${file.path}.`);
    fileModes.push(Object.freeze({ path: file.path, blobSha, mode }));
  }
  fileModes.sort((left, right) => compareText(left.path, right.path));

  const expectedBlobShas = [...new Set(plan.files.map((file) => file.baseBlobSha))].sort(compareText);
  if (!Array.isArray(responses.baseBlobs) || responses.baseBlobs.length !== expectedBlobShas.length) {
    throw new Error("Bounded GitHub blob responses must cover each unique planned base blob exactly once.");
  }
  const contentByBlob = new Map<string, string>();
  for (const response of responses.baseBlobs) {
    if (!response || response.operation !== "get-base-blob") throw new Error("Unexpected GitHub response in base blob evidence.");
    const body = asRecord(response.body, "baseBlob.body");
    const blobSha = normalizeGitSha(body.sha, "baseBlob.body.sha");
    if (!expectedBlobShas.includes(blobSha)) throw new Error(`GitHub blob response contains unplanned SHA ${blobSha}.`);
    if (contentByBlob.has(blobSha)) throw new Error(`GitHub blob response duplicates SHA ${blobSha}.`);
    const blobRequest = planSelfDrivingGitHubBaseBlobRequest(plan.repository, blobSha);
    assertResponseForPlan(response, blobRequest, "get-base-blob");
    contentByBlob.set(blobSha, decodeGitHubBlob(body, blobSha));
  }
  for (const expected of expectedBlobShas) {
    if (!contentByBlob.has(expected)) throw new Error(`GitHub blob evidence is missing planned SHA ${expected}.`);
  }

  const baseFiles = plan.files
    .map((file) => Object.freeze({
      path: file.path,
      blobSha: file.baseBlobSha,
      content: contentByBlob.get(file.baseBlobSha) as string,
    }))
    .sort((left, right) => compareText(left.path, right.path));

  const livePreflight: SelfDrivingPrWriteLivePreflight = Object.freeze({
    schema: SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
    status: "ready" as const,
    observedAt,
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    baseRevision: plan.baseRevision,
    headBranch: plan.headBranch,
    headBranchExists: false as const,
    branchProtection,
    files: Object.freeze(plan.files
      .map((file) => Object.freeze({ path: file.path, blobSha: file.baseBlobSha }))
      .sort((left, right) => compareText(left.path, right.path))),
  });

  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_REST_PREFLIGHT_EVIDENCE_SCHEMA,
    status: "ready" as const,
    livePreflight,
    baseTreeSha,
    fileModes: Object.freeze(fileModes),
    baseFiles: Object.freeze(baseFiles),
    policy: Object.freeze({
      exactTransportResponsesRequired: true as const,
      exactBaseRevisionVerified: true as const,
      activePullRequestRuleRequired: true as const,
      nonFastForwardRuleRequired: true as const,
      requiredChecksNotWeakened: true as const,
      requiredApprovalsNotWeakened: true as const,
      pathSpecificReviewerRulesRejected: true as const,
      recursiveTreeMustNotBeTruncated: true as const,
      exactBaseBlobShasVerified: true as const,
      regularFileModesOnly: true as const,
      base64Utf8BlobDecodingOnly: true as const,
      networkAccess: false as const,
      credentialAccess: false as const,
      repositoryWriteAccess: false as const,
      externalSideEffects: false as const,
    }),
  });
}

export function parseSelfDrivingGitHubBranchCreated(
  request: SelfDrivingPrWriteBranchRequest,
  response: SelfDrivingGitHubRestSuccess,
): Readonly<{ status: "created"; branch: string; revision: string }> {
  const requestPlan = planSelfDrivingGitHubCreateBranchRequest(request);
  assertResponseForPlan(response, requestPlan, "create-head-ref");
  const body = asRecord(response.body, "createHeadRef.body");
  if (asString(body.ref, "createHeadRef.body.ref", 256) !== `refs/heads/${request.headBranch}`) {
    throw new Error("Created GitHub head ref does not match the approved branch.");
  }
  const object = asRecord(body.object, "createHeadRef.body.object");
  if (asString(object.type, "createHeadRef.body.object.type", 16) !== "commit") {
    throw new Error("Created GitHub head ref does not point to a commit.");
  }
  const revision = normalizeGitSha(object.sha, "createHeadRef.body.object.sha");
  if (revision !== request.baseRevision) throw new Error("Created GitHub head ref does not start from the exact approved base revision.");
  return Object.freeze({ status: "created" as const, branch: request.headBranch, revision });
}

export function parseSelfDrivingGitHubCommitWriteSequence(
  request: SelfDrivingPrWriteCommitRequest,
  createTreeRequest: SelfDrivingGitHubRestRequestPlan,
  treeResponse: SelfDrivingGitHubRestSuccess,
  commitResponse: SelfDrivingGitHubRestSuccess,
  updateRefResponse: SelfDrivingGitHubRestSuccess,
): Readonly<{ status: "committed"; branch: string; parentRevision: string; commitSha: string }> {
  if (createTreeRequest.operation !== "create-tree" || createTreeRequest.method !== "POST") {
    throw new Error("Commit sequence requires the exact create-tree request plan.");
  }
  assertResponseForPlan(treeResponse, createTreeRequest, "create-tree");
  const treeBody = asRecord(treeResponse.body, "createTree.body");
  const treeSha = normalizeGitSha(treeBody.sha, "createTree.body.sha");

  const commitRequestPlan = planSelfDrivingGitHubCreateCommitRequest(request, treeSha);
  assertResponseForPlan(commitResponse, commitRequestPlan, "create-commit");
  const commitBody = asRecord(commitResponse.body, "createCommit.body");
  const commitSha = normalizeGitSha(commitBody.sha, "createCommit.body.sha");
  const commitTree = asRecord(commitBody.tree, "createCommit.body.tree");
  if (normalizeGitSha(commitTree.sha, "createCommit.body.tree.sha") !== treeSha) {
    throw new Error("Created Git commit does not point to the exact created tree.");
  }
  const parents = asArray(commitBody.parents, "createCommit.body.parents");
  if (parents.length !== 1) throw new Error("Created Git commit must have exactly one parent.");
  const parent = asRecord(parents[0], "createCommit.body.parents[0]");
  if (normalizeGitSha(parent.sha, "createCommit.body.parents[0].sha") !== request.expectedParentRevision) {
    throw new Error("Created Git commit parent does not match the exact approved base revision.");
  }

  const updatePlan = planSelfDrivingGitHubUpdateHeadRefRequest(request, commitSha);
  assertResponseForPlan(updateRefResponse, updatePlan, "update-head-ref");
  const refBody = asRecord(updateRefResponse.body, "updateHeadRef.body");
  if (asString(refBody.ref, "updateHeadRef.body.ref", 256) !== `refs/heads/${request.headBranch}`) {
    throw new Error("Updated GitHub ref does not match the approved head branch.");
  }
  const refObject = asRecord(refBody.object, "updateHeadRef.body.object");
  if (asString(refObject.type, "updateHeadRef.body.object.type", 16) !== "commit") {
    throw new Error("Updated GitHub head ref does not point to a commit.");
  }
  if (normalizeGitSha(refObject.sha, "updateHeadRef.body.object.sha") !== commitSha) {
    throw new Error("Updated GitHub head ref does not point to the exact created commit.");
  }

  return Object.freeze({
    status: "committed" as const,
    branch: request.headBranch,
    parentRevision: request.expectedParentRevision,
    commitSha,
  });
}

export function parseSelfDrivingGitHubPullRequestOpened(
  request: SelfDrivingPrWritePullRequestRequest,
  response: SelfDrivingGitHubRestSuccess,
): Readonly<{
  status: "opened";
  repository: string;
  baseBranch: string;
  headBranch: string;
  headRevision: string;
  pullRequestRef: string;
}> {
  const requestPlan = planSelfDrivingGitHubOpenPullRequestRequest(request);
  assertResponseForPlan(response, requestPlan, "open-pull-request");
  const body = asRecord(response.body, "openPullRequest.body");
  const number = asInteger(body.number, "openPullRequest.body.number", 1, 2_147_483_647);
  if (asString(body.state, "openPullRequest.body.state", 16) !== "open") throw new Error("Created pull request is not open.");
  if (body.draft !== undefined && asBoolean(body.draft, "openPullRequest.body.draft") !== false) {
    throw new Error("Created pull request unexpectedly became a draft.");
  }
  const base = asRecord(body.base, "openPullRequest.body.base");
  const head = asRecord(body.head, "openPullRequest.body.head");
  if (asString(base.ref, "openPullRequest.body.base.ref", 128) !== request.baseBranch) {
    throw new Error("Created pull request base branch drifted.");
  }
  if (asString(head.ref, "openPullRequest.body.head.ref", 128) !== request.headBranch) {
    throw new Error("Created pull request head branch drifted.");
  }
  if (normalizeGitSha(head.sha, "openPullRequest.body.head.sha") !== request.headRevision) {
    throw new Error("Created pull request head revision drifted.");
  }
  return Object.freeze({
    status: "opened" as const,
    repository: request.repository,
    baseBranch: request.baseBranch,
    headBranch: request.headBranch,
    headRevision: request.headRevision,
    pullRequestRef: `#${number}`,
  });
}
