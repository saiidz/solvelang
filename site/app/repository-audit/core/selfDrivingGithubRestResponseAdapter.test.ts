import assert from "node:assert/strict";
import test from "node:test";
import {
  planSelfDrivingGitHubBaseBlobRequest,
  planSelfDrivingGitHubBaseTreeRequest,
  planSelfDrivingGitHubCreateBranchRequest,
  planSelfDrivingGitHubCreateCommitRequest,
  planSelfDrivingGitHubCreateTreeRequest,
  planSelfDrivingGitHubLivePreflightRequests,
  planSelfDrivingGitHubOpenPullRequestRequest,
  planSelfDrivingGitHubUpdateHeadRefRequest,
  type SelfDrivingGitHubFileModeEvidence,
  type SelfDrivingGitHubRestRequestPlan,
} from "./selfDrivingGithubRestPlanner";
import type { SelfDrivingGitHubRestSuccess } from "./selfDrivingGithubRestTransport";
import type { SelfDrivingPatchMaterialization } from "./selfDrivingPatchMaterialization";
import {
  assembleSelfDrivingGitHubRestPreflightEvidence,
  parseSelfDrivingGitHubBranchCreated,
  parseSelfDrivingGitHubCommitWriteSequence,
  parseSelfDrivingGitHubPullRequestOpened,
  type SelfDrivingGitHubRestPreflightResponses,
} from "./selfDrivingGithubRestResponseAdapter";
import type {
  SelfDrivingPrWriteBranchRequest,
  SelfDrivingPrWriteCommitRequest,
  SelfDrivingPrWritePullRequestRequest,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const TREE = "c".repeat(40);
const NEW_TREE = "d".repeat(40);
const COMMIT = "e".repeat(40);
const OBSERVED_AT = "2026-09-07T17:00:00Z";

function executionPlan(overrides: Partial<SelfDrivingPrWriteExecutionPlan> = {}): SelfDrivingPrWriteExecutionPlan {
  const base: SelfDrivingPrWriteExecutionPlan = {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0",
    mode: "no-write-execution-plan",
    status: "ready-for-separate-github-executor",
    id: `pr_write_plan_${"f".repeat(64)}`,
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE,
    headBranch: "solve/review/fix",
    installationRef: "github-app/installation:fixture",
    approvalId: "approval-fixture",
    approvalBindingSha256: "1".repeat(64),
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
      requiredChecks: ["CI", "Rust"],
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
  return { ...base, ...overrides };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function success(
  request: SelfDrivingGitHubRestRequestPlan,
  body: unknown,
  httpStatus = request.expectedStatuses[0],
): SelfDrivingGitHubRestSuccess {
  return {
    schema: "solvelang.self-driving.github-rest-response.v0",
    status: "success",
    operation: request.operation,
    httpStatus,
    url: request.url,
    responseBytes: byteLength(body),
    body,
    policy: {
      authorizationMaterialReturned: false,
      credentialMaterialReturned: false,
      redirectsFollowed: false,
      transportCalls: 1,
      retries: 0,
    },
  };
}

function rulesBody(overrides: { approvals?: number; checks?: string[]; includePr?: boolean; includeNoForce?: boolean; reviewers?: unknown[] } = {}) {
  const rules: unknown[] = [];
  if (overrides.includePr !== false) {
    rules.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: overrides.approvals ?? 2,
        required_reviewers: overrides.reviewers ?? [],
      },
    });
  }
  rules.push({
    type: "required_status_checks",
    parameters: {
      required_status_checks: (overrides.checks ?? ["WASM artifact security", "Rust", "CI"])
        .map((context) => ({ context })),
    },
  });
  if (overrides.includeNoForce !== false) rules.push({ type: "non_fast_forward" });
  return rules;
}

function preflightResponses(
  plan = executionPlan(),
  overrides: Partial<{
    protected: boolean;
    baseRevision: string;
    headStatus: number;
    rules: unknown;
    treeSha: string;
    truncated: boolean;
    treeEntries: unknown[];
    blobBody: unknown;
    blobResponses: readonly SelfDrivingGitHubRestSuccess[];
  }> = {},
): SelfDrivingGitHubRestPreflightResponses {
  const [branchRequest, rulesRequest, headRequest, commitRequest] = planSelfDrivingGitHubLivePreflightRequests(plan);
  const treeSha = overrides.treeSha ?? TREE;
  const treeRequest = planSelfDrivingGitHubBaseTreeRequest(plan.repository, treeSha);
  const blobRequest = planSelfDrivingGitHubBaseBlobRequest(plan.repository, BLOB);
  const blobBody = overrides.blobBody ?? {
    sha: BLOB,
    size: 4,
    encoding: "base64",
    content: "b2xkCg==",
  };
  return {
    baseBranch: success(branchRequest, {
      name: plan.baseBranch,
      protected: overrides.protected ?? true,
      commit: { sha: overrides.baseRevision ?? plan.baseRevision },
    }),
    baseRules: success(rulesRequest, overrides.rules ?? rulesBody()),
    headRef: success(
      headRequest,
      overrides.headStatus === 200
        ? { ref: `refs/heads/${plan.headBranch}`, object: { type: "commit", sha: COMMIT } }
        : { message: "Not Found" },
      overrides.headStatus ?? 404,
    ),
    baseCommit: success(commitRequest, {
      sha: overrides.baseRevision ?? plan.baseRevision,
      tree: { sha: treeSha },
    }),
    baseTree: success(treeRequest, {
      sha: treeSha,
      truncated: overrides.truncated ?? false,
      tree: overrides.treeEntries ?? [{
        path: plan.files[0].path,
        mode: "100644",
        type: "blob",
        sha: plan.files[0].baseBlobSha,
      }],
    }),
    baseBlobs: overrides.blobResponses ?? [success(blobRequest, blobBody)],
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
      contentSha256: "2".repeat(64),
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

function commitRequest(): SelfDrivingPrWriteCommitRequest {
  return {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    headBranch: "solve/review/fix",
    expectedParentRevision: BASE,
    files: executionPlan().files,
  };
}

const fileModes: readonly SelfDrivingGitHubFileModeEvidence[] = [
  { path: "site/app/a.ts", blobSha: BLOB, mode: "100644" },
];

test("preflight responses bind exact branch/rules/tree/blob evidence into executor inputs", () => {
  const plan = executionPlan();
  const evidence = assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan));
  assert.equal(evidence.status, "ready");
  assert.equal(evidence.baseTreeSha, TREE);
  assert.equal(evidence.livePreflight.baseRevision, BASE);
  assert.equal(evidence.livePreflight.headBranchExists, false);
  assert.equal(evidence.livePreflight.branchProtection.requiredApprovals, 2);
  assert.deepEqual(evidence.livePreflight.branchProtection.requiredChecks, ["CI", "Rust", "WASM artifact security"]);
  assert.deepEqual(evidence.fileModes, [{ path: "site/app/a.ts", blobSha: BLOB, mode: "100644" }]);
  assert.deepEqual(evidence.baseFiles, [{ path: "site/app/a.ts", blobSha: BLOB, content: "old\n" }]);
  assert.equal(evidence.policy.networkAccess, false);
  assert.equal(evidence.policy.repositoryWriteAccess, false);
});

test("empty Git blobs are accepted when size and empty base64 content agree", () => {
  const plan = executionPlan();
  const responses = preflightResponses(plan, {
    blobBody: { sha: BLOB, size: 0, encoding: "base64", content: "" },
  });
  const evidence = assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, responses);
  assert.equal(evidence.baseFiles[0].content, "");
});

test("missing PR/no-force rules, weakened approvals/checks, or path-specific reviewers fail closed", () => {
  const plan = executionPlan();
  const cases: Array<readonly [unknown, RegExp]> = [
    [rulesBody({ includePr: false }), /no longer require pull requests/],
    [rulesBody({ includeNoForce: false }), /no longer prohibit force pushes/],
    [rulesBody({ approvals: 0 }), /fewer approvals/],
    [rulesBody({ checks: ["CI"] }), /missing required check Rust/],
    [rulesBody({ reviewers: [{ file_patterns: ["site/**"], minimum_approvals: 1 }] }), /Path-specific required reviewers/],
  ];
  for (const [rules, expected] of cases) {
    assert.throws(
      () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { rules })),
      expected,
    );
  }
});

test("existing head branch, unprotected base, or base revision drift fail closed", () => {
  const plan = executionPlan();
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { headStatus: 200 })),
    /head branch already exists/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { protected: false })),
    /base branch is not protected/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { baseRevision: "9".repeat(40) })),
    /base branch revision does not match/,
  );
});

test("truncated trees, blob drift, unsupported modes, missing or duplicate paths fail closed", () => {
  const plan = executionPlan();
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { truncated: true })),
    /truncated/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      treeEntries: [{ path: "site/app/a.ts", mode: "120000", type: "blob", sha: BLOB }],
    })),
    /unsupported symlink\/submodule\/tree mode/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { treeEntries: [] })),
    /missing planned path/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      treeEntries: [
        { path: "site/app/a.ts", mode: "100644", type: "blob", sha: BLOB },
        { path: "site/app/a.ts", mode: "100644", type: "blob", sha: BLOB },
      ],
    })),
    /duplicate path/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      treeEntries: [{ path: "site/app/a.ts", mode: "100644", type: "blob", sha: "9".repeat(40) }],
    })),
    /Live tree blob changed/,
  );
});

test("blob coverage and base64/size/UTF-8 decoding fail closed on malformed evidence", () => {
  const plan = executionPlan();
  const blobRequest = planSelfDrivingGitHubBaseBlobRequest(plan.repository, BLOB);
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, { blobResponses: [] })),
    /cover each unique planned base blob/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      blobBody: { sha: BLOB, size: 4, encoding: "base64", content: "***not-base64***" },
    })),
    /malformed base64/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      blobBody: { sha: BLOB, size: 99, encoding: "base64", content: "b2xkCg==" },
    })),
    /decoded byte size/,
  );
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, preflightResponses(plan, {
      blobBody: { sha: BLOB, size: 1, encoding: "base64", content: "/w==" },
    })),
    /not valid UTF-8/,
  );
  const duplicate = success(blobRequest, { sha: BLOB, size: 4, encoding: "base64", content: "b2xkCg==" });
  const twoFilePlan = executionPlan({
    files: [executionPlan().files[0], { ...executionPlan().files[0], path: "site/app/b.ts" }],
  });
  assert.throws(
    () => assembleSelfDrivingGitHubRestPreflightEvidence(twoFilePlan, OBSERVED_AT, preflightResponses(twoFilePlan, {
      treeEntries: [
        { path: "site/app/a.ts", mode: "100644", type: "blob", sha: BLOB },
        { path: "site/app/b.ts", mode: "100644", type: "blob", sha: BLOB },
      ],
      blobResponses: [duplicate, duplicate],
    })),
    /cover each unique planned base blob/,
  );
});

test("forged response URL, operation, status, or transport policy is rejected", () => {
  const plan = executionPlan();
  const base = preflightResponses(plan);
  const forged = [
    { ...base.baseBranch, url: "https://api.github.com/repos/saiidz/other/branches/main" },
    { ...base.baseBranch, operation: "get-base-blob" as const },
    { ...base.baseBranch, httpStatus: 201 },
    { ...base.baseBranch, policy: { ...base.baseBranch.policy, retries: 1 as 0 } },
  ];
  for (const baseBranch of forged) {
    assert.throws(
      () => assembleSelfDrivingGitHubRestPreflightEvidence(plan, OBSERVED_AT, { ...base, baseBranch } as SelfDrivingGitHubRestPreflightResponses),
    );
  }
});

test("branch creation response is bound to the exact approved ref and base revision", () => {
  const request: SelfDrivingPrWriteBranchRequest = {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    baseRevision: BASE,
    headBranch: "solve/review/fix",
  };
  const requestPlan = planSelfDrivingGitHubCreateBranchRequest(request);
  const good = success(requestPlan, {
    ref: "refs/heads/solve/review/fix",
    object: { type: "commit", sha: BASE },
  });
  assert.deepEqual(parseSelfDrivingGitHubBranchCreated(request, good), {
    status: "created",
    branch: "solve/review/fix",
    revision: BASE,
  });
  assert.throws(
    () => parseSelfDrivingGitHubBranchCreated(request, success(requestPlan, {
      ref: "refs/heads/solve/review/other",
      object: { type: "commit", sha: BASE },
    })),
    /does not match the approved branch/,
  );
  assert.throws(
    () => parseSelfDrivingGitHubBranchCreated(request, success(requestPlan, {
      ref: "refs/heads/solve/review/fix",
      object: { type: "commit", sha: "9".repeat(40) },
    })),
    /does not start from the exact approved base revision/,
  );
});

test("commit write sequence recomputes the exact reviewed tree and validates tree, parent, and ref", () => {
  const request = commitRequest();
  const materialized = materialization();
  const treePlan = planSelfDrivingGitHubCreateTreeRequest(request, TREE, fileModes, materialized);
  const treeResponse = success(treePlan, { sha: NEW_TREE });
  const commitPlan = planSelfDrivingGitHubCreateCommitRequest(request, NEW_TREE);
  const commitResponse = success(commitPlan, {
    sha: COMMIT,
    tree: { sha: NEW_TREE },
    parents: [{ sha: BASE }],
  });
  const updatePlan = planSelfDrivingGitHubUpdateHeadRefRequest(request, COMMIT);
  const updateResponse = success(updatePlan, {
    ref: "refs/heads/solve/review/fix",
    object: { type: "commit", sha: COMMIT },
  });

  assert.deepEqual(
    parseSelfDrivingGitHubCommitWriteSequence(
      request,
      TREE,
      fileModes,
      materialized,
      treeResponse,
      commitResponse,
      updateResponse,
    ),
    { status: "committed", branch: "solve/review/fix", parentRevision: BASE, commitSha: COMMIT },
  );

  assert.throws(
    () => parseSelfDrivingGitHubCommitWriteSequence(
      request,
      TREE,
      fileModes,
      { ...materialized, files: [{ ...materialized.files[0], baseBlobSha: "9".repeat(40) }] },
      treeResponse,
      commitResponse,
      updateResponse,
    ),
    /Materialized content does not match the reviewed base blob/,
  );
  assert.throws(
    () => parseSelfDrivingGitHubCommitWriteSequence(
      request,
      TREE,
      fileModes,
      materialized,
      treeResponse,
      success(commitPlan, { sha: COMMIT, tree: { sha: TREE }, parents: [{ sha: BASE }] }),
      updateResponse,
    ),
    /does not point to the exact created tree/,
  );
  assert.throws(
    () => parseSelfDrivingGitHubCommitWriteSequence(
      request,
      TREE,
      fileModes,
      materialized,
      treeResponse,
      success(commitPlan, { sha: COMMIT, tree: { sha: NEW_TREE }, parents: [{ sha: "9".repeat(40) }] }),
      updateResponse,
    ),
    /parent does not match/,
  );
  assert.throws(
    () => parseSelfDrivingGitHubCommitWriteSequence(
      request,
      TREE,
      fileModes,
      materialized,
      treeResponse,
      commitResponse,
      success(updatePlan, { ref: "refs/heads/other", object: { type: "commit", sha: COMMIT } }),
    ),
    /ref does not match the approved head branch/,
  );
});

test("opened PR response is bound to exact repository, base/head branches and head revision", () => {
  const request: SelfDrivingPrWritePullRequestRequest = {
    planId: "plan-fixture",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    headBranch: "solve/review/fix",
    headRevision: COMMIT,
    title: "Solve Self-Driving: reviewed validated change",
    body: "Reviewed Self-Driving change. Automatic merge is disabled.",
  };
  const requestPlan = planSelfDrivingGitHubOpenPullRequestRequest(request);
  const body = {
    number: 858,
    state: "open",
    draft: false,
    base: { ref: "main", repo: { full_name: "saiidz/solvelang" } },
    head: { ref: "solve/review/fix", sha: COMMIT, repo: { full_name: "saiidz/solvelang" } },
  };
  assert.deepEqual(parseSelfDrivingGitHubPullRequestOpened(request, success(requestPlan, body)), {
    status: "opened",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    headBranch: "solve/review/fix",
    headRevision: COMMIT,
    pullRequestRef: "#858",
  });

  const hostileBodies = [
    { ...body, draft: true },
    { ...body, base: { ...body.base, ref: "dev" } },
    { ...body, head: { ...body.head, ref: "other" } },
    { ...body, head: { ...body.head, sha: "9".repeat(40) } },
    { ...body, base: { ...body.base, repo: { full_name: "saiidz/other" } } },
    { ...body, head: { ...body.head, repo: { full_name: "saiidz/other" } } },
  ];
  for (const hostile of hostileBodies) {
    assert.throws(() => parseSelfDrivingGitHubPullRequestOpened(request, success(requestPlan, hostile)));
  }
});
