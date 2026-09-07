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
  computeSelfDrivingPrWriteApprovalBindingSha256,
  normalizeSelfDrivingPrWriteApproval,
  SELF_DRIVING_PR_WRITE_APPROVAL_SCHEMA,
  type SelfDrivingPrWriteApprovalInput,
  type SelfDrivingPrWriteAtomicClaimRequest,
} from "./selfDrivingPrWriteAuthorization";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);
const NOW = "2026-09-06T20:05:00Z";

function fixture() {
  const context = createSolveContextSnapshot([{
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-06T19:00:00Z",
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
    rationale: "Prepare a review-only change from the emitted evidence.",
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
      observedAt: "2026-09-06T19:55:00Z",
      evidenceLocator: "ci:run:67890",
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
      protectedBranches: ["release", "main"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["WASM artifact security", "CI", "Rust"],
      observedAt: "2026-09-06T20:00:00Z",
      evidenceLocator: "github:ruleset-snapshot:def456",
    },
  });
  const approvalInput: SelfDrivingPrWriteApprovalInput = {
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
    notBefore: "2026-09-06T20:00:00Z",
    expiresAt: "2026-09-06T20:10:00Z",
  };
  return { preflight, approvalInput };
}

test("SHA-256 PR write approval binding is deterministic and covers operator/runtime identity", async () => {
  const { preflight, approvalInput } = fixture();
  const approval = normalizeSelfDrivingPrWriteApproval(preflight, approvalInput);
  const first = await computeSelfDrivingPrWriteApprovalBindingSha256(approval);
  const second = await computeSelfDrivingPrWriteApprovalBindingSha256(approval);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);

  const changedOperator = normalizeSelfDrivingPrWriteApproval(preflight, {
    ...approvalInput,
    operator: "owner:alternate",
  });
  const changedRuntime = normalizeSelfDrivingPrWriteApproval(preflight, {
    ...approvalInput,
    runtime: "isolated-pr-writer-v1",
  });
  assert.notEqual(await computeSelfDrivingPrWriteApprovalBindingSha256(changedOperator), first);
  assert.notEqual(await computeSelfDrivingPrWriteApprovalBindingSha256(changedRuntime), first);
});

test("atomic claim request and result carry the same SHA-256 approval binding", async () => {
  const { preflight, approvalInput } = fixture();
  let captured: SelfDrivingPrWriteAtomicClaimRequest | undefined;
  const result = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput,
    async (request) => {
      captured = request;
      return { status: "claimed", claimId: "claim-pr-write-001" };
    },
    { now: NOW },
  );

  assert.equal(result.status, "claimed");
  assert.match(result.approvalBindingSha256, /^[0-9a-f]{64}$/);
  assert.equal(captured?.approvalBindingSha256, result.approvalBindingSha256);
  assert.equal(
    captured?.approvalBindingSha256,
    await computeSelfDrivingPrWriteApprovalBindingSha256(captured!.binding),
  );
  assert.equal(result.policy.cryptographicApprovalBindingRequired, true);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.writeExecutionStatus, "not-executed");
});

test("sanitized rejected claims retain binding identity without leaking the normalized approval", async () => {
  const { preflight, approvalInput } = fixture();
  const result = await claimSelfDrivingPrWriteApproval(
    preflight,
    approvalInput,
    async () => {
      throw new Error("github_pat_secret_should_not_escape");
    },
    { now: NOW },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.rejectionReason, "claimer-failure");
  assert.match(result.approvalBindingSha256, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /secret_should_not_escape|owner:saiidz|isolated-pr-writer-v0/);
});
