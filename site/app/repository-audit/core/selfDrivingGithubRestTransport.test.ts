import assert from "node:assert/strict";
import test from "node:test";
import {
  planSelfDrivingGitHubBaseBlobRequest,
  planSelfDrivingGitHubLivePreflightRequests,
  type SelfDrivingGitHubRestRequestPlan,
} from "./selfDrivingGithubRestPlanner";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";
import {
  executeSelfDrivingGitHubRestRequest,
  type SelfDrivingGitHubAuthorizationBroker,
  type SelfDrivingGitHubRestTransport,
  type SelfDrivingGitHubRestTransportRequest,
} from "./selfDrivingGithubRestTransport";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const TOKEN = "ghs_fixture_ephemeral_token_1234567890";

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

function broker(token = TOKEN): SelfDrivingGitHubAuthorizationBroker {
  return async <T>(_permission: Parameters<SelfDrivingGitHubAuthorizationBroker>[0], useToken: (value: string) => Promise<T>) => useToken(token);
}

function successTransport(
  bodyText = JSON.stringify({ ok: true }),
  contentType = "application/json; charset=utf-8",
): { transport: SelfDrivingGitHubRestTransport; requests: SelfDrivingGitHubRestTransportRequest[] } {
  const requests: SelfDrivingGitHubRestTransportRequest[] = [];
  const transport: SelfDrivingGitHubRestTransport = async (request) => {
    requests.push(request);
    return {
      status: request.method === "POST" ? 201 : 200,
      url: request.url,
      bodyText,
      contentType,
    };
  };
  return { transport, requests };
}

test("transport injects ephemeral Authorization exactly once without returning it", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  const fixture = successTransport(JSON.stringify({ sha: BLOB }));
  const result = await executeSelfDrivingGitHubRestRequest(plan, broker(), fixture.transport);

  assert.equal(result.status, "success");
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(fixture.requests[0].redirect, "error");
  assert.equal(Object.prototype.hasOwnProperty.call(plan.headers, "Authorization"), false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(result), /Authorization/);
  if (result.status === "success") {
    assert.equal(result.policy.transportCalls, 1);
    assert.equal(result.policy.retries, 0);
    assert.equal(result.policy.redirectsFollowed, false);
  }
});

test("hostile operation/path, permission, status, bounds, or extra headers fail before credential access", async () => {
  const base = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  const hostilePlans: SelfDrivingGitHubRestRequestPlan[] = [
    { ...base, path: "/repos/saiidz/solvelang/actions/workflows/deploy.yml/dispatches", url: "https://api.github.com/repos/saiidz/solvelang/actions/workflows/deploy.yml/dispatches" } as SelfDrivingGitHubRestRequestPlan,
    { ...base, requiredPermission: "contents:write" } as SelfDrivingGitHubRestRequestPlan,
    { ...base, expectedStatuses: [200, 201] } as SelfDrivingGitHubRestRequestPlan,
    { ...base, maxResponseBytes: base.maxResponseBytes + 1 } as SelfDrivingGitHubRestRequestPlan,
    { ...base, headers: { ...base.headers, Authorization: "Bearer not-allowed" } } as unknown as SelfDrivingGitHubRestRequestPlan,
  ];

  for (const plan of hostilePlans) {
    let brokerCalls = 0;
    let transportCalls = 0;
    const result = await executeSelfDrivingGitHubRestRequest(
      plan,
      async <T>(_permission: Parameters<SelfDrivingGitHubAuthorizationBroker>[0], useToken: (token: string) => Promise<T>) => {
        brokerCalls += 1;
        return useToken(TOKEN);
      },
      async () => {
        transportCalls += 1;
        throw new Error("must not run");
      },
    );
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.failureCode, "invalid-request-plan");
    assert.equal(brokerCalls, 0);
    assert.equal(transportCalls, 0);
  }
});

test("credential-like request body fails closed before broker and transport", async () => {
  const base = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  const hostile = { ...base, body: { token: "github_pat_abcdefghijklmnop" } } as SelfDrivingGitHubRestRequestPlan;
  let brokerCalls = 0;
  const result = await executeSelfDrivingGitHubRestRequest(
    hostile,
    async <T>(_permission: Parameters<SelfDrivingGitHubAuthorizationBroker>[0], useToken: (token: string) => Promise<T>) => {
      brokerCalls += 1;
      return useToken(TOKEN);
    },
    async () => { throw new Error("must not run"); },
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "invalid-request-plan");
  assert.equal(brokerCalls, 0);
});

test("invalid credentials never reach transport and are not returned", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  let transportCalls = 0;
  const result = await executeSelfDrivingGitHubRestRequest(
    plan,
    broker("short"),
    async () => {
      transportCalls += 1;
      throw new Error("must not run");
    },
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "invalid-credential");
  assert.equal(transportCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /short/);
});

test("transport errors are sanitized and never echo token or raw error", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  const result = await executeSelfDrivingGitHubRestRequest(
    plan,
    broker(),
    async () => { throw new Error(`upstream failed with Bearer ${TOKEN}`); },
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "transport-failed");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(TOKEN));
  assert.doesNotMatch(serialized, /upstream failed/);
  assert.doesNotMatch(serialized, /Bearer/);
});

test("response URL drift is rejected as a redirect boundary violation", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  const result = await executeSelfDrivingGitHubRestRequest(
    plan,
    broker(),
    async () => ({
      status: 200,
      url: "https://example.invalid/redirected",
      bodyText: "{}",
      contentType: "application/json",
    }),
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "response-url-mismatch");
});

test("unexpected status, oversize body, non-json content type, and invalid JSON all fail closed", async () => {
  const headPlan = planSelfDrivingGitHubLivePreflightRequests(executionPlan())[2];
  const cases: Array<readonly [SelfDrivingGitHubRestTransport, string]> = [
    [async (request) => ({ status: 500, url: request.url, bodyText: "{}", contentType: "application/json" }), "response-status-unexpected"],
    [async (request) => ({ status: 200, url: request.url, bodyText: "x".repeat(headPlan.maxResponseBytes + 1), contentType: "application/json" }), "response-too-large"],
    [async (request) => ({ status: 200, url: request.url, bodyText: "{}", contentType: "text/html" }), "response-content-type-invalid"],
    [async (request) => ({ status: 200, url: request.url, bodyText: "not-json", contentType: "application/json" }), "response-json-invalid"],
  ];

  for (const [transport, expected] of cases) {
    const result = await executeSelfDrivingGitHubRestRequest(headPlan, broker(), transport);
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.failureCode, expected);
    assert.equal(result.transportCalls, 1);
  }
});

test("404 is accepted only where the planner explicitly allows it", async () => {
  const headPlan = planSelfDrivingGitHubLivePreflightRequests(executionPlan())[2];
  const result = await executeSelfDrivingGitHubRestRequest(
    headPlan,
    broker(),
    async (request) => ({
      status: 404,
      url: request.url,
      bodyText: JSON.stringify({ message: "Not Found" }),
      contentType: "application/json",
    }),
  );
  assert.equal(result.status, "success");
  if (result.status === "success") assert.equal(result.httpStatus, 404);
});

test("broker failures are sanitized and transport is never called", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  let transportCalls = 0;
  const result = await executeSelfDrivingGitHubRestRequest(
    plan,
    async () => { throw new Error(`credential resolver leaked ${TOKEN}`); },
    async () => {
      transportCalls += 1;
      throw new Error("must not run");
    },
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "credential-broker-failed");
  assert.equal(transportCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("a broker that re-enters the callback cannot cause a second network call", async () => {
  const plan = planSelfDrivingGitHubBaseBlobRequest("saiidz/solvelang", BLOB);
  let transportCalls = 0;
  const result = await executeSelfDrivingGitHubRestRequest(
    plan,
    async <T>(_permission: Parameters<SelfDrivingGitHubAuthorizationBroker>[0], useToken: (token: string) => Promise<T>) => {
      await useToken(TOKEN);
      return useToken(TOKEN);
    },
    async (request) => {
      transportCalls += 1;
      return { status: 200, url: request.url, bodyText: "{}", contentType: "application/json" };
    },
  );
  assert.equal(transportCalls, 1);
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.failureCode, "transport-reentered");
});
