import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import { createSelfDrivingPatchValidation } from "./selfDrivingPatchValidation";
import { createSelfDrivingPrPreflight } from "./selfDrivingPrPreflight";
import {
  claimSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  type SelfDrivingPrWriteApprovalInput,
} from "./selfDrivingPrWriteAuthorization";
import { createSelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";
import {
  executeSelfDrivingPrWritePlan,
  SELF_DRIVING_PR_WRITE_EXECUTOR_SCHEMA,
  SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
  type SelfDrivingPrWriteAdapter,
  type SelfDrivingPrWriteExecutorDependencies,
  type SelfDrivingPrWriteLivePreflight,
} from "./selfDrivingPrWriteExecutor";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);
const COMMIT = "c".repeat(40);
const CLAIMED_AT = "2026-09-07T15:03:00Z";
const STARTED_AT = "2026-09-07T15:04:00Z";
const COMPLETED_AT = "2026-09-07T15:04:05Z";

function signal(): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-07T14:55:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
  };
}

async function executionPlan() {
  const context = createSolveContextSnapshot([signal()]);
  const observe = runSelfDrivingObserve(context);
  const finding = observe.inbox.items[0];
  if (!finding) throw new Error("Fixture requires one finding.");
  const suggestion = createSelfDrivingSuggestionPlan(observe, [{
    findingId: finding.id,
    title: "Review checkout fix",
    rationale: "Prepare a bounded review-only checkout change.",
    edits: [{ path: "site/app/change.ts", purpose: "Adjust the affected path." }],
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
      observedAt: "2026-09-07T15:00:00Z",
      evidenceLocator: "ci:run:executor-fixture",
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
      evidenceLocator: "github:ruleset-snapshot:executor",
    },
  });
  const approvalInput: SelfDrivingPrWriteApprovalInput = {
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "pr-write-approval-executor",
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
    approvalInput,
    async () => ({ status: "claimed", claimId: "claim-pr-write-executor" }),
    { now: CLAIMED_AT },
  );
  assert.equal(claim.status, "claimed");
  return createSelfDrivingPrWriteExecutionPlan(
    suggestion,
    preview,
    validation,
    preflight,
    approvalInput,
    claim,
  );
}

function live(plan: Awaited<ReturnType<typeof executionPlan>>, overrides: Partial<SelfDrivingPrWriteLivePreflight> = {}): SelfDrivingPrWriteLivePreflight {
  return {
    schema: SELF_DRIVING_PR_WRITE_LIVE_PREFLIGHT_SCHEMA,
    status: "ready",
    observedAt: "2026-09-07T15:03:30Z",
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
    ...overrides,
  };
}

function clock(...values: string[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function successDependencies(
  plan: Awaited<ReturnType<typeof executionPlan>>,
  options: {
    adapter?: Partial<SelfDrivingPrWriteAdapter>;
    finalizer?: SelfDrivingPrWriteExecutorDependencies["finalizer"];
    signal?: AbortSignal;
    calls?: string[];
  } = {},
): SelfDrivingPrWriteExecutorDependencies {
  const calls = options.calls ?? [];
  const adapter: SelfDrivingPrWriteAdapter = {
    verifyLivePreflight: async () => {
      calls.push("verify");
      return live(plan);
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
        pullRequestRef: "github:pr:100",
      };
    },
    ...options.adapter,
  };
  return {
    adapter,
    finalizer: options.finalizer ?? (async (request) => {
      calls.push(`finalize:${request.terminalState}`);
      return { status: "finalized", finalizationId: "finalized-pr-write-executor" };
    }),
    now: clock(STARTED_AT, COMPLETED_AT),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

test("one-shot executor performs live checks, branch, commit, PR, then consumes the claim", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, { calls }));

  assert.equal(result.schema, SELF_DRIVING_PR_WRITE_EXECUTOR_SCHEMA);
  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.commitSha, COMMIT);
  assert.equal(result.pullRequestRef, "github:pr:100");
  assert.equal(result.sideEffectState, "pull-request-opened");
  assert.deepEqual(result.attempts, {
    livePreflight: 1,
    createBranch: 1,
    createCommit: 1,
    openPullRequest: 1,
    finalization: 1,
  });
  assert.deepEqual(calls, ["verify", "branch", "commit", "pr", "finalize:consumed"]);
  assert.equal(result.finalization.status, "finalized");
  assert.equal(result.finalization.terminalState, "consumed");
  assert.equal(result.policy.retries, 0);
  assert.equal(result.policy.automaticMergeAllowed, false);
  assert.equal(result.policy.directPushToBaseAllowed, false);
  assert.equal(result.policy.forcePushAllowed, false);
  assert.equal(result.policy.builtInCredentialResolver, false);
  assert.equal(result.policy.builtInNetworkClient, false);
  assert.equal(result.policy.externalSideEffects, true);
});

test("live base or blob drift fails before writes and invalidates the claim", async () => {
  for (const drifted of [
    { baseRevision: "d".repeat(40) },
    { files: [{ path: "site/app/change.ts", blobSha: "e".repeat(40) }] },
  ]) {
    const plan = await executionPlan();
    const calls: string[] = [];
    const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
      calls,
      adapter: {
        verifyLivePreflight: async () => {
          calls.push("verify");
          return live(plan, drifted as Partial<SelfDrivingPrWriteLivePreflight>);
        },
      },
    }));
    assert.equal(result.status, "failed");
    assert.equal(result.failureStage, "live-preflight");
    assert.equal(result.sideEffectState, "none");
    assert.equal(result.finalization.terminalState, "invalidated");
    assert.deepEqual(calls, ["verify", "finalize:invalidated"]);
    assert.equal(result.attempts.createBranch, 0);
  }
});

test("branch failure never retries and conservatively reports possible branch side effect", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
    calls,
    adapter: {
      createBranch: async () => {
        calls.push("branch");
        throw new Error("github_pat_secret_must_not_escape");
      },
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "create-branch");
  assert.equal(result.sideEffectState, "head-branch-may-exist");
  assert.deepEqual(calls, ["verify", "branch", "finalize:invalidated"]);
  assert.equal(result.attempts.createCommit, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret_must_not_escape/);
});

test("commit failure stops before PR creation and invalidates without retry", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
    calls,
    adapter: {
      createCommit: async () => {
        calls.push("commit");
        throw new Error("commit transport failed");
      },
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "create-commit");
  assert.equal(result.sideEffectState, "commit-may-exist");
  assert.deepEqual(calls, ["verify", "branch", "commit", "finalize:invalidated"]);
  assert.equal(result.attempts.openPullRequest, 0);
});

test("malformed PR result is a one-shot open-pr failure and never auto-merges or retries", async () => {
  const plan = await executionPlan();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
    calls,
    adapter: {
      openPullRequest: async (request) => {
        calls.push("pr");
        return {
          status: "opened",
          repository: request.repository,
          baseBranch: request.baseBranch,
          headBranch: request.headBranch,
          headRevision: request.headRevision,
          pullRequestRef: "https://github.com/saiidz/solvelang/pull/100",
        };
      },
    },
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.failureStage, "open-pr");
  assert.equal(result.sideEffectState, "pull-request-may-exist");
  assert.deepEqual(calls, ["verify", "branch", "commit", "pr", "finalize:invalidated"]);
  assert.equal(result.attempts.openPullRequest, 1);
  assert.equal(result.policy.automaticMergeAllowed, false);
});

test("pre-aborted execution performs no GitHub adapter call and invalidates the claim", async () => {
  const plan = await executionPlan();
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
    calls,
    signal: controller.signal,
  }));

  assert.equal(result.status, "cancelled");
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.stoppedStage, "live-preflight");
  assert.equal(result.sideEffectState, "none");
  assert.deepEqual(calls, ["finalize:invalidated"]);
  assert.equal(result.attempts.livePreflight, 0);
});

test("successful PR with rejected terminal finalization becomes terminal-state-unconfirmed without retry", async () => {
  const plan = await executionPlan();
  let finalizerCalls = 0;
  const result = await executeSelfDrivingPrWritePlan(plan, successDependencies(plan, {
    finalizer: async () => {
      finalizerCalls += 1;
      return { status: "rejected", reason: "store-rejected" };
    },
  }));

  assert.equal(finalizerCalls, 1);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.status, "terminal-state-unconfirmed");
  assert.equal(result.sideEffectState, "pull-request-opened");
  assert.equal(result.finalization.status, "rejected");
  assert.equal(result.finalization.rejectionReason, "store-rejected");
});

test("forged execution-plan SHA or policy is rejected before any adapter or finalizer side effect", async () => {
  const plan = await executionPlan();
  let calls = 0;
  const dependencies = successDependencies(plan, {
    adapter: {
      verifyLivePreflight: async () => {
        calls += 1;
        return live(plan);
      },
    },
    finalizer: async () => {
      calls += 1;
      return { status: "finalized", finalizationId: "must-not-run" };
    },
  });

  await assert.rejects(
    () => executeSelfDrivingPrWritePlan({ ...plan, id: `pr_write_plan_${"0".repeat(64)}` }, dependencies),
    /SHA-256 identity does not match/,
  );
  await assert.rejects(
    () => executeSelfDrivingPrWritePlan({
      ...plan,
      policy: { ...plan.policy, automaticMergeAllowed: true },
    } as typeof plan, dependencies),
    /safe no-write execution-plan policy/,
  );
  assert.equal(calls, 0);
});
