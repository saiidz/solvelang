import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import { createSelfDrivingPatchValidation, type SelfDrivingPatchValidation } from "./selfDrivingPatchValidation";
import {
  createSelfDrivingPrPreflight,
  SELF_DRIVING_PR_PLANNED_ACTIONS,
  SELF_DRIVING_PR_REQUIRED_PERMISSIONS,
  type SelfDrivingPrPreflightInput,
} from "./selfDrivingPrPreflight";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-05T16:00:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

function validationArtifact(options: { validationStatus?: "passed" | "failed" | "blocked"; partial?: boolean } = {}): SelfDrivingPatchValidation {
  const context = options.partial
    ? createSolveContextSnapshot([
      signal({ locator: "error:old", observedAt: "2026-09-05T16:00:00Z" }),
      signal({ locator: "error:new", observedAt: "2026-09-05T16:01:00Z" }),
    ], { maxSignals: 1 })
    : createSolveContextSnapshot([signal()]);
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
  return createSelfDrivingPatchValidation(suggestion, preview, [{
    patchProposalId: preview.proposals[0].id,
    results: [{
      kind: "test",
      label: "Run focused tests",
      status: options.validationStatus ?? "passed",
      observedAt: "2026-09-05T16:10:00Z",
      evidenceLocator: "ci:run:12345",
    }],
  }]);
}

function input(source: SelfDrivingPatchValidation, overrides: Partial<SelfDrivingPrPreflightInput> = {}): SelfDrivingPrPreflightInput {
  return {
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: REVISION,
    headBranch: "solve/review-checkout-fix",
    installationRef: "github-app/installation:12345",
    selectedValidationIds: [source.proposals[0].id],
    branchProtection: {
      protectedBranches: ["release", "main"],
      requiresPullRequest: true,
      allowsForcePush: false,
      requiredApprovals: 1,
      requiredChecks: ["WASM artifact security", "CI", "Rust"],
      observedAt: "2026-09-05T16:12:00Z",
      evidenceLocator: "github:ruleset-snapshot:abc123",
    },
    ...overrides,
  };
}

test("PR preflight binds exact validated revision, repository, branches, and least-privilege future permissions without writing", () => {
  const source = validationArtifact();
  const result = createSelfDrivingPrPreflight(source, input(source));

  assert.equal(result.schema, "solvelang.self-driving.pr-preflight.v0");
  assert.equal(result.mode, "authorization-preflight");
  assert.equal(result.status, "ready-for-separate-write-authorization");
  assert.match(result.id, /^pr_preflight_[0-9a-f]{16}$/);
  assert.equal(result.repository, "saiidz/solvelang");
  assert.equal(result.baseBranch, "main");
  assert.equal(result.baseRevision, REVISION);
  assert.equal(result.headBranch, "solve/review-checkout-fix");
  assert.deepEqual(result.requiredPermissions, SELF_DRIVING_PR_REQUIRED_PERMISSIONS);
  assert.deepEqual(result.requiredPermissions, {
    metadata: "read",
    contents: "write",
    pullRequests: "write",
  });
  assert.deepEqual(result.plannedActions, SELF_DRIVING_PR_PLANNED_ACTIONS);
  assert.deepEqual(result.plannedActions, ["create-branch", "create-commit", "open-pr"]);
  assert.deepEqual(result.branchProtection.requiredChecks, ["CI", "Rust", "WASM artifact security"]);
  assert.equal(result.selectedProposals.length, 1);
  assert.equal(result.policy.sourceValidationComplete, true);
  assert.equal(result.policy.allSelectedProposalsReviewReady, true);
  assert.equal(result.policy.directPushToBaseAllowed, false);
  assert.equal(result.policy.directPushToProtectedBranchAllowed, false);
  assert.equal(result.policy.forcePushAllowed, false);
  assert.equal(result.policy.tokenMaterialAccepted, false);
  assert.equal(result.policy.credentialResolutionAccess, false);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.branchCreationAccess, false);
  assert.equal(result.policy.commitWriteAccess, false);
  assert.equal(result.policy.pullRequestCreationAccess, false);
  assert.equal(result.policy.patchApplicationAccess, false);
  assert.equal(result.policy.shellExecutionAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.providerAccess, false);
  assert.equal(result.policy.networkAccess, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
  assert.equal(result.policy.externalSideEffects, false);
  assert.equal(result.policy.writeExecutionStatus, "not-executed");
  assert.equal(result.policy.writeAuthorizationGranted, false);
});

test("PR preflight rejects base revision drift before separate write authorization", () => {
  const source = validationArtifact();
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { baseRevision: "c".repeat(40) })),
    /must exactly match the validated Patch Preview repository revision/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { baseRevision: "main" })),
    /exact 40- or 64-hex revision/,
  );
});

test("PR preflight rejects direct base writes and protected head branches", () => {
  const source = validationArtifact();
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { headBranch: "main" })),
    /must differ from the protected base branch/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { headBranch: "release" })),
    /may not target a protected branch/,
  );
});

test("PR preflight rejects unsafe branch and repository identity syntax", () => {
  const source = validationArtifact();
  for (const headBranch of ["refs/heads/fix", "../fix", "fix..branch", "fix//branch", "fix.lock", "bad branch", "fix@{1"]) {
    assert.throws(
      () => createSelfDrivingPrPreflight(source, input(source, { headBranch })),
      /unsupported branch characters|canonical safe branch name|unsafe branch segment/,
      headBranch,
    );
  }
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { repository: "not-owner-repo" })),
    /exact owner\/name syntax/,
  );
});

test("PR preflight requires strong caller-supplied branch protection evidence", () => {
  const source = validationArtifact();
  const base = input(source).branchProtection;
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, requiresPullRequest: false },
    })),
    /must require pull requests/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, allowsForcePush: true },
    })),
    /must disable force pushes/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, requiredApprovals: 0 },
    })),
    /requiredApprovals must be between/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, requiredChecks: [] },
    })),
    /requiredChecks must be a non-empty array/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, protectedBranches: ["release"] },
    })),
    /Base branch must appear in the protected-branch evidence set/,
  );
});

test("PR preflight refuses failed, blocked, or partial validation artifacts", () => {
  for (const validationStatus of ["failed", "blocked"] as const) {
    const source = validationArtifact({ validationStatus });
    assert.equal(source.execution.status, "complete");
    assert.equal(source.proposals[0].reviewReady, false);
    assert.throws(
      () => createSelfDrivingPrPreflight(source, input(source)),
      /not review-ready/,
    );
  }

  const partial = validationArtifact({ partial: true });
  assert.equal(partial.execution.status, "partial");
  assert.throws(
    () => createSelfDrivingPrPreflight(partial, input(partial)),
    /requires complete Patch Validation evidence/,
  );
});

test("PR preflight rejects missing, duplicate, and unknown validated proposal selection", () => {
  const source = validationArtifact();
  const id = source.proposals[0].id;
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { selectedValidationIds: [] })),
    /must select at least one validated proposal/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { selectedValidationIds: [id, id] })),
    /contains duplicate proposal/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { selectedValidationIds: ["validated_missing"] })),
    /unknown Patch Validation proposal/,
  );
});

test("PR preflight rejects credential material and malformed protection evidence before any write authority", () => {
  const source = validationArtifact();
  const base = input(source).branchProtection;
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { installationRef: "Bearer abcdefghijklmnop" })),
    /credential-like material/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, { installationRef: "https://github.com/install/123" })),
    /opaque reference, not a URL/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, observedAt: "2026-09-05 16:12:00" },
    })),
    /explicit UTC timestamp/,
  );
  assert.throws(
    () => createSelfDrivingPrPreflight(source, input(source, {
      branchProtection: { ...base, evidenceLocator: "github_pat_abcdefghijklmnop" },
    })),
    /credential-like material/,
  );
});

test("PR preflight is deterministic for equivalent protected-branch and check ordering", () => {
  const source = validationArtifact();
  const forward = input(source);
  const reverse = {
    ...forward,
    branchProtection: {
      ...forward.branchProtection,
      protectedBranches: [...forward.branchProtection.protectedBranches].reverse(),
      requiredChecks: [...forward.branchProtection.requiredChecks].reverse(),
    },
  };
  assert.deepEqual(
    createSelfDrivingPrPreflight(source, forward),
    createSelfDrivingPrPreflight(source, reverse),
  );
});

test("serialized PR preflight is a requirement artifact, not a token or write execution artifact", () => {
  const source = validationArtifact();
  const result = createSelfDrivingPrPreflight(source, input(source));
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(
    serialized,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_[A-Za-z0-9_]{12,}|"(?:accessToken|tokenValue|privateKey|Authorization)"\s*:/i,
  );
  assert.match(serialized, /ready-for-separate-write-authorization/);
  assert.match(serialized, /not-executed/);
  assert.equal(result.policy.githubApiAccess, false);
  assert.equal(result.policy.branchCreationAccess, false);
  assert.equal(result.policy.commitWriteAccess, false);
  assert.equal(result.policy.pullRequestCreationAccess, false);
  assert.equal(result.policy.writeAuthorizationGranted, false);
});
