import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview, type SelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import { createSelfDrivingPatchValidation, type SelfDrivingPatchValidation } from "./selfDrivingPatchValidation";
import { createSelfDrivingPrPreflight, type SelfDrivingPrPreflight } from "./selfDrivingPrPreflight";
import {
  claimSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  type SelfDrivingPrWriteApprovalInput,
  type SelfDrivingPrWriteClaimResult,
} from "./selfDrivingPrWriteAuthorization";
import {
  createSelfDrivingPrWriteExecutionPlan,
  SELF_DRIVING_PR_WRITE_EXECUTION_LIVE_CHECKS,
  SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA,
} from "./selfDrivingPrWriteExecutionPlan";

const REVISION = "a".repeat(40);
const BLOB_A = "b".repeat(40);
const BLOB_B = "c".repeat(40);
const NOT_BEFORE = "2026-09-07T15:00:00Z";
const EXPIRES_AT = "2026-09-07T15:10:00Z";
const NOW = "2026-09-07T15:03:00Z";

function signal(index: number): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: `error:checkout:${index}`,
    observedAt: `2026-09-07T14:5${index}:00Z`,
    summary: `Sanitized checkout error evidence ${index}.`,
    dimensions: {},
    metrics: {},
    sanitized: true,
  };
}

type Fixture = {
  suggestion: ReturnType<typeof createSelfDrivingSuggestionPlan>;
  preview: SelfDrivingPatchPreview;
  validation: SelfDrivingPatchValidation;
  preflight: SelfDrivingPrPreflight;
  approvalInput: SelfDrivingPrWriteApprovalInput;
  claim: SelfDrivingPrWriteClaimResult;
};

async function fixture(options: { proposals?: number; samePath?: boolean } = {}): Promise<Fixture> {
  const proposalCount = options.proposals ?? 1;
  const context = createSolveContextSnapshot(Array.from({ length: proposalCount }, (_, index) => signal(index)));
  const observe = runSelfDrivingObserve(context);
  assert.ok(observe.inbox.items.length >= proposalCount);

  const suggestion = createSelfDrivingSuggestionPlan(
    observe,
    observe.inbox.items.slice(0, proposalCount).map((finding, index) => ({
      findingId: finding.id,
      title: `Review checkout fix ${index}`,
      rationale: `Prepare review-only change ${index} from emitted evidence.`,
      edits: [{
        path: options.samePath ? "site/app/shared.ts" : `site/app/change-${index}.ts`,
        purpose: `Adjust affected path ${index}.`,
      }],
      validations: [{ kind: "test" as const, label: `Run focused tests ${index}` }],
    })),
  );

  const preview = createSelfDrivingPatchPreview(
    suggestion,
    REVISION,
    suggestion.proposals.map((proposal, index) => ({
      suggestionProposalId: proposal.id,
      files: [{
        path: proposal.edits[0].path,
        baseBlobSha: index === 0 ? BLOB_A : BLOB_B,
        hunks: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [`-old-${index}`, `+new-${index}`],
        }],
      }],
    })),
  );

  const validation = createSelfDrivingPatchValidation(
    suggestion,
    preview,
    preview.proposals.map((proposal, index) => ({
      patchProposalId: proposal.id,
      results: [{
        kind: "test" as const,
        label: `Run focused tests ${index}`,
        status: "passed" as const,
        observedAt: `2026-09-07T14:5${index}:30Z`,
        evidenceLocator: `ci:run:${1000 + index}`,
      }],
    })),
  );

  const preflight = createSelfDrivingPrPreflight(validation, {
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: REVISION,
    headBranch: "solve/review-checkout-fix",
    installationRef: "github-app/installation:12345",
    selectedValidationIds: validation.proposals.map((proposal) => proposal.id),
    branchProtection: {
      protectedBranches: ["main", "release"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
      observedAt: "2026-09-07T15:01:00Z",
      evidenceLocator: "github:ruleset-snapshot:execution-plan",
    },
  });

  const approvalInput: SelfDrivingPrWriteApprovalInput = {
    schema: SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "pr-write-approval-execution-plan",
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
  };

  const claim = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput,
    async () => ({ status: "claimed", claimId: "claim-pr-write-execution-plan" }),
    { now: NOW },
  );
  assert.equal(claim.status, "claimed");
  return { suggestion, preview, validation, preflight, approvalInput, claim };
}

async function planFrom(value: Fixture) {
  return createSelfDrivingPrWriteExecutionPlan(
    value.suggestion,
    value.preview,
    value.validation,
    value.preflight,
    value.approvalInput,
    value.claim,
  );
}

test("execution plan binds canonical reviewed artifacts and successful claim without writing", async () => {
  const value = await fixture();
  const plan = await planFrom(value);

  assert.equal(plan.schema, SELF_DRIVING_PR_WRITE_EXECUTION_PLAN_SCHEMA);
  assert.equal(plan.mode, "no-write-execution-plan");
  assert.equal(plan.status, "ready-for-separate-github-executor");
  assert.match(plan.id, /^pr_write_plan_[0-9a-f]{64}$/);
  assert.equal(plan.repository, "saiidz/solvelang");
  assert.equal(plan.baseBranch, "main");
  assert.equal(plan.baseRevision, REVISION);
  assert.equal(plan.headBranch, "solve/review-checkout-fix");
  assert.equal(plan.approvalId, value.approvalInput.approvalId);
  assert.equal(plan.approvalBindingSha256, value.claim.approvalBindingSha256);
  assert.equal(plan.claimId, value.claim.claimId);
  assert.deepEqual(plan.requiredLiveChecks, SELF_DRIVING_PR_WRITE_EXECUTION_LIVE_CHECKS);
  assert.deepEqual(plan.plannedActions, ["create-branch", "create-commit", "open-pr"]);
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].path, "site/app/change-0.ts");
  assert.equal(plan.files[0].baseBlobSha, BLOB_A);
  assert.deepEqual(plan.totals, { proposals: 1, files: 1, hunks: 1, lines: 2, patchBytes: 12 });
  assert.equal(plan.policy.sourceArtifactsRecreated, true);
  assert.equal(plan.policy.cryptographicApprovalBindingVerified, true);
  assert.equal(plan.policy.successfulSingleUseClaimRequired, true);
  assert.equal(plan.policy.githubApiAccess, false);
  assert.equal(plan.policy.credentialResolutionAccess, false);
  assert.equal(plan.policy.branchCreationAccess, false);
  assert.equal(plan.policy.commitWriteAccess, false);
  assert.equal(plan.policy.pullRequestCreationAccess, false);
  assert.equal(plan.policy.repositoryWriteAccess, false);
  assert.equal(plan.policy.automaticMergeAllowed, false);
  assert.equal(plan.policy.writeExecutionStatus, "not-executed");
});

test("execution plan rejects forged Patch Preview and Patch Validation artifacts", async () => {
  const value = await fixture();
  const forgedPreview = {
    ...value.preview,
    execution: { ...value.preview.execution, emittedBytes: value.preview.execution.emittedBytes + 1 },
  } as SelfDrivingPatchPreview;
  await assert.rejects(
    () => createSelfDrivingPrWriteExecutionPlan(
      value.suggestion,
      forgedPreview,
      value.validation,
      value.preflight,
      value.approvalInput,
      value.claim,
    ),
    /Patch Preview does not match its canonical recreated artifact/,
  );

  const forgedValidation = {
    ...value.validation,
    execution: { ...value.validation.execution, reviewReadyProposals: 0 },
  } as SelfDrivingPatchValidation;
  await assert.rejects(
    () => createSelfDrivingPrWriteExecutionPlan(
      value.suggestion,
      value.preview,
      forgedValidation,
      value.preflight,
      value.approvalInput,
      value.claim,
    ),
    /Patch Validation does not match its canonical recreated artifact/,
  );
});

test("execution plan rejects forged PR preflight policy before claim consumption", async () => {
  const value = await fixture();
  const forgedPreflight = {
    ...value.preflight,
    policy: { ...value.preflight.policy, githubApiAccess: true },
  } as unknown as SelfDrivingPrPreflight;

  await assert.rejects(
    () => createSelfDrivingPrWriteExecutionPlan(
      value.suggestion,
      value.preview,
      value.validation,
      forgedPreflight,
      value.approvalInput,
      value.claim,
    ),
    /PR preflight requires the safe Patch Validation policy boundary|PR preflight does not match|safe no-write preflight/,
  );
});

test("execution plan rejects substituted approval identity even when approval and preflight IDs are reused", async () => {
  const value = await fixture();
  const substituted = { ...value.approvalInput, operator: "owner:other" };
  await assert.rejects(
    () => createSelfDrivingPrWriteExecutionPlan(
      value.suggestion,
      value.preview,
      value.validation,
      value.preflight,
      substituted,
      value.claim,
    ),
    /SHA-256 approval binding does not match/,
  );
});

test("execution plan requires a successful cryptographically safe claim", async () => {
  const value = await fixture();
  const rejected = {
    ...value.claim,
    status: "rejected",
    claimId: undefined,
    rejectionReason: "already-claimed",
  } as SelfDrivingPrWriteClaimResult;
  await assert.rejects(() => createSelfDrivingPrWriteExecutionPlan(
    value.suggestion,
    value.preview,
    value.validation,
    value.preflight,
    value.approvalInput,
    rejected,
  ), /requires a successful claimed authorization/);

  const weakened = {
    ...value.claim,
    policy: { ...value.claim.policy, githubApiAccess: true },
  } as unknown as SelfDrivingPrWriteClaimResult;
  await assert.rejects(() => createSelfDrivingPrWriteExecutionPlan(
    value.suggestion,
    value.preview,
    value.validation,
    value.preflight,
    value.approvalInput,
    weakened,
  ), /safe cryptographically bound claim policy/);
});

test("execution plan rejects overlapping selected proposals that target the same file", async () => {
  const value = await fixture({ proposals: 2, samePath: true });
  await assert.rejects(() => planFrom(value), /overlap on file path site\/app\/shared\.ts/);
});

test("execution plan is deterministic for the same canonical authorization and patch set", async () => {
  const value = await fixture();
  const first = await planFrom(value);
  const second = await planFrom(value);
  assert.deepEqual(second, first);
});

test("serialized execution plan contains review data but no credential or write authority", async () => {
  const value = await fixture();
  const plan = await planFrom(value);
  const serialized = JSON.stringify(plan);

  assert.doesNotMatch(
    serialized,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_[A-Za-z0-9_]{12,}|"(?:accessToken|tokenValue|privateKey|Authorization)"\s*:/i,
  );
  assert.match(serialized, /ready-for-separate-github-executor/);
  assert.match(serialized, /not-executed/);
  assert.equal(plan.policy.githubApiAccess, false);
  assert.equal(plan.policy.repositoryWriteAccess, false);
  assert.equal(plan.policy.productionMutationAccess, false);
  assert.equal(plan.policy.solveRunnerAuthority, false);
});
