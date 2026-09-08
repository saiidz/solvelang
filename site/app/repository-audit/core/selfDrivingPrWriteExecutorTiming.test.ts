import assert from "node:assert/strict";
import test from "node:test";
import {
  executeSelfDrivingPrWritePlan,
  SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
  type SelfDrivingPrWriteAdapter,
  type SelfDrivingPrWriteExecutorDependencies,
  type SelfDrivingPrWriteLivePreflight,
} from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const COMMIT = "c".repeat(40);
const CLAIMED_AT = "2026-09-07T15:00:00Z";

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for timing fixtures.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function executionPlan(): Promise<SelfDrivingPrWriteExecutionPlan> {
  const base: Omit<SelfDrivingPrWriteExecutionPlan, "id"> = {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0",
    mode: "no-write-execution-plan",
    status: "ready-for-separate-github-executor",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE,
    headBranch: "solve/review/timing-fix",
    installationRef: "github-app/installation:timing-fixture",
    approvalId: "approval-timing-fixture",
    approvalBindingSha256: "d".repeat(64),
    claimId: "claim-timing-fixture",
    claimedAt: CLAIMED_AT,
    requiredPermissions: { metadata: "read", contents: "write", pullRequests: "write" },
    plannedActions: ["create-branch", "create-commit", "open-pr"],
    requiredLiveChecks: [
      "verify-exact-base-revision",
      "verify-fresh-branch-protection",
      "verify-head-branch-absent",
      "verify-base-blob-shas",
    ],
    branchProtectionEvidence: {
      protectedBranches: ["main", "release"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
      observedAt: "2026-09-07T14:59:00Z",
      evidenceLocator: "github:rules:timing-fixture",
    },
    selectedProposals: [{
      validationId: "validation-timing",
      patchProposalId: "patch-timing",
      suggestionProposalId: "suggestion-timing",
      findingId: "finding-timing",
      severity: "high",
    }],
    files: [{
      proposalId: "patch-timing",
      validationId: "validation-timing",
      suggestionProposalId: "suggestion-timing",
      findingId: "finding-timing",
      path: "site/app/timing.ts",
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
  const canonical = {
    repository: base.repository,
    baseBranch: base.baseBranch,
    baseRevision: base.baseRevision,
    headBranch: base.headBranch,
    installationRef: base.installationRef,
    approvalId: base.approvalId,
    approvalBindingSha256: base.approvalBindingSha256,
    claimId: base.claimId,
    claimedAt: base.claimedAt,
    requiredPermissions: base.requiredPermissions,
    plannedActions: base.plannedActions,
    requiredLiveChecks: base.requiredLiveChecks,
    branchProtectionEvidence: base.branchProtectionEvidence,
    selectedProposals: base.selectedProposals,
    files: base.files,
    limits: base.limits,
    totals: base.totals,
  };
  return { ...base, id: `pr_write_plan_${await sha256Hex(JSON.stringify(canonical))}` };
}

function live(plan: SelfDrivingPrWriteExecutionPlan, observedAt: string): SelfDrivingPrWriteLivePreflight {
  return {
    schema: SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
    status: "ready",
    observedAt,
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    baseRevision: plan.baseRevision,
    headBranch: plan.headBranch,
    headBranchExists: false,
    branchProtection: {
      protectedBranches: ["main", "release"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
    },
    files: plan.files.map((file) => ({ path: file.path, blobSha: file.baseBlobSha })),
  };
}

function clock(...values: string[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function dependencies(
  plan: SelfDrivingPrWriteExecutionPlan,
  observedAt: string,
  times: readonly [string, string, string],
  calls: string[],
): SelfDrivingPrWriteExecutorDependencies {
  const adapter: SelfDrivingPrWriteAdapter = {
    verifyLivePreflight: async () => {
      calls.push("verify");
      return live(plan, observedAt);
    },
    createBranch: async (request) => {
      calls.push("branch");
      return { status: "created", branch: request.headBranch, revision: request.baseRevision };
    },
    createCommit: async (request) => {
      calls.push("commit");
      return {
        status: "committed",
        branch: request.headBranch,
        parentRevision: request.expectedParentRevision,
        commitSha: COMMIT,
      };
    },
    openPullRequest: async (request) => {
      calls.push("pr");
      return {
        status: "opened",
        repository: request.repository,
        baseBranch: request.baseBranch,
        headBranch: request.headBranch,
        headRevision: request.headRevision,
        pullRequestRef: "#900",
      };
    },
  };
  return {
    adapter,
    finalizer: async (request) => {
      calls.push(`finalize:${request.terminalState}`);
      return { status: "finalized", finalizationId: "timing-finalized" };
    },
    now: clock(...times),
  };
}

test("live evidence observed during network preflight may be after execution start when checked afterward", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, dependencies(
    plan,
    "2026-09-07T15:04:02Z",
    ["2026-09-07T15:04:00Z", "2026-09-07T15:04:03Z", "2026-09-07T15:04:04Z"],
    calls,
  ));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, ["verify", "branch", "commit", "pr", "finalize:consumed"]);
});

test("live evidence after the post-preflight trusted clock remains future-dated and fails before writes", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, dependencies(
    plan,
    "2026-09-07T15:04:04Z",
    ["2026-09-07T15:04:00Z", "2026-09-07T15:04:03Z", "2026-09-07T15:04:05Z"],
    calls,
  ));
  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "live-preflight");
  assert.deepEqual(calls, ["verify", "finalize:invalidated"]);
});

test("live evidence freshness is measured against the post-preflight check time", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, dependencies(
    plan,
    "2026-09-07T15:01:00Z",
    ["2026-09-07T15:04:00Z", "2026-09-07T15:04:03Z", "2026-09-07T15:04:05Z"],
    calls,
  ));
  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "live-preflight");
  assert.deepEqual(calls, ["verify", "finalize:invalidated"]);
});

test("a backwards-moving trusted clock fails closed before any write", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, dependencies(
    plan,
    "2026-09-07T15:03:59Z",
    ["2026-09-07T15:04:00Z", "2026-09-07T15:03:59Z", "2026-09-07T15:04:05Z"],
    calls,
  ));
  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "live-preflight");
  assert.deepEqual(calls, ["verify", "finalize:invalidated"]);
});
