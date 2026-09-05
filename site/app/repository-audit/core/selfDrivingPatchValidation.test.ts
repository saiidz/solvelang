import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import { createSelfDrivingSuggestionPlan, type SelfDrivingSuggestionPlan } from "./selfDrivingSuggest";
import { createSelfDrivingPatchPreview, type SelfDrivingPatchPreview } from "./selfDrivingPatchPreview";
import {
  createSelfDrivingPatchValidation,
  defaultSelfDrivingPatchValidationLimits,
  type PatchProposalValidationInput,
} from "./selfDrivingPatchValidation";

const REVISION = "a".repeat(40);
const BLOB = "b".repeat(40);

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout",
    observedAt: "2026-09-05T15:30:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

function artifacts(options: { partial?: boolean; twoValidations?: boolean } = {}): {
  suggestion: SelfDrivingSuggestionPlan;
  preview: SelfDrivingPatchPreview;
} {
  const context = options.partial
    ? createSolveContextSnapshot([
      signal({ locator: "error:old", observedAt: "2026-09-05T15:30:00Z" }),
      signal({ locator: "error:new", observedAt: "2026-09-05T15:31:00Z" }),
    ], { maxSignals: 1 })
    : createSolveContextSnapshot([signal()]);
  const run = runSelfDrivingObserve(context);
  const finding = run.inbox.items[0];
  if (!finding) throw new Error("Fixture requires an emitted finding.");
  const suggestion = createSelfDrivingSuggestionPlan(run, [{
    findingId: finding.id,
    title: "Review checkout change",
    rationale: "Prepare bounded review material tied to the emitted incident evidence.",
    edits: [{ path: "site/app/a.ts", purpose: "Adjust the affected path." }],
    validations: options.twoValidations
      ? [
        { kind: "test", label: "Run focused tests" },
        { kind: "review", label: "Review evidence and diff" },
      ]
      : [{ kind: "test", label: "Run focused tests" }],
  }]);
  const preview = createSelfDrivingPatchPreview(suggestion, REVISION, [{
    suggestionProposalId: suggestion.proposals[0].id,
    files: [{
      path: "site/app/a.ts",
      baseBlobSha: BLOB,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
    }],
  }]);
  return { suggestion, preview };
}

function evidence(
  preview: SelfDrivingPatchPreview,
  overrides: Partial<PatchProposalValidationInput> = {},
): PatchProposalValidationInput {
  return {
    patchProposalId: preview.proposals[0].id,
    results: [{
      kind: "test",
      label: "Run focused tests",
      status: "passed",
      observedAt: "2026-09-05T15:40:00Z",
      evidenceLocator: "ci:run:12345",
    }],
    ...overrides,
  };
}

test("validation evidence binds exact Suggest and Patch Preview artifacts without executing validations", () => {
  const { suggestion, preview } = artifacts();
  const result = createSelfDrivingPatchValidation(suggestion, preview, [evidence(preview)]);

  assert.equal(result.schema, "solvelang.self-driving.patch-validation.v0");
  assert.equal(result.mode, "review-only");
  assert.equal(result.repositoryRevision, REVISION);
  assert.equal(result.policy.evidenceSource, "caller-supplied");
  assert.equal(result.policy.validationExecutionAccess, false);
  assert.equal(result.policy.patchApplicationAccess, false);
  assert.equal(result.policy.shellExecutionAccess, false);
  assert.equal(result.policy.githubWriteAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.providerAccess, false);
  assert.equal(result.policy.networkAccess, false);
  assert.equal(result.policy.credentialAccess, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
  assert.equal(result.policy.externalSideEffects, false);
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.passedProposals, 1);
  assert.equal(result.execution.failedProposals, 0);
  assert.equal(result.execution.blockedProposals, 0);
  assert.equal(result.execution.reviewReadyProposals, 1);
  assert.equal(result.proposals[0].status, "passed");
  assert.equal(result.proposals[0].reviewReady, true);
  assert.match(result.proposals[0].id, /^validated_[0-9a-f]{16}$/);
  assert.match(result.proposals[0].results[0].requirementId, /^validation_[0-9a-f]{16}$/);
});

test("failed outranks blocked and blocked outranks passed when aggregating proposal validation", () => {
  const { suggestion, preview } = artifacts({ twoValidations: true });
  const base = evidence(preview, {
    results: [
      {
        kind: "test",
        label: "Run focused tests",
        status: "blocked",
        observedAt: "2026-09-05T15:40:00Z",
        evidenceLocator: "ci:run:blocked",
      },
      {
        kind: "review",
        label: "Review evidence and diff",
        status: "passed",
        observedAt: "2026-09-05T15:41:00Z",
        evidenceLocator: "review:record:1",
      },
    ],
  });
  const blocked = createSelfDrivingPatchValidation(suggestion, preview, [base]);
  assert.equal(blocked.proposals[0].status, "blocked");
  assert.equal(blocked.proposals[0].reviewReady, false);

  const failed = createSelfDrivingPatchValidation(suggestion, preview, [{
    ...base,
    results: base.results.map((item) => item.kind === "review" ? { ...item, status: "failed" as const } : item),
  }]);
  assert.equal(failed.proposals[0].status, "failed");
  assert.equal(failed.execution.failedProposals, 1);
  assert.equal(failed.execution.reviewReadyProposals, 0);
});

test("validation rejects missing, extra, duplicate, and undeclared evidence", () => {
  const { suggestion, preview } = artifacts({ twoValidations: true });
  const patchId = preview.proposals[0].id;
  const one = {
    kind: "test" as const,
    label: "Run focused tests",
    status: "passed" as const,
    observedAt: "2026-09-05T15:40:00Z",
    evidenceLocator: "ci:run:1",
  };
  const review = {
    kind: "review" as const,
    label: "Review evidence and diff",
    status: "passed" as const,
    observedAt: "2026-09-05T15:41:00Z",
    evidenceLocator: "review:1",
  };

  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [{ patchProposalId: patchId, results: [one] }]),
    /cover every source Suggest validation requirement exactly once/,
  );
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [{ patchProposalId: patchId, results: [one, review, { ...review, label: "Extra" }] }]),
    /cover every source Suggest validation requirement exactly once/,
  );
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [{ patchProposalId: patchId, results: [one, one] }]),
    /duplicate evidence/,
  );
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [{ patchProposalId: patchId, results: [one, { ...review, label: "Undeclared review" }] }]),
    /not declared by the source Suggest validation plan/,
  );
});

test("validation must cover every Patch Preview proposal exactly once and rejects unknown proposal IDs", () => {
  const { suggestion, preview } = artifacts();
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, []),
    /cover every Patch Preview proposal exactly once/,
  );
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [{ ...evidence(preview), patchProposalId: "patch_missing" }]),
    /unknown Patch Preview proposal/,
  );
});

test("partial source evidence can pass validation but never becomes review-ready", () => {
  const { suggestion, preview } = artifacts({ partial: true });
  const result = createSelfDrivingPatchValidation(suggestion, preview, [evidence(preview)]);

  assert.equal(suggestion.execution.status, "partial");
  assert.equal(preview.execution.status, "partial");
  assert.equal(result.execution.status, "partial");
  assert.deepEqual(result.execution.partialReasons, ["source-suggestion-partial", "source-patch-preview-partial"]);
  assert.equal(result.proposals[0].status, "passed");
  assert.equal(result.proposals[0].reviewReady, false);
  assert.equal(result.execution.reviewReadyProposals, 0);
});

test("validation fails closed when source artifacts are mismatched or forged", () => {
  const first = artifacts();
  const second = artifacts();
  const mismatchedPreview = {
    ...first.preview,
    source: { ...first.preview.source, availableProposals: first.preview.source.availableProposals + 1 },
  } as SelfDrivingPatchPreview;
  assert.throws(
    () => createSelfDrivingPatchValidation(first.suggestion, mismatchedPreview, []),
    /source proposal count does not match/,
  );

  const forgedSuggestion = {
    ...first.suggestion,
    policy: { ...first.suggestion.policy, githubWriteAccess: true },
  } as unknown as SelfDrivingSuggestionPlan;
  assert.throws(
    () => createSelfDrivingPatchValidation(forgedSuggestion, first.preview, []),
    /safe Suggestion Plan policy boundary/,
  );

  const forgedPreview = {
    ...second.preview,
    policy: { ...second.preview.policy, patchApplicationAccess: true },
  } as unknown as SelfDrivingPatchPreview;
  assert.throws(
    () => createSelfDrivingPatchValidation(second.suggestion, forgedPreview, []),
    /safe Patch Preview policy boundary/,
  );
});

test("validation rejects malformed timestamps, unsupported statuses, multiline evidence, and credential-like evidence", () => {
  const { suggestion, preview } = artifacts();
  const base = evidence(preview).results[0];
  const invalid = [
    { ...base, observedAt: "2026-09-05 15:40:00" },
    { ...base, status: "unknown" as "passed" },
    { ...base, evidenceLocator: "line one\nline two" },
    { ...base, evidenceLocator: "Bearer abcdefghijklmnop" },
    { ...base, label: "github_pat_abcdefghijklmnop" },
  ];

  for (const item of invalid) {
    assert.throws(
      () => createSelfDrivingPatchValidation(suggestion, preview, [{
        patchProposalId: preview.proposals[0].id,
        results: [item],
      }]),
      /UTC timestamp|not supported|single-line|credential-like/,
    );
  }
});

test("validation is deterministic for equivalent evidence ordering", () => {
  const { suggestion, preview } = artifacts({ twoValidations: true });
  const input = evidence(preview, {
    results: [
      {
        kind: "review",
        label: "Review evidence and diff",
        status: "passed",
        observedAt: "2026-09-05T15:41:00Z",
        evidenceLocator: "review:1",
      },
      {
        kind: "test",
        label: "Run focused tests",
        status: "passed",
        observedAt: "2026-09-05T15:40:00Z",
        evidenceLocator: "ci:1",
      },
    ],
  });
  const forward = createSelfDrivingPatchValidation(suggestion, preview, [input]);
  const reverse = createSelfDrivingPatchValidation(suggestion, preview, [{ ...input, results: [...input.results].reverse() }]);
  assert.deepEqual(forward, reverse);
});

test("validation enforces evidence bounds and serialized output carries no execution or write authority", () => {
  const { suggestion, preview } = artifacts();
  const oversized = evidence(preview, {
    results: Array.from({ length: defaultSelfDrivingPatchValidationLimits.maxResultsPerProposal + 1 }, (_, index) => ({
      kind: "test" as const,
      label: `test-${index}`,
      status: "passed" as const,
      observedAt: "2026-09-05T15:40:00Z",
      evidenceLocator: `ci:${index}`,
    })),
  });
  assert.throws(
    () => createSelfDrivingPatchValidation(suggestion, preview, [oversized]),
    /results exceeds/,
  );

  const result = createSelfDrivingPatchValidation(suggestion, preview, [evidence(preview)]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Authorization|Bearer|github_pat_|commandOutput|stdout|stderr/i);
  assert.equal(result.policy.validationExecutionAccess, false);
  assert.equal(result.policy.patchApplicationAccess, false);
  assert.equal(result.policy.githubWriteAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.externalSideEffects, false);
});
