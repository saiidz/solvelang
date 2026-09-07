import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import { createSelfDrivingPatchValidation } from "./selfDrivingPatchValidation";
import { createSelfDrivingPrPreflight } from "./selfDrivingPrPreflight";
import {
  claimSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
} from "./selfDrivingPrWriteAuthorization";
import { createSelfDrivingPrWriteExecutionPlan, type SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";
import {
  finalizeSelfDrivingPrWriteClaim,
  SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA,
  type SelfDrivingPrWriteFinalizerRequest,
} from "./selfDrivingPrWriteFinalization";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);

async function executionPlan(): Promise<SelfDrivingPrWriteExecutionPlan> {
  const context = createSolveContextSnapshot([{
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-07T15:00:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
  }]);
  const observe = runSelfDrivingObserve(context);
  const finding = observe.inbox.items[0];
  if (!finding) throw new Error("Fixture requires one finding.");
  const suggestion = createSelfDrivingSuggestionPlan(observe, [{
    findingId: finding.id,
    title: "Review checkout fix",
    rationale: "Prepare one review-only fix.",
    edits: [{ path: "site/app/change.ts", purpose: "Adjust affected path." }],
    validations: [{ kind: "test", label: "Run focused tests" }],
  }]);
  const preview = createSelfDrivingPatchPreview(suggestion, REVISION, [{
    suggestionProposalId: suggestion.proposals[0].id,
    files: [{
      path: "site/app/change.ts",
      baseBlobSha: BLOB,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
    }],
  }]);
  const validation = createSelfDrivingPatchValidation(suggestion, preview, [{
    patchProposalId: preview.proposals[0].id,
    results: [{
      kind: "test",
      label: "Run focused tests",
      status: "passed",
      observedAt: "2026-09-07T15:01:00Z",
      evidenceLocator: "ci:run:finalization",
    }],
  }]);
  const preflight = createSelfDrivingPrPreflight(validation, {
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: REVISION,
    headBranch: "solve/review-checkout-fix",
    installationRef: "github-app/installation:12345",
    selectedValidationIds: [validation.proposals[0].id],
    branchProtection: {
      protectedBranches: ["main", "release"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
      observedAt: "2026-09-07T15:02:00Z",
      evidenceLocator: "github:ruleset-snapshot:finalization",
    },
  });
  const approval = {
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved" as const,
    approvalId: "pr-write-approval-finalization",
    preflightId: preflight.id,
    repository: preflight.repository,
    baseBranch: preflight.baseBranch,
    baseRevision: preflight.baseRevision,
    headBranch: preflight.headBranch,
    installationRef: preflight.installationRef,
    operator: "owner:saiidz",
    runtime: "isolated-pr-writer-v0",
    notBefore: "2026-09-07T15:00:00Z",
    expiresAt: "2026-09-07T15:10:00Z",
  };
  const claim = await claimSelfDrivingPrWriteApproval(
    preflight,
    approval,
    async () => ({ status: "claimed", claimId: "claim-pr-write-finalization" }),
    { now: "2026-09-07T15:03:00Z" },
  );
  return createSelfDrivingPrWriteExecutionPlan(suggestion, preview, validation, preflight, approval, claim);
}

test("successful PR write evidence consumes the single-use claim exactly once", async () => {
  const plan = await executionPlan();
  let calls = 0;
  let captured: SelfDrivingPrWriteFinalizerRequest | undefined;
  const result = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "succeeded",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:20Z",
    attempts: 1,
    commitSha: "c".repeat(40),
    pullRequestRef: "github:pr:853",
  }, async (request) => {
    calls += 1;
    captured = request;
    return { status: "finalized", finalizationId: "finalization-success-001" };
  });

  assert.equal(calls, 1);
  assert.equal(result.schema, SELF_DRIVING_PR_WRITE_FINALIZATION_SCHEMA);
  assert.equal(result.status, "finalized");
  assert.equal(result.terminalState, "consumed");
  assert.equal(result.outcome, "succeeded");
  assert.equal(captured?.expectedClaimState, "claimed");
  assert.equal(captured?.claimId, plan.claimId);
  assert.equal(captured?.approvalBindingSha256, plan.approvalBindingSha256);
  assert.equal(captured?.planId, plan.id);
  assert.equal(captured?.evidence.commitSha, "c".repeat(40));
  assert.equal(captured?.evidence.pullRequestRef, "github:pr:853");
  assert.equal(result.policy.retries, 0);
  assert.equal(result.policy.automaticRearm, false);
  assert.equal(result.policy.githubApiAccess, false);
});

test("failed and cancelled attempts invalidate the claim", async () => {
  const plan = await executionPlan();
  const failed = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "failed",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
    failureStage: "live-preflight",
  }, async () => ({ status: "finalized", finalizationId: "finalization-failed" }));
  assert.equal(failed.terminalState, "invalidated");
  assert.equal(failed.outcome, "failed");

  const cancelled = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:07Z",
    attempts: 1,
  }, async () => ({ status: "finalized", finalizationId: "finalization-cancelled" }));
  assert.equal(cancelled.terminalState, "invalidated");
  assert.equal(cancelled.outcome, "cancelled");
});

test("success requires exact commit and opaque PR evidence while failure cannot claim completed writes", async () => {
  const plan = await executionPlan();
  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "succeeded",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
  }, async () => ({ status: "finalized", finalizationId: "must-not-run" })), /commitSha/);

  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "succeeded",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
    commitSha: "c".repeat(40),
    pullRequestRef: "https://github.com/saiidz/solvelang/pull/853",
  }, async () => ({ status: "finalized", finalizationId: "must-not-run" })), /opaque reference, not a URL/);

  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "failed",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
    failureStage: "open-pr",
    commitSha: "c".repeat(40),
  }, async () => ({ status: "finalized", finalizationId: "must-not-run" })), /may not claim a completed commit or pull request/);
});

test("finalization rejects invalid timing, retries, and forged plan authority before store mutation", async () => {
  const plan = await executionPlan();
  let calls = 0;
  const finalizer = async () => {
    calls += 1;
    return { status: "finalized" as const, finalizationId: "must-not-run" };
  };

  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:02:59Z",
    completedAt: "2026-09-07T15:03:01Z",
    attempts: 1,
  }, finalizer), /cannot start before the claim timestamp/);

  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:04:06Z",
    attempts: 1,
  }, finalizer), /60-second finalization evidence bound/);

  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 2,
  }, finalizer), /exactly one write attempt/);

  const forged = {
    ...plan,
    policy: { ...plan.policy, githubApiAccess: true },
  } as unknown as SelfDrivingPrWriteExecutionPlan;
  await assert.rejects(() => finalizeSelfDrivingPrWriteClaim(forged, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
  }, finalizer), /safe no-write execution-plan policy/);
  assert.equal(calls, 0);
});

test("finalizer failures and malformed results are sanitized without retry", async () => {
  const plan = await executionPlan();
  let calls = 0;
  const failed = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
  }, async () => {
    calls += 1;
    throw new Error("github_pat_secret_should_never_escape");
  });
  assert.equal(calls, 1);
  assert.equal(failed.status, "rejected");
  assert.equal(failed.rejectionReason, "finalizer-failure");
  assert.doesNotMatch(JSON.stringify(failed), /secret_should_never_escape/);

  const malformed = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "cancelled",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
  }, async () => ({ status: "finalized", finalizationId: "github_pat_abcdefghijklmnop" }));
  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.rejectionReason, "invalid-finalizer-result");
});

test("atomic fixture permits only one terminal finalization for one claim", async () => {
  const plan = await executionPlan();
  let finalized = false;
  const finalizer = async () => {
    if (finalized) return { status: "rejected" as const, reason: "already-finalized" as const };
    finalized = true;
    await Promise.resolve();
    return { status: "finalized" as const, finalizationId: "finalization-once" };
  };
  const evidence = {
    outcome: "cancelled" as const,
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:06Z",
    attempts: 1,
  };
  const [first, second] = await Promise.all([
    finalizeSelfDrivingPrWriteClaim(plan, evidence, finalizer),
    finalizeSelfDrivingPrWriteClaim(plan, evidence, finalizer),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["finalized", "rejected"]);
  const rejected = first.status === "rejected" ? first : second;
  assert.equal(rejected.rejectionReason, "already-finalized");
});

test("serialized finalization evidence never returns credentials or GitHub write authority", async () => {
  const plan = await executionPlan();
  const result = await finalizeSelfDrivingPrWriteClaim(plan, {
    outcome: "succeeded",
    startedAt: "2026-09-07T15:03:05Z",
    completedAt: "2026-09-07T15:03:20Z",
    attempts: 1,
    commitSha: "c".repeat(40),
    pullRequestRef: "github:pr:853",
  }, async () => ({ status: "finalized", finalizationId: "finalization-serialized" }));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_[A-Za-z0-9_]{12,}|"(?:accessToken|tokenValue|privateKey|Authorization)"\s*:/i,
  );
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
});
