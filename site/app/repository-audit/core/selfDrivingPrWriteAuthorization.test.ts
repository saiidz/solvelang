import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import { createSelfDrivingPatchValidation } from "./selfDrivingPatchValidation";
import { createSelfDrivingPrPreflight, type SelfDrivingPrPreflight } from "./selfDrivingPrPreflight";
import {
  claimSelfDrivingPrWriteApproval,
  normalizeSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA,
  type SelfDrivingPrWriteApprovalInput,
  type SelfDrivingPrWriteAtomicClaimRequest,
} from "./selfDrivingPrWriteAuthorization";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);
const NOT_BEFORE = "2026-09-06T20:00:00Z";
const EXPIRES_AT = "2026-09-06T20:10:00Z";
const NOW = "2026-09-06T20:05:00Z";

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-06T19:00:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

function preflightArtifact(): SelfDrivingPrPreflight {
  const context = createSolveContextSnapshot([signal()]);
  const run = runSelfDrivingObserve(context);
  const finding = run.inbox.items[0];
  if (!finding) throw new Error("Fixture requires an emitted finding.");
  const suggestion = createSelfDrivingSuggestionPlan(run, [{
    findingId: finding.id,
    title: "Review checkout fix",
    rationale: "Prepare a review-only change from the emitted incident evidence.",
    edits: [{ path: "site/app/a.ts", purpose: "Adjust the affected path." }],
    validations: [{ kind: "test", label: "Run focused tests" }],
  }]);
  const preview = createSelfDrivingPatchPreview(suggestion, REVISION, [{
    suggestionProposalId: suggestion.proposals[0].id,
    files: [{
      path: "site/app/a.ts",
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
      observedAt: "2026-09-06T19:10:00Z",
      evidenceLocator: "ci:run:67890",
    }],
  }]);
  return createSelfDrivingPrPreflight(validation, {
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: REVISION,
    headBranch: "solve/review-checkout-fix",
    installationRef: "github-app/installation:12345",
    selectedValidationIds: [validation.proposals[0].id],
    branchProtection: {
      protectedBranches: ["release", "main"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["WASM artifact security", "CI", "Rust"],
      observedAt: "2026-09-06T19:12:00Z",
      evidenceLocator: "github:ruleset-snapshot:def456",
    },
  });
}

function approvalInput(
  preflight: SelfDrivingPrPreflight,
  overrides: Partial<SelfDrivingPrWriteApprovalInput> = {},
): SelfDrivingPrWriteApprovalInput {
  return {
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "pr-write-approval-001",
    preflightId: preflight.id,
    repository: preflight.repository,
    baseBranch: preflight.baseBranch,
    baseRevision: preflight.baseRevision,
    headBranch: preflight.headBranch,
    installationRef: preflight.installationRef,
    operator: "owner:saiidz",
    runtime: "isolated-pr-writer-v0",
    notBefore: NOT_BEFORE,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

test("PR write approval binds the exact canonical no-write preflight and remains non-executing", () => {
  const preflight = preflightArtifact();
  const approval = normalizeSelfDrivingPrWriteApproval(preflight, approvalInput(preflight));

  assert.equal(approval.schema, SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA);
  assert.equal(approval.state, "approved");
  assert.equal(approval.binding.preflightId, preflight.id);
  assert.equal(approval.binding.repository, "saiidz/solvelang");
  assert.equal(approval.binding.baseBranch, "main");
  assert.equal(approval.binding.baseRevision, REVISION);
  assert.equal(approval.binding.headBranch, "solve/review-checkout-fix");
  assert.deepEqual(approval.binding.requiredPermissions, {
    metadata: "read",
    contents: "write",
    pullRequests: "write",
  });
  assert.deepEqual(approval.binding.plannedActions, ["create-branch", "create-commit", "open-pr"]);
  assert.equal(approval.binding.selectedProposals.length, 1);
  assert.equal(Object.isFrozen(approval), true);
  assert.equal(Object.isFrozen(approval.binding), true);
  assert.equal(Object.isFrozen(approval.binding.branchProtection), true);
  assert.equal(Object.isFrozen(approval.binding.branchProtection.requiredChecks), true);
  assert.equal(Object.isFrozen(approval.binding.selectedProposals), true);
});

test("atomic PR write claim binds the complete normalized approval and returns no write execution authority", async () => {
  const preflight = preflightArtifact();
  let calls = 0;
  let captured: SelfDrivingPrWriteAtomicClaimRequest | undefined;

  const result = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput(preflight),
    async (request) => {
      calls += 1;
      captured = request;
      return { status: "claimed", claimId: "claim-pr-write-001" };
    },
    { now: NOW },
  );

  assert.equal(calls, 1);
  assert.equal(result.schema, SELF_DRIVING_PR_WRITE_CLAIM_SCHEMA);
  assert.equal(result.status, "claimed");
  assert.equal(result.claimId, "claim-pr-write-001");
  assert.equal(result.preflightId, preflight.id);
  assert.equal(captured?.expectedState, "approved");
  assert.equal(captured?.binding.approvalId, "pr-write-approval-001");
  assert.equal(captured?.binding.operator, "owner:saiidz");
  assert.equal(captured?.binding.runtime, "isolated-pr-writer-v0");
  assert.equal(captured?.binding.notBefore, new Date(NOT_BEFORE).toISOString());
  assert.equal(captured?.binding.expiresAt, new Date(EXPIRES_AT).toISOString());
  assert.equal(captured?.binding.binding.preflightId, preflight.id);
  assert.equal(captured?.binding.binding.repository, preflight.repository);
  assert.equal(captured?.binding.binding.baseRevision, preflight.baseRevision);
  assert.equal(result.policy.atomicSingleUseClaimRequired, true);
  assert.equal(result.policy.writeAuthorizationClaimMutationAttempted, true);
  assert.equal(result.policy.retries, 0);
  assert.equal(result.policy.automaticRearm, false);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.credentialResolutionAccess, false);
  assert.equal(result.policy.branchCreationAccess, false);
  assert.equal(result.policy.commitWriteAccess, false);
  assert.equal(result.policy.pullRequestCreationAccess, false);
  assert.equal(result.policy.patchApplicationAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.mergeAccess, false);
  assert.equal(result.policy.networkAccess, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
  assert.equal(result.policy.writeExecutionStatus, "not-executed");
});

test("PR write approval rejects binding drift before the atomic claimer can run", async () => {
  const preflight = preflightArtifact();
  const cases: Array<Partial<SelfDrivingPrWriteApprovalInput>> = [
    { preflightId: "pr_preflight_deadbeefdeadbeef" },
    { repository: "saiidz/other" },
    { baseBranch: "release" },
    { baseRevision: "c".repeat(40) },
    { headBranch: "solve/other-fix" },
    { installationRef: "github-app/installation:99999" },
  ];

  for (const overrides of cases) {
    let calls = 0;
    await assert.rejects(
      () => claimSelfDrivingPrWriteApproval(
        preflight,
        approvalInput(preflight, overrides),
        async () => {
          calls += 1;
          return { status: "claimed", claimId: "must-not-run" };
        },
        { now: NOW },
      ),
      /must exactly match/,
    );
    assert.equal(calls, 0);
  }
});

test("PR write approval rejects forged weaker preflight policy and canonical identity drift", () => {
  const preflight = preflightArtifact();
  const weakened = {
    ...preflight,
    policy: { ...preflight.policy, githubApiAccess: true },
  } as unknown as SelfDrivingPrPreflight;
  assert.throws(
    () => normalizeSelfDrivingPrWriteApproval(weakened, approvalInput(preflight)),
    /safe no-write preflight policy boundary/,
  );

  const forgedId = {
    ...preflight,
    id: "pr_preflight_0000000000000000",
  } as SelfDrivingPrPreflight;
  assert.throws(
    () => normalizeSelfDrivingPrWriteApproval(forgedId, approvalInput(forgedId)),
    /identity does not match its canonical write binding/,
  );
});

test("PR write approval enforces a short explicit UTC authorization window before claiming", async () => {
  const preflight = preflightArtifact();
  assert.throws(
    () => normalizeSelfDrivingPrWriteApproval(preflight, approvalInput(preflight, {
      expiresAt: "2026-09-06T20:20:01Z",
    })),
    /15-minute authorization bound/,
  );
  assert.throws(
    () => normalizeSelfDrivingPrWriteApproval(preflight, approvalInput(preflight, {
      notBefore: "2026-09-06 20:00:00",
    })),
    /explicit UTC timestamp/,
  );

  let calls = 0;
  await assert.rejects(
    () => claimSelfDrivingPrWriteApproval(
      preflight,
      approvalInput(preflight),
      async () => {
        calls += 1;
        return { status: "claimed", claimId: "must-not-run" };
      },
      { now: "2026-09-06T19:59:59Z" },
    ),
    /not active yet/,
  );
  await assert.rejects(
    () => claimSelfDrivingPrWriteApproval(
      preflight,
      approvalInput(preflight),
      async () => {
        calls += 1;
        return { status: "claimed", claimId: "must-not-run" };
      },
      { now: EXPIRES_AT },
    ),
    /expired/,
  );
  assert.equal(calls, 0);
});

test("PR write approval rejects credential-like metadata without exposing token material", () => {
  const preflight = preflightArtifact();
  for (const overrides of [
    { operator: "Bearer abcdefghijklmnop" },
    { runtime: "github_pat_abcdefghijklmnop" },
    { approvalId: "sl_live_abcdefghijklmno" },
  ]) {
    assert.throws(
      () => normalizeSelfDrivingPrWriteApproval(preflight, approvalInput(preflight, overrides)),
      /credential-like material/,
    );
  }
});

test("PR write claim sanitizes claimer failure and malformed results without retry", async () => {
  const preflight = preflightArtifact();
  let throwsCalls = 0;
  const failed = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput(preflight),
    async () => {
      throwsCalls += 1;
      throw new Error("github_pat_secret_should_never_escape");
    },
    { now: NOW },
  );
  assert.equal(throwsCalls, 1);
  assert.equal(failed.status, "rejected");
  assert.equal(failed.rejectionReason, "claimer-failure");
  assert.doesNotMatch(JSON.stringify(failed), /secret_should_never_escape/);

  let malformedCalls = 0;
  const malformed = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput(preflight),
    async () => {
      malformedCalls += 1;
      return { status: "claimed", claimId: "github_pat_abcdefghijklmnop" };
    },
    { now: NOW },
  );
  assert.equal(malformedCalls, 1);
  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.rejectionReason, "invalid-claim-result");
});

test("atomic fixture permits only one concurrent claim for one PR write approval", async () => {
  const preflight = preflightArtifact();
  let claimed = false;
  let calls = 0;
  const claimer = async (): Promise<{ status: "claimed"; claimId: string } | { status: "rejected"; reason: "already-claimed" }> => {
    calls += 1;
    if (claimed) return { status: "rejected", reason: "already-claimed" };
    claimed = true;
    await Promise.resolve();
    return { status: "claimed", claimId: "claim-pr-write-concurrent" };
  };

  const [first, second] = await Promise.all([
    claimSelfDrivingPrWriteApproval(preflight, approvalInput(preflight), claimer, { now: NOW }),
    claimSelfDrivingPrWriteApproval(preflight, approvalInput(preflight), claimer, { now: NOW }),
  ]);

  assert.equal(calls, 2);
  assert.deepEqual([first.status, second.status].sort(), ["claimed", "rejected"]);
  const rejected = first.status === "rejected" ? first : second;
  assert.equal(rejected.rejectionReason, "already-claimed");
});

test("serialized PR write claim is authorization evidence, never GitHub write execution or credential output", async () => {
  const preflight = preflightArtifact();
  const result = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput(preflight),
    async () => ({ status: "claimed", claimId: "claim-pr-write-serialized" }),
    { now: NOW },
  );
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(
    serialized,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_[A-Za-z0-9_]{12,}|"(?:accessToken|tokenValue|privateKey|Authorization)"\s*:/i,
  );
  assert.match(serialized, /not-executed/);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.mergeAccess, false);
});
