import assert from "node:assert/strict";
import test from "node:test";
import type { SelfDrivingPatchMaterialization } from "./selfDrivingPatchMaterialization";
import type {
  SelfDrivingPrWriteBranchRequest,
  SelfDrivingPrWriteCommitRequest,
  SelfDrivingPrWritePullRequestRequest,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";
import {
  planSelfDrivingGitHubBaseBlobRequest,
  planSelfDrivingGitHubBaseTreeRequest,
  planSelfDrivingGitHubCreateBranchRequest,
  planSelfDrivingGitHubCreateCommitRequest,
  planSelfDrivingGitHubCreateTreeRequest,
  planSelfDrivingGitHubLivePreflightRequests,
  planSelfDrivingGitHubOpenPullRequestRequest,
  planSelfDrivingGitHubUpdateHeadRefRequest,
  SELF_DRIVING_GITHUB_ACCEPT,
  SELF_DRIVING_GITHUB_API_ORIGIN,
  SELF_DRIVING_GITHUB_API_VERSION,
} from "./selfDrivingGithubRestPlanner";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const TREE = "c".repeat(40);
const COMMIT = "d".repeat(40);

function executionPlan(): SelfDrivingPrWriteExecutionPlan {
  return {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0",
    mode: "no-write-execution-plan",
    status: "ready-for-separate-github-executor",
    id: `pr_write_plan_${"e".repeat(64)}`,
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE,
    headBranch: "solve/review/fix",
    installationRef: "github-app/installation:fixture",
    approvalId: "approval-fixture",
    approvalBindingSha256: "f".repeat(64),
    claimId: "claim-fixture",
    claimedAt: "2026-09-07T16:50:00Z",
    requiredPermissions: { metadata: "read", contents: "write", pullRequests: "write" },
    plannedActions: ["create-branch", "create-commit", "open-pr"],
    requiredLiveChecks: [
      "verify-exact-base-revision",
      "verify-fresh-branch-protection",
      "verify-head-branch-absent",
      "verify-base-blob-shas",
    ],
    branchProtectionEvidence: {
      protectedBranches: ["main"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI"],
      observedAt: "2026-09-07T16:49:00Z",
      evidenceLocator: "github:rules:fixture",
    },
    selectedProposals: [{
      validationId: "validation-1",
      patchProposalId: "patch-1",
      suggestionProposalId: "suggestion-1",
      findingId: "finding-1",
      severity: "high",
    }],
    files: [{
      proposalId: "patch-1",
      validationId: "validation-1",
      suggestionProposalId: "suggestion-1",
      findingId: "finding-1",
      path: "site/app/a.ts",
      baseBlobSha: BLOB,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
    }],
    limits: {
      maxSelectedProposals: 25,
      maxFiles: 50,
      maxHunks: 256,
      maxLines: 2500,
      maxPatchBytes: 131072,
      maxClaimIdLength: 128,
    },
    totals: { proposals: 1, files: 1, hunks: 1, lines: 2, patchBytes: 8 },
    policy: {
      sourceArtifactsRecreated: true,
      cryptographicApprovalBindingVerified: true,
      successfulSingleUseClaimRequired: true,
      exactBaseRevisionRequiredAtExecution: true,
      freshBranchProtectionRequiredAtExecution: true,
      headBranchMustNotExistAtExecution: true,
      baseBlobShaMatchRequiredAtExecution: true,
      directPushToBaseAllowed: false,
      directPushToProtectedBranchAllowed: false,
      forcePushAllowed: false,
      automaticMergeAllowed: false,
      credentialResolutionAccess: false,
      githubApiAccess: false,
      branchCreationAccess: false,
      commitWriteAccess: false,
      pullRequestCreationAccess: false,
      patchApplicationAccess: false,
      shellExecutionAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      networkAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
      writeExecutionStatus: "not-executed",
    },
  };
}

function branchRequest(): SelfDrivingPrWriteBranchRequest {
  return {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    baseRevision: BASE,
    headBranch: "solve/review/fix",
  };
}

function commitRequest(): SelfDrivingPrWriteCommitRequest {
  return {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    headBranch: "solve/review/fix",
    expectedParentRevision: BASE,
    files: executionPlan().files,
  };
}

function materialization(): SelfDrivingPatchMaterialization {
  return {
    schema: "solvelang.self-driving.patch-materialization.v0",
    mode: "pure-text-materialization",
    status: "materialized",
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    baseRevision: BASE,
    files: [{
      path: "site/app/a.ts",
      baseBlobSha: BLOB,
      content: "new\n",
      contentSha256: "1".repeat(64),
      bytes: 4,
      lines: 1,
      finalLf: true,
    }],
    totals: { files: 1, baseBytes: 4, resultBytes: 4, resultLines: 1 },
    policy: {
      exactPlanPathsRequired: true,
      exactBaseBlobShaRequired: true,
      structuredReviewedHunksOnly: true,
      exactContextAndDeletionMatchRequired: true,
      exactOldAndNewCoordinatesRequired: true,
      utf8LfTextOnly: true,
      ambiguousMissingFinalNewlineRejected: true,
      emptyBaseResultUsesFinalLf: true,
      binaryContentAllowed: false,
      credentialResolutionAccess: false,
      githubApiAccess: false,
      patchApplicationToRepositoryAccess: false,
      shellExecutionAccess: false,
      networkAccess: false,
      repositoryWriteAccess: false,
      providerAccess: false,
      productionMutationAccess: false,
      billingMutationAccess: false,
      solveRunnerAuthority: false,
      externalSideEffects: false,
    },
  };
}

function assertCommon(request: ReturnType<typeof planSelfDrivingGitHubBaseBlobRequest>) {
  assert.equal(request.origin, SELF_DRIVING_GITHUB_API_ORIGIN);
  assert.equal(request.headers.Accept, SELF_DRIVING_GITHUB_ACCEPT);
  assert.equal(request.headers["X-GitHub-Api-Version"], SELF_DRIVING_GITHUB_API_VERSION);
  assert.equal(request.policy.authorizationHeaderIncluded, false);
  assert.equal(request.policy.credentialMaterialIncluded, false);
  assert.equal(request.policy.redirectsAllowed, false);
  assert.equal(request.policy.retries, 0);
  assert.equal(request.policy.automaticMergeAllowed, false);
  assert.equal(request.policy.forcePushAllowed, false);
}

test("live-preflight planner emits only the four fixed read endpoints with current API headers", () => {
  const requests = planSelfDrivingGitHubLivePreflightRequests(executionPlan());
  assert.deepEqual(requests.map((item) => item.operation), [
    "get-base-branch",
    "get-base-rules",
    "get-head-ref",
    "get-base-commit",
  ]);
  assert.deepEqual(requests.map((item) => item.method), ["GET", "GET", "GET", "GET"]);
  assert.equal(requests[0].url, `https://api.github.com/repos/saiidz/solvelang/branches/main`);
  assert.equal(requests[1].url, `https://api.github.com/repos/saiidz/solvelang/rules/branches/main`);
  assert.equal(requests[2].url, `https://api.github.com/repos/saiidz/solvelang/git/ref/heads/solve/review/fix`);
  assert.equal(requests[3].url, `https://api.github.com/repos/saiidz/solvelang/git/commits/${BASE}`);
  assert.deepEqual(requests[2].expectedStatuses, [200, 404]);
  assert.equal(requests[1].requiredPermission, "metadata:read");
  for (const item of requests) assertCommon(item as ReturnType<typeof planSelfDrivingGitHubBaseBlobRequest>);
});

test("tree and blob reads are exact immutable Git object requests with bounded responses", () => {
  const tree = planSelfDrivingGitHubBaseTreeRequest("saiidz/solvelang", TREE);
  const blob = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  assert.equal(tree.method, "GET");
  assert.equal(tree.url, `https://api.github.com/repos/saiidz/solvelang/git/trees/${TREE}?recursive=1`);
  assert.equal(tree.maxResponseBytes, 8_388_608);
  assert.equal(blob.url, `https://api.github.com/repos/saiidz/solvelang/git/blobs/${BLOB}`);
  assert.equal(blob.requiredPermission, "contents:read");
});

test("create-branch planner creates only the approved head ref from exact base revision", () => {
  const result = planSelfDrivingGitHubCreateBranchRequest(branchRequest());
  assert.equal(result.method, "POST");
  assert.equal(result.url, "https://api.github.com/repos/saiidz/solvelang/git/refs");
  assert.deepEqual(result.body, {
    ref: "refs/heads/solve/review/fix",
    sha: BASE,
  });
  assert.deepEqual(result.expectedStatuses, [201]);
  assert.equal(result.requiredPermission, "contents:write");
  assertCommon(result as ReturnType<typeof planSelfDrivingGitHubBaseBlobRequest>);
});

test("create-tree planner preserves reviewed base blob identity and regular/executable modes", () => {
  for (const mode of ["100644", "100755"] as const) {
    const result = planSelfDrivingGitHubCreateTreeRequest(
      commitRequest(),
      TREE,
      [{ path: "site/app/a.ts", blobSha: BLOB, mode }],
      materialization(),
    );
    assert.equal(result.method, "POST");
    assert.equal(result.url, "https://api.github.com/repos/saiidz/solvelang/git/trees");
    assert.deepEqual(result.body, {
      base_tree: TREE,
      tree: [{ path: "site/app/a.ts", mode, type: "blob", content: "new\n" }],
    });
    assert.equal(result.requiredPermission, "contents:write");
  }
});

test("create-tree planner fails closed on symlink/submodule mode or blob/path drift", () => {
  for (const mode of ["120000", "160000"] as const) {
    assert.throws(
      () => planSelfDrivingGitHubCreateTreeRequest(
        commitRequest(),
        TREE,
        [{ path: "site/app/a.ts", blobSha: BLOB, mode: mode as "100644" }],
        materialization(),
      ),
      /not a supported regular-file mode/,
    );
  }
  assert.throws(
    () => planSelfDrivingGitHubCreateTreeRequest(
      commitRequest(),
      TREE,
      [{ path: "site/app/a.ts", blobSha: "9".repeat(40), mode: "100644" }],
      materialization(),
    ),
    /blob does not match the reviewed plan/,
  );
});

test("commit and head-ref planners pin one parent and explicit non-force update", () => {
  const commit = planSelfDrivingGitHubCreateCommitRequest(commitRequest(), TREE);
  assert.equal(commit.method, "POST");
  assert.equal(commit.url, "https://api.github.com/repos/saiidz/solvelang/git/commits");
  assert.deepEqual(commit.body, {
    message: "Solve Self-Driving: reviewed validated change",
    tree: TREE,
    parents: [BASE],
  });

  const update = planSelfDrivingGitHubUpdateHeadRefRequest(commitRequest(), COMMIT);
  assert.equal(update.method, "PATCH");
  assert.equal(update.url, "https://api.github.com/repos/saiidz/solvelang/git/refs/heads/solve/review/fix");
  assert.deepEqual(update.body, { sha: COMMIT, force: false });
  assert.equal(update.policy.forcePushAllowed, false);
});

test("pull-request planner opens only the approved head to base and never requests merge", () => {
  const value: SelfDrivingPrWritePullRequestRequest = {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    headBranch: "solve/review/fix",
    headRevision: COMMIT,
    title: "Solve Self-Driving: reviewed validated change",
    body: "Self-Driving execution plan fixture. Automatic merge is disabled.",
  };
  const result = planSelfDrivingGitHubOpenPullRequestRequest(value);
  assert.equal(result.method, "POST");
  assert.equal(result.url, "https://api.github.com/repos/saiidz/solvelang/pulls");
  assert.deepEqual(result.body, {
    title: value.title,
    body: value.body,
    head: value.headBranch,
    base: value.baseBranch,
    draft: false,
    maintainer_can_modify: false,
  });
  assert.equal(result.requiredPermission, "pull-requests:write");
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, "merge"), false);
});

test("request plans never contain authorization headers or credential-like metadata", () => {
  const requests = [
    ...planSelfDrivingGitHubLivePreflightRequests(executionPlan()),
    planSelfDrivingGitHubBaseTreeRequest("saiidz/solvelang", TREE),
    planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB),
    planSelfDrivingGitHubCreateBranchRequest(branchRequest()),
    planSelfDrivingGitHubCreateTreeRequest(
      commitRequest(),
      TREE,
      [{ path: "site/app/a.ts", blobSha: BLOB, mode: "100644" }],
      materialization(),
    ),
    planSelfDrivingGitHubCreateCommitRequest(commitRequest(), TREE),
    planSelfDrivingGitHubUpdateHeadRefRequest(commitRequest(), COMMIT),
  ];
  for (const request of requests) {
    assert.equal(
      Object.keys(request.headers).some((name) => name.toLowerCase() === "authorization"),
      false,
    );
    assert.equal(request.policy.authorizationHeaderIncluded, false);
    assert.equal(request.policy.credentialMaterialIncluded, false);
    const authBearingFields = JSON.stringify({
      headers: request.headers,
      body: "body" in request ? request.body : undefined,
    });
    assert.doesNotMatch(authBearingFields, /\bBearer\s+|github_pat_|\bgh[pousr]_/i);
  }
  assert.throws(
    () => planSelfDrivingGitHubCreateCommitRequest(commitRequest(), TREE, "Bearer abcdefghijklmnop"),
    /credential-like material/,
  );
});
