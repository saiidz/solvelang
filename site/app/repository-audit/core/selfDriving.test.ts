import assert from "node:assert/strict";
import test from "node:test";
import { createSolveInbox, type ScoutFindingInput } from "./selfDriving";

function finding(overrides: Partial<ScoutFindingInput> = {}): ScoutFindingInput {
  return {
    scout: "code",
    severity: "medium",
    title: "Repository issue",
    summary: "A bounded scout found a repository-local issue.",
    impact: "A maintainer should inspect the affected path before changing code.",
    confidence: {
      score: 0.9,
      basis: "Static repository evidence matched a deterministic rule.",
    },
    provenance: [
      {
        kind: "repository",
        locator: "src/example.ts",
        revision: "abc123",
      },
    ],
    recommendedAction: {
      kind: "inspect",
      label: "Inspect evidence",
    },
    ...overrides,
  };
}

test("Solve Inbox is deterministic across input order and preserves observe-only policy", () => {
  const high = finding({
    scout: "security",
    severity: "high",
    title: "Security boundary needs review",
    provenance: [
      { kind: "repository", locator: "src/auth.ts", revision: "abc123" },
      { kind: "trace", locator: "trace:sanitized-17" },
    ],
  });
  const low = finding({
    scout: "experience",
    severity: "low",
    title: "Checkout friction signal",
    provenance: [{ kind: "runtime-event", locator: "event:checkout-step-3" }],
  });

  const left = createSolveInbox([low, high]);
  const right = createSolveInbox([high, low]);

  assert.deepEqual(left, right);
  assert.equal(left.schema, "solvelang.self-driving.inbox.v0");
  assert.equal(left.mode, "analyze-only");
  assert.equal(left.policy.requestedMode, "observe");
  assert.equal(left.policy.effectiveMode, "observe");
  assert.deepEqual(left.policy.allowedActions, ["inspect"]);
  assert.equal(left.policy.repositoryWriteAccess, false);
  assert.equal(left.policy.productionMutationAccess, false);
  assert.equal(left.policy.externalSideEffects, false);
  assert.equal(left.items[0].severity, "high");
  assert.match(left.items[0].id, /^scout_[a-f0-9]{16}$/);
});

test("Solve Inbox deduplicates structurally identical findings", () => {
  const duplicate = finding();
  const inbox = createSolveInbox([duplicate, duplicate]);

  assert.equal(inbox.execution.inputFindings, 2);
  assert.equal(inbox.execution.uniqueFindings, 1);
  assert.equal(inbox.execution.duplicateFindings, 1);
  assert.equal(inbox.execution.emittedFindings, 1);
  assert.equal(inbox.execution.status, "complete");
});

test("Solve Inbox applies a deterministic finding-count bound", () => {
  const inbox = createSolveInbox([
    finding({ severity: "info", title: "Third" }),
    finding({ severity: "critical", title: "First" }),
    finding({ severity: "high", title: "Second" }),
  ], { maxFindings: 2 });

  assert.equal(inbox.execution.status, "partial");
  assert.equal(inbox.execution.truncated, true);
  assert.deepEqual(inbox.execution.truncationReasons, ["finding-count"]);
  assert.equal(inbox.execution.uniqueFindings, 3);
  assert.equal(inbox.execution.emittedFindings, 2);
  assert.deepEqual(inbox.items.map((item) => item.title), ["First", "Second"]);
});

test("Solve Inbox requires provenance", () => {
  assert.throws(
    () => createSolveInbox([finding({ provenance: [] })]),
    /requires provenance/,
  );
});

test("observe-only mode rejects future write-capable actions", () => {
  for (const kind of ["propose-patch", "open-pr", "auto-merge", "change-rollout", "rollback"] as const) {
    assert.throws(
      () => createSolveInbox([finding({ recommendedAction: { kind, label: "Not yet enabled" } })]),
      /Observe-only Self-Driving does not permit/,
    );
  }
});

test("suggest, PR, and auto policy modes remain encoded but disabled", () => {
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => createSolveInbox([finding()], { requestedMode }),
      /current implementation is observe-only/,
    );
  }
});

test("experience and AI scouts can carry runtime, AI-trace, and MCP provenance without enabling side effects", () => {
  const inbox = createSolveInbox([
    finding({
      scout: "experience",
      title: "Conversion friction",
      provenance: [
        { kind: "runtime-event", locator: "event:checkout-abandonment" },
        { kind: "support", locator: "support:aggregate-checkout-theme" },
      ],
    }),
    finding({
      scout: "ai",
      severity: "high",
      title: "Repeated MCP tool failure",
      provenance: [
        { kind: "ai-trace", locator: "ai-trace:sanitized-42" },
        { kind: "mcp-tool-call", locator: "mcp:payments.lookup:sanitized-42" },
      ],
    }),
  ]);

  assert.equal(inbox.items.length, 2);
  assert.deepEqual(inbox.items.map((item) => item.scout), ["ai", "experience"]);
  assert.ok(inbox.items.every((item) => item.recommendedAction.kind === "inspect"));
  assert.equal(inbox.policy.externalSideEffects, false);
});

test("provenance order is normalized before identity is derived", () => {
  const first = finding({
    provenance: [
      { kind: "trace", locator: "trace:b" },
      { kind: "repository", locator: "src/a.ts" },
    ],
  });
  const second = finding({
    provenance: [
      { kind: "repository", locator: "src/a.ts" },
      { kind: "trace", locator: "trace:b" },
    ],
  });

  const inbox = createSolveInbox([first, second]);
  assert.equal(inbox.execution.uniqueFindings, 1);
  assert.equal(inbox.execution.duplicateFindings, 1);
});
