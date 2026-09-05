import assert from "node:assert/strict";
import test from "node:test";
import { createSolveContextSnapshot, type SolveContextSignalInput } from "./selfDrivingContext";
import { runSelfDrivingObserve, type SelfDrivingObserveRun } from "./selfDrivingObserveRun";
import {
  createSelfDrivingSuggestionPlan,
  defaultSelfDrivingSuggestionLimits,
  type SelfDrivingSuggestionProposalInput,
} from "./selfDrivingSuggest";

function signal(overrides: Partial<SolveContextSignalInput> = {}): SolveContextSignalInput {
  return {
    kind: "error",
    source: "fixture-context",
    locator: "error:checkout-submit",
    observedAt: "2026-09-05T14:00:00Z",
    summary: "Sanitized checkout error evidence.",
    dimensions: {},
    metrics: {},
    sanitized: true,
    ...overrides,
  };
}

function observeRun(inputs: SolveContextSignalInput[] = [signal()]): SelfDrivingObserveRun {
  return runSelfDrivingObserve(createSolveContextSnapshot(inputs));
}

function proposal(run: SelfDrivingObserveRun, overrides: Partial<SelfDrivingSuggestionProposalInput> = {}): SelfDrivingSuggestionProposalInput {
  const finding = run.inbox.items[0];
  if (!finding) throw new Error("Fixture requires an emitted finding.");
  return {
    findingId: finding.id,
    title: "Guard checkout submission failures",
    rationale: "Use the emitted incident evidence to plan a narrowly scoped repository change for review.",
    edits: [
      {
        path: "site/app/checkout/checkoutGate.ts",
        purpose: "Add a bounded guard around the explicit failing checkout state.",
      },
    ],
    validations: [
      { kind: "test", label: "Run focused checkout gate tests" },
      { kind: "review", label: "Review the resulting diff against the incident evidence" },
    ],
    ...overrides,
  };
}

test("Suggestion mode creates a deterministic review-only plan bound to an emitted Inbox finding", () => {
  const run = observeRun();
  const plan = createSelfDrivingSuggestionPlan(run, [proposal(run)]);

  assert.equal(plan.schema, "solvelang.self-driving.suggestion-plan.v0");
  assert.equal(plan.mode, "review-only");
  assert.equal(plan.policy.requestedMode, "suggest");
  assert.equal(plan.policy.effectiveMode, "suggest");
  assert.equal(plan.policy.sourceAnalysisMode, "observe");
  assert.equal(plan.policy.proposalGeneration, "caller-supplied");
  assert.equal(plan.policy.patchBytesIncluded, false);
  assert.equal(plan.policy.patchApplicationAccess, false);
  assert.equal(plan.policy.shellExecutionAccess, false);
  assert.equal(plan.policy.githubWriteAccess, false);
  assert.equal(plan.policy.repositoryWriteAccess, false);
  assert.equal(plan.policy.providerAccess, false);
  assert.equal(plan.policy.networkAccess, false);
  assert.equal(plan.policy.credentialAccess, false);
  assert.equal(plan.policy.rolloutMutationAccess, false);
  assert.equal(plan.policy.productionMutationAccess, false);
  assert.equal(plan.policy.externalSideEffects, false);
  assert.equal(plan.execution.status, "complete");
  assert.deepEqual(plan.execution.partialReasons, []);
  assert.equal(plan.proposals.length, 1);
  assert.match(plan.proposals[0].id, /^suggest_[0-9a-f]{16}$/);
  assert.equal(plan.proposals[0].findingId, run.inbox.items[0].id);
  assert.equal(plan.proposals[0].scout, "incident");
  assert.deepEqual(plan.proposals[0].provenance, run.inbox.items[0].provenance);
});

test("Suggestion plan is deterministic regardless of proposal and edit ordering", () => {
  const run = observeRun([
    signal({ locator: "error:a", observedAt: "2026-09-05T14:00:00Z" }),
    signal({ locator: "error:b", observedAt: "2026-09-05T14:01:00Z" }),
  ]);
  const [firstFinding, secondFinding] = run.inbox.items;
  assert.ok(firstFinding && secondFinding);

  const first: SelfDrivingSuggestionProposalInput = {
    findingId: firstFinding.id,
    title: "First proposal",
    rationale: "Review the first emitted incident with bounded repository intent.",
    edits: [
      { path: "site/app/a.ts", purpose: "Adjust the first affected path." },
      { path: "site/app/b.ts", purpose: "Adjust the second affected path." },
    ],
    validations: [
      { kind: "review", label: "Review affected paths" },
      { kind: "test", label: "Run focused tests" },
    ],
  };
  const second: SelfDrivingSuggestionProposalInput = {
    findingId: secondFinding.id,
    title: "Second proposal",
    rationale: "Review the second emitted incident with bounded repository intent.",
    edits: [{ path: "site/app/c.ts", purpose: "Adjust the third affected path." }],
    validations: [{ kind: "build", label: "Build the static site" }],
  };

  const forward = createSelfDrivingSuggestionPlan(run, [first, second]);
  const reverse = createSelfDrivingSuggestionPlan(run, [
    second,
    {
      ...first,
      edits: [...first.edits].reverse(),
      validations: [...first.validations].reverse(),
    },
  ]);

  assert.deepEqual(forward, reverse);
});

test("Suggestion plan rejects unknown and duplicate finding bindings", () => {
  const run = observeRun();
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, { findingId: "scout_missing" })]),
    /unknown emitted Inbox finding/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run), proposal(run, { title: "Duplicate" })]),
    /Only one suggestion proposal may bind to finding/,
  );
});

test("Suggestion plan rejects absolute, traversal, non-canonical, and Git metadata paths", () => {
  const run = observeRun();
  for (const path of [
    "/etc/passwd",
    "../outside.ts",
    "site/../outside.ts",
    "./site/app.ts",
    "site\\app\\bad.ts",
    ".git/config",
    "C:/temp/file.ts",
  ]) {
    assert.throws(
      () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
        edits: [{ path, purpose: "Review this path." }],
      })]),
      /repository-relative|forward slashes|canonical repository-relative|unsafe path segment|Git metadata/,
      path,
    );
  }
});

test("Suggestion plan rejects duplicate edit paths and executable validation kinds", () => {
  const run = observeRun();
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      edits: [
        { path: "site/app/a.ts", purpose: "First intent." },
        { path: "site/app/a.ts", purpose: "Second intent." },
      ],
    })]),
    /target each path only once/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      validations: [{ kind: "shell" as "test", label: "Execute arbitrary shell" }],
    })]),
    /is not supported/,
  );
});

test("Suggestion plan rejects multiline, credential-like, and raw-looking review text", () => {
  const run = observeRun();
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, { rationale: "line one\nline two" })]),
    /single-line review value/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, { title: "Use Bearer abcdefghijklmnop" })]),
    /credential-like material/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      edits: [{ path: "site/app/a.ts", purpose: "Use github_pat_abcdefghijklmnop" }],
    })]),
    /credential-like material/,
  );
});

test("Suggestion plan preserves upstream Observe partiality rather than claiming complete evidence", () => {
  const context = createSolveContextSnapshot([
    signal({ locator: "error:old", observedAt: "2026-09-05T14:00:00Z" }),
    signal({ locator: "error:new", observedAt: "2026-09-05T14:01:00Z" }),
  ], { maxSignals: 1 });
  const run = runSelfDrivingObserve(context);
  const plan = createSelfDrivingSuggestionPlan(run, [proposal(run)]);

  assert.equal(run.execution.status, "partial");
  assert.equal(plan.source.observeStatus, "partial");
  assert.equal(plan.execution.status, "partial");
  assert.deepEqual(plan.execution.partialReasons, ["source-observe-partial"]);
});

test("Suggestion plan fails closed on a forged Observe or Inbox policy before proposal processing", () => {
  const run = observeRun();
  const forgedObserve = {
    ...run,
    policy: { ...run.policy, repositoryWriteAccess: true },
  } as unknown as SelfDrivingObserveRun;
  assert.throws(
    () => createSelfDrivingSuggestionPlan(forgedObserve, []),
    /safe canonical Observe policy boundary/,
  );

  const forgedInbox = {
    ...run,
    inbox: {
      ...run.inbox,
      policy: { ...run.inbox.policy, externalSideEffects: true },
    },
  } as unknown as SelfDrivingObserveRun;
  assert.throws(
    () => createSelfDrivingSuggestionPlan(forgedInbox, []),
    /safe canonical Solve Inbox policy boundary/,
  );
});

test("Suggestion plan enforces proposal, edit, validation, and text bounds", () => {
  const run = observeRun();
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, Array.from(
      { length: defaultSelfDrivingSuggestionLimits.maxProposals + 1 },
      () => proposal(run),
    )),
    /Suggestion proposals exceeds/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      edits: Array.from({ length: defaultSelfDrivingSuggestionLimits.maxEditsPerProposal + 1 }, (_, index) => ({
        path: `site/app/edit-${index}.ts`,
        purpose: "Bounded edit intent.",
      })),
    })]),
    /Suggestion edit intents exceeds/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      validations: Array.from(
        { length: defaultSelfDrivingSuggestionLimits.maxValidationsPerProposal + 1 },
        () => ({ kind: "test" as const, label: "Run focused test" }),
      ),
    })]),
    /Suggestion validation steps exceeds/,
  );
  assert.throws(
    () => createSelfDrivingSuggestionPlan(run, [proposal(run, {
      title: "x".repeat(defaultSelfDrivingSuggestionLimits.maxTitleLength + 1),
    })]),
    /proposal.title exceeds/,
  );
});

test("Serialized suggestion artifacts contain no patch body or write-capable authority", () => {
  const run = observeRun();
  const plan = createSelfDrivingSuggestionPlan(run, [proposal(run)]);
  const serialized = JSON.stringify(plan);

  assert.doesNotMatch(serialized, /patchBody|replacementContent|Authorization|Bearer /i);
  assert.equal(plan.policy.patchBytesIncluded, false);
  assert.equal(plan.policy.patchApplicationAccess, false);
  assert.equal(plan.policy.shellExecutionAccess, false);
  assert.equal(plan.policy.githubWriteAccess, false);
  assert.equal(plan.policy.repositoryWriteAccess, false);
  assert.equal(plan.policy.productionMutationAccess, false);
  assert.equal(plan.policy.externalSideEffects, false);
});
