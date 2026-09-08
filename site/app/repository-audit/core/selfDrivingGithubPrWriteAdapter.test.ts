import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelfDrivingGitHubPrWriteAdapter,
} from "./selfDrivingGithubPrWriteAdapter";
import type {
  SelfDrivingGitHubAuthorizationBroker,
  SelfDrivingGitHubRestPermission,
  SelfDrivingGitHubRestTransport,
  SelfDrivingGitHubRestTransportRequest,
  SelfDrivingGitHubRestTransportResponse,
} from "./selfDrivingGithubRestTransport";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const TREE = "c".repeat(40);
const NEW_TREE = "d".repeat(40);
const COMMIT = "e".repeat(40);
const HEAD = "solve/review/fix";
const TOKEN = "fixture_token_1234567890";
const OBSERVED_AT = "2026-09-08T08:00:05Z";

function executionPlan(): SelfDrivingPrWriteExecutionPlan {
  return {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0",
    mode: "no-write-execution-plan",
    status: "ready-for-separate-github-executor",
    id: `pr_write_plan_${"f".repeat(64)}`,
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE,
    headBranch: HEAD,
    installationRef: "github-app/installation:fixture",
    approvalId: "approval-fixture",
    approvalBindingSha256: "1".repeat(64),
    claimId: "claim-fixture",
    claimedAt: "2026-09-08T07:59:00Z",
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
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
      observedAt: "2026-09-08T07:58:30Z",
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

type FakeOptions = Readonly<{
  blobContent?: string;
  commitParent?: string;
  failUrlIncludes?: string;
}>;

function jsonResponse(
  request: SelfDrivingGitHubRestTransportRequest,
  status: number,
  body: unknown,
): SelfDrivingGitHubRestTransportResponse {
  return {
    status,
    url: request.url,
    bodyText: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
  };
}

function createFakeGitHub(options: FakeOptions = {}) {
  const calls: SelfDrivingGitHubRestTransportRequest[] = [];
  const permissions: SelfDrivingGitHubRestPermission[] = [];
  const authorizationBroker: SelfDrivingGitHubAuthorizationBroker = async (permission, useToken) => {
    permissions.push(permission);
    return useToken(TOKEN);
  };
  const transport: SelfDrivingGitHubRestTransport = async (request) => {
    calls.push(request);
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(request.redirect, "error");
    if (options.failUrlIncludes && request.url.includes(options.failUrlIncludes)) {
      throw new Error(`secret transport error ${TOKEN}`);
    }

    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    if (request.method === "GET" && path.endsWith("/branches/main")) {
      return jsonResponse(request, 200, { name: "main", protected: true, commit: { sha: BASE } });
    }
    if (request.method === "GET" && path.endsWith("/rules/branches/main")) {
      return jsonResponse(request, 200, [
        { type: "pull_request", parameters: { required_approving_review_count: 1, required_reviewers: [] } },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: ["CI", "Rust", "WASM artifact security"].map((context) => ({ context })),
          },
        },
        { type: "non_fast_forward" },
      ]);
    }
    if (request.method === "GET" && path.endsWith(`/git/ref/heads/${HEAD}`)) {
      return jsonResponse(request, 404, { message: "Not Found" });
    }
    if (request.method === "GET" && path.endsWith(`/git/commits/${BASE}`)) {
      return jsonResponse(request, 200, { sha: BASE, tree: { sha: TREE } });
    }
    if (request.method === "GET" && path.endsWith(`/git/trees/${TREE}?recursive=1`)) {
      return jsonResponse(request, 200, {
        sha: TREE,
        truncated: false,
        tree: [{ path: "site/app/a.ts", mode: "100644", type: "blob", sha: BLOB }],
      });
    }
    if (request.method === "GET" && path.endsWith(`/git/blobs/${BLOB}`)) {
      const content = options.blobContent ?? "old\n";
      const bytes = new TextEncoder().encode(content);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return jsonResponse(request, 200, {
        sha: BLOB,
        size: bytes.byteLength,
        encoding: "base64",
        content: btoa(binary),
      });
    }
    if (request.method === "POST" && path.endsWith("/git/refs")) {
      assert.deepEqual(JSON.parse(request.bodyText ?? "{}"), { ref: `refs/heads/${HEAD}`, sha: BASE });
      return jsonResponse(request, 201, { ref: `refs/heads/${HEAD}`, object: { type: "commit", sha: BASE } });
    }
    if (request.method === "POST" && path.endsWith("/git/trees")) {
      assert.deepEqual(JSON.parse(request.bodyText ?? "{}"), {
        base_tree: TREE,
        tree: [{ path: "site/app/a.ts", mode: "100644", type: "blob", content: "new\n" }],
      });
      return jsonResponse(request, 201, { sha: NEW_TREE });
    }
    if (request.method === "POST" && path.endsWith("/git/commits")) {
      assert.deepEqual(JSON.parse(request.bodyText ?? "{}"), {
        message: "Solve Self-Driving: reviewed validated change",
        tree: NEW_TREE,
        parents: [BASE],
      });
      return jsonResponse(request, 201, {
        sha: COMMIT,
        tree: { sha: NEW_TREE },
        parents: [{ sha: options.commitParent ?? BASE }],
      });
    }
    if (request.method === "PATCH" && path.endsWith(`/git/refs/heads/${HEAD}`)) {
      assert.deepEqual(JSON.parse(request.bodyText ?? "{}"), { sha: COMMIT, force: false });
      return jsonResponse(request, 200, { ref: `refs/heads/${HEAD}`, object: { type: "commit", sha: COMMIT } });
    }
    if (request.method === "POST" && path.endsWith("/pulls")) {
      const body = JSON.parse(request.bodyText ?? "{}");
      assert.equal(body.head, HEAD);
      assert.equal(body.base, "main");
      assert.equal(body.draft, false);
      assert.equal(body.maintainer_can_modify, false);
      return jsonResponse(request, 201, {
        number: 860,
        state: "open",
        draft: false,
        base: { ref: "main" },
        head: { ref: HEAD, sha: COMMIT },
      });
    }
    throw new Error(`unexpected fake GitHub request ${request.method} ${path}`);
  };
  return { authorizationBroker, transport, calls, permissions };
}

function branchRequest(plan: SelfDrivingPrWriteExecutionPlan) {
  return {
    planId: plan.id,
    repository: plan.repository,
    baseRevision: plan.baseRevision,
    headBranch: plan.headBranch,
  };
}

function commitRequest(plan: SelfDrivingPrWriteExecutionPlan) {
  return {
    planId: plan.id,
    repository: plan.repository,
    headBranch: plan.headBranch,
    expectedParentRevision: plan.baseRevision,
    files: plan.files,
  };
}

function prRequest(plan: SelfDrivingPrWriteExecutionPlan) {
  return {
    planId: plan.id,
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    headBranch: plan.headBranch,
    headRevision: COMMIT,
    title: "Solve Self-Driving: reviewed validated change",
    body: `Self-Driving execution plan ${plan.id}. Automatic merge is disabled.`,
  };
}

test("concrete adapter performs exact bounded GitHub sequence and returns executor contracts", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub();
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });

  const live = await adapter.verifyLivePreflight(plan);
  assert.equal(live.baseRevision, BASE);
  assert.equal(live.headBranchExists, false);
  assert.deepEqual(live.files, [{ path: "site/app/a.ts", blobSha: BLOB }]);

  assert.deepEqual(await adapter.createBranch(branchRequest(plan)), {
    status: "created",
    branch: HEAD,
    revision: BASE,
  });
  assert.deepEqual(await adapter.createCommit(commitRequest(plan)), {
    status: "committed",
    branch: HEAD,
    parentRevision: BASE,
    commitSha: COMMIT,
  });
  assert.deepEqual(await adapter.openPullRequest(prRequest(plan)), {
    status: "opened",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    headBranch: HEAD,
    headRevision: COMMIT,
    pullRequestRef: "#860",
  });

  assert.equal(fake.calls.length, 11);
  assert.deepEqual(fake.calls.map((call) => call.method), [
    "GET", "GET", "GET", "GET", "GET", "GET",
    "POST", "POST", "POST", "PATCH", "POST",
  ]);
  assert.deepEqual(fake.permissions, [
    "contents:read", "metadata:read", "contents:read", "contents:read", "contents:read", "contents:read",
    "contents:write", "contents:write", "contents:write", "contents:write", "pull-requests:write",
  ]);
  assert.equal(fake.calls.some((call) => call.url.includes("/merges")), false);
  assert.equal(fake.calls.some((call) => call.url.includes("/actions/workflows")), false);
});

test("out-of-order or replayed adapter stages fail terminally without another GitHub call", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub();
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });

  await assert.rejects(() => adapter.createBranch(branchRequest(plan)), /requires stage preflight-ready/);
  assert.equal(fake.calls.length, 0);
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /current stage is failed/);
  assert.equal(fake.calls.length, 0);
});

test("concurrent re-entry makes failure terminal and cannot re-arm the in-flight preflight", async () => {
  const plan = executionPlan();
  let release: (() => void) | undefined;
  const firstCallEntered = new Promise<void>((resolve) => { release = resolve; });
  let unblock: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  let calls = 0;
  const transport: SelfDrivingGitHubRestTransport = async (request) => {
    calls += 1;
    if (calls === 1) {
      release?.();
      await blocked;
    }
    return jsonResponse(request, 200, { name: "main", protected: true, commit: { sha: BASE } });
  };
  const broker: SelfDrivingGitHubAuthorizationBroker = async (_permission, useToken) => useToken(TOKEN);
  const adapter = createSelfDrivingGitHubPrWriteAdapter({ authorizationBroker: broker, transport, now: () => OBSERVED_AT });

  const first = adapter.verifyLivePreflight(plan);
  await firstCallEntered;
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /requires stage idle/);
  unblock?.();
  await assert.rejects(() => first, /terminally failed|became terminally failed/);
  assert.equal(calls, 1);
  await assert.rejects(() => adapter.createBranch(branchRequest(plan)), /current stage is failed/);
  assert.equal(calls, 1);
});

test("tampered created commit parent is rejected before any head-ref update or PR open", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub({ commitParent: "9".repeat(40) });
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });

  await adapter.verifyLivePreflight(plan);
  await adapter.createBranch(branchRequest(plan));
  await assert.rejects(() => adapter.createCommit(commitRequest(plan)), /parent does not match/);
  assert.equal(fake.calls.some((call) => call.method === "PATCH"), false);
  assert.equal(fake.calls.some((call) => call.url.endsWith("/pulls")), false);
  assert.equal(fake.calls.length, 9);
});

test("materialization drift fails during preflight before all repository writes", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub({ blobContent: "different\n" });
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });

  await assert.rejects(() => adapter.verifyLivePreflight(plan), /deletion does not match the exact base content/);
  assert.equal(fake.calls.length, 6);
  assert.equal(fake.calls.some((call) => call.method !== "GET"), false);
  await assert.rejects(() => adapter.createBranch(branchRequest(plan)), /current stage is failed/);
});

test("transport failures remain bounded and do not leak injected authorization material", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub({ failUrlIncludes: "/rules/branches/main" });
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });

  let message = "";
  try {
    await adapter.verifyLivePreflight(plan);
    assert.fail("expected preflight failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /get-base-rules failed \(transport-failed\)/);
  assert.doesNotMatch(message, /fixture_token|secret transport error/);
  assert.equal(fake.calls.length, 2);
});

test("cancellation after branch creation prevents commit transport and leaves adapter terminally failed", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub();
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });
  await adapter.verifyLivePreflight(plan);
  await adapter.createBranch(branchRequest(plan));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => adapter.createCommit(commitRequest(plan), controller.signal), /cancelled|AbortError/);
  assert.equal(fake.calls.length, 7);
  await assert.rejects(() => adapter.openPullRequest(prRequest(plan)), /current stage is failed/);
  assert.equal(fake.calls.length, 7);
});

test("PR metadata drift is rejected before the pull-request transport call", async () => {
  const plan = executionPlan();
  const fake = createFakeGitHub();
  const adapter = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: fake.authorizationBroker,
    transport: fake.transport,
    now: () => OBSERVED_AT,
  });
  await adapter.verifyLivePreflight(plan);
  await adapter.createBranch(branchRequest(plan));
  await adapter.createCommit(commitRequest(plan));
  await assert.rejects(
    () => adapter.openPullRequest({ ...prRequest(plan), title: "unreviewed title" }),
    /drifted from the bound execution plan or fixed PR metadata/,
  );
  assert.equal(fake.calls.length, 10);
  assert.equal(fake.calls.some((call) => call.url.endsWith("/pulls")), false);
});
