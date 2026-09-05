import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve } from "./selfDrivingObserveRun";
import {
  createSelfDrivingSuggestionPlan,
  type SelfDrivingSuggestionPlan,
} from "./selfDrivingSuggest";
import {
  createSelfDrivingPatchPreview,
  defaultSelfDrivingPatchPreviewLimits,
  type SelfDrivingPatchProposalInput,
} from "./selfDrivingPatchPreview";

const REVISION = "a".repeat(40);
const BLOB_A = "b".repeat(40);
const BLOB_B = "c".repeat(40);

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout-submit",
    observedAt: "2026-09-05T15:00:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

function suggestionPlan(twoPaths = false): SelfDrivingSuggestionPlan {
  const run = runSelfDrivingObserve(createSolveContextSnapshot([signal()]));
  const finding = run.inbox.items[0];
  if (!finding) throw new Error("Fixture requires an emitted finding.");
  return createSelfDrivingSuggestionPlan(run, [{
    findingId: finding.id,
    title: "Review checkout guard changes",
    rationale: "Prepare a bounded review-only change from the emitted incident evidence.",
    edits: twoPaths
      ? [
        { path: "site/app/a.ts", purpose: "Adjust the first affected path." },
        { path: "site/app/b.ts", purpose: "Adjust the second affected path." },
      ]
      : [{ path: "site/app/a.ts", purpose: "Adjust the affected path." }],
    validations: [{ kind: "test", label: "Run focused tests" }],
  }]);
}

function patch(plan: SelfDrivingSuggestionPlan, twoPaths = false): SelfDrivingPatchProposalInput {
  const source = plan.proposals[0];
  if (!source) throw new Error("Fixture requires a Suggest proposal.");
  return {
    suggestionProposalId: source.id,
    files: twoPaths
      ? [
        {
          path: "site/app/a.ts",
          baseBlobSha: BLOB_A,
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-const value = 1;", "+const value = 2;"] }],
        },
        {
          path: "site/app/b.ts",
          baseBlobSha: BLOB_B,
          hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: [" keep();", "+review();"] }],
        },
      ]
      : [{
        path: "site/app/a.ts",
        baseBlobSha: BLOB_A,
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-const value = 1;", "+const value = 2;"] }],
      }],
  };
}

test("patch preview binds structured text hunks to exact revision, base blobs, and Suggest paths", () => {
  const plan = suggestionPlan();
  const preview = createSelfDrivingPatchPreview(plan, REVISION, [patch(plan)]);

  assert.equal(preview.schema, "solvelang.self-driving.patch-preview.v0");
  assert.equal(preview.mode, "review-only");
  assert.equal(preview.repositoryRevision, REVISION);
  assert.equal(preview.policy.sourceMode, "suggest");
  assert.equal(preview.policy.patchContentIncluded, true);
  assert.equal(preview.policy.structuredTextHunksOnly, true);
  assert.equal(preview.policy.patchApplicationAccess, false);
  assert.equal(preview.policy.shellExecutionAccess, false);
  assert.equal(preview.policy.githubWriteAccess, false);
  assert.equal(preview.policy.repositoryWriteAccess, false);
  assert.equal(preview.policy.providerAccess, false);
  assert.equal(preview.policy.networkAccess, false);
  assert.equal(preview.policy.credentialAccess, false);
  assert.equal(preview.policy.rolloutMutationAccess, false);
  assert.equal(preview.policy.productionMutationAccess, false);
  assert.equal(preview.policy.billingMutationAccess, false);
  assert.equal(preview.policy.solveRunnerAuthority, false);
  assert.equal(preview.policy.externalSideEffects, false);
  assert.equal(preview.execution.status, "complete");
  assert.equal(preview.execution.emittedPatchProposals, 1);
  assert.equal(preview.execution.emittedFiles, 1);
  assert.equal(preview.execution.emittedHunks, 1);
  assert.equal(preview.execution.emittedLines, 2);
  assert.match(preview.proposals[0].id, /^patch_[0-9a-f]{16}$/);
  assert.equal(preview.proposals[0].files[0].baseBlobSha, BLOB_A);
});

test("patch preview is deterministic regardless of file and non-overlapping hunk ordering", () => {
  const plan = suggestionPlan(true);
  const forwardPatch = patch(plan, true);
  forwardPatch.files[0].hunks = [
    { oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, lines: ["-ten", "+TEN"] },
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-one", "+ONE"] },
  ];
  const reversePatch = {
    ...forwardPatch,
    files: [...forwardPatch.files].reverse().map((file) => ({ ...file, hunks: [...file.hunks].reverse() })),
  };

  const forward = createSelfDrivingPatchPreview(plan, REVISION.toUpperCase(), [forwardPatch]);
  const reverse = createSelfDrivingPatchPreview(plan, REVISION, [reversePatch]);
  assert.deepEqual(forward, reverse);
});

test("patch preview rejects unknown, duplicate, missing, and extra Suggest path bindings", () => {
  const plan = suggestionPlan(true);
  const valid = patch(plan, true);

  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{ ...valid, suggestionProposalId: "suggest_missing" }]),
    /unknown Suggest proposal/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [valid, valid]),
    /Only one patch preview may bind/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{ ...valid, files: [valid.files[0]] }]),
    /cover every source Suggest edit intent path/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [
        ...valid.files,
        { ...valid.files[0], path: "site/app/not-authorized.ts", baseBlobSha: "d".repeat(40) },
      ],
    }]),
    /not authorized by the source Suggest edit intents/,
  );
});

test("patch preview requires exact repository and base blob revisions", () => {
  const plan = suggestionPlan();
  const valid = patch(plan);
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, "main", [valid]),
    /repositoryRevision must be an exact 40- or 64-hex revision/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{ ...valid.files[0], baseBlobSha: "not-a-blob" }],
    }]),
    /baseBlobSha must be an exact 40- or 64-hex revision/,
  );
});

test("patch preview validates hunk line prefixes, declared counts, and overlap", () => {
  const plan = suggestionPlan();
  const valid = patch(plan);

  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{
        ...valid.files[0],
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["const bad = true;"] }],
      }],
    }]),
    /must start with context, addition, or deletion prefix/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{
        ...valid.files[0],
        hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
      }],
    }]),
    /line prefixes do not match declared old\/new line counts/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{
        ...valid.files[0],
        hunks: [
          { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" one", " two", " three"] },
          { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-three", "+THREE"] },
        ],
      }],
    }]),
    /overlapping or ambiguous old-file ranges/,
  );
});

test("patch preview rejects binary markers, multiline/control records, and credential-like patch content", () => {
  const plan = suggestionPlan();
  const valid = patch(plan);
  const unsafeLines = [
    "+GIT binary patch",
    "+Binary files a and b differ",
    "+line one\nline two",
    "+bad\u0000control",
    "+const token = 'Bearer abcdefghijklmnop';",
    "+const token = 'github_pat_abcdefghijklmnop';",
    "+-----BEGIN PRIVATE KEY-----",
  ];

  for (const line of unsafeLines) {
    assert.throws(
      () => createSelfDrivingPatchPreview(plan, REVISION, [{
        ...valid,
        files: [{
          ...valid.files[0],
          hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [line] }],
        }],
      }]),
      /binary patch marker|exactly one patch line|unsupported control characters|credential-like material/,
      line,
    );
  }
});

test("patch preview enforces proposal, per-hunk line, line-byte, and total-line bounds", () => {
  const plan = suggestionPlan();
  const valid = patch(plan);
  assert.throws(
    () => createSelfDrivingPatchPreview(
      plan,
      REVISION,
      Array.from({ length: defaultSelfDrivingPatchPreviewLimits.maxPatchProposals + 1 }, () => valid),
    ),
    /Patch preview proposals exceeds/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{
        ...valid.files[0],
        hunks: [{
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: defaultSelfDrivingPatchPreviewLimits.maxLinesPerHunk + 1,
          lines: Array.from({ length: defaultSelfDrivingPatchPreviewLimits.maxLinesPerHunk + 1 }, () => "+x"),
        }],
      }],
    }]),
    /lines exceeds/,
  );
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{
        ...valid.files[0],
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [`+${"x".repeat(defaultSelfDrivingPatchPreviewLimits.maxLineBytes + 1)}`] }],
      }],
    }]),
    /byte line bound/,
  );

  const hunks = Array.from({ length: 11 }, (_, index) => ({
    oldStart: index * 500 + 1,
    oldLines: 500,
    newStart: index * 500 + 1,
    newLines: 500,
    lines: Array.from({ length: 500 }, () => " x"),
  }));
  assert.throws(
    () => createSelfDrivingPatchPreview(plan, REVISION, [{
      ...valid,
      files: [{ ...valid.files[0], hunks }],
    }]),
    /5000-line total bound/,
  );
});

test("patch preview preserves partial Suggest evidence and fails closed on forged source authority", () => {
  const context = createSolveContextSnapshot([
    signal({ locator: "error:old", observedAt: "2026-09-05T15:00:00Z" }),
    signal({ locator: "error:new", observedAt: "2026-09-05T15:01:00Z" }),
  ], { maxSignals: 1 });
  const run = runSelfDrivingObserve(context);
  const finding = run.inbox.items[0];
  if (!finding) throw new Error("Fixture requires an emitted finding.");
  const partialPlan = createSelfDrivingSuggestionPlan(run, [{
    findingId: finding.id,
    title: "Partial evidence proposal",
    rationale: "Keep source partiality visible while preparing bounded review material.",
    edits: [{ path: "site/app/a.ts", purpose: "Review the affected path." }],
    validations: [{ kind: "review", label: "Review partial evidence" }],
  }]);
  const preview = createSelfDrivingPatchPreview(partialPlan, REVISION, [patch(partialPlan)]);
  assert.equal(partialPlan.execution.status, "partial");
  assert.equal(preview.execution.status, "partial");
  assert.deepEqual(preview.execution.partialReasons, ["source-suggestion-partial"]);

  const forged = {
    ...partialPlan,
    policy: { ...partialPlan.policy, githubWriteAccess: true },
  } as unknown as SelfDrivingSuggestionPlan;
  assert.throws(
    () => createSelfDrivingPatchPreview(forged, REVISION, []),
    /safe canonical Suggestion Plan policy boundary/,
  );
});

test("serialized patch preview exposes content for review but no application or write authority", () => {
  const plan = suggestionPlan();
  const preview = createSelfDrivingPatchPreview(plan, REVISION, [patch(plan)]);
  const serialized = JSON.stringify(preview);

  assert.match(serialized, /const value = 2/);
  assert.doesNotMatch(serialized, /Authorization|Bearer|github_pat_/i);
  assert.equal(preview.policy.patchApplicationAccess, false);
  assert.equal(preview.policy.shellExecutionAccess, false);
  assert.equal(preview.policy.githubWriteAccess, false);
  assert.equal(preview.policy.repositoryWriteAccess, false);
  assert.equal(preview.policy.productionMutationAccess, false);
  assert.equal(preview.policy.externalSideEffects, false);
});
