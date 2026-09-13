import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createContextHandoff, validateContextHandoff, type ContextHandoff } from "../src/context-handoff.js";
import { buildWorkspaceContextPack } from "../src/context-workspace.js";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-handoff-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function seedWorkspace(root: string): Promise<void> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "change-a.ts"), "export const changedA = true;\n", "utf8");
  await writeFile(path.join(root, "src", "change-b.ts"), "export const changedB = true;\n", "utf8");
  await writeFile(path.join(root, "src", "context.ts"), "export function paymentRetryContext() { return 'exact-context-source'; }\n", "utf8");
  await writeFile(path.join(root, ".env"), "SECRET=do-not-read\n", "utf8");
}

async function contextEntry() {
  const result = await buildWorkspaceContextPack("payment retry context", {
    paths: ["src/context.ts"],
    budgetBytes: 4_096,
  });
  return result.pack.entries[0]!;
}

async function createFixtureHandoff(): Promise<ContextHandoff> {
  const entry = await contextEntry();
  return createContextHandoff({
    fromAgent: "claude",
    toAgent: "codex",
    goal: "Finish the payment retry fix without rereading the full repository.",
    decisions: ["Keep retry state local to the invoice module."],
    unresolvedQuestions: ["Should the integration test cover the timeout path?"],
    changedPaths: ["src/change-b.ts", "src/change-a.ts"],
    tests: [{ label: "invoice unit tests", status: "passed", evidence: "12/12 passed" }],
    context: [entry],
  });
}

test("creates a deterministic content-addressed Claude to Codex handoff without source bodies", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const first = await createFixtureHandoff();
    const entry = await contextEntry();
    const second = await createContextHandoff({
      fromAgent: "claude",
      toAgent: "codex",
      goal: "Finish the payment retry fix without rereading the full repository.",
      decisions: ["Keep retry state local to the invoice module."],
      unresolvedQuestions: ["Should the integration test cover the timeout path?"],
      changedPaths: ["src/change-a.ts", "src/change-b.ts", "src/change-a.ts"],
      tests: [{ label: "invoice unit tests", status: "passed", evidence: "12/12 passed" }],
      context: [entry],
    });

    assert.deepEqual(first, second);
    assert.match(first.handoffId, /^sch_[a-f0-9]{32}$/);
    assert.deepEqual(first.changedSources.map((source) => source.path), ["src/change-a.ts", "src/change-b.ts"]);
    assert.equal(JSON.stringify(first).includes("exact-context-source"), false, "handoff must carry provenance, not source bodies");
  });
});

test("validates a fresh handoff and detects note tampering separately from source freshness", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const handoff = await createFixtureHandoff();
    const fresh = await validateContextHandoff(handoff);
    assert.equal(fresh.valid, true);
    assert.equal(fresh.integrityValid, true);
    assert.equal(fresh.contentFresh, true);

    const tampered = structuredClone(handoff);
    tampered.decisions[0] = "A different decision";
    const validation = await validateContextHandoff(tampered);
    assert.equal(validation.integrityValid, false);
    assert.equal(validation.contentFresh, true);
    assert.equal(validation.valid, false);
  });
});

test("detects changed source identities without exposing changed file content", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const handoff = await createFixtureHandoff();
    await writeFile(path.join(root, "src", "change-a.ts"), "export const changedA = false;\n", "utf8");
    const validation = await validateContextHandoff(handoff);
    assert.equal(validation.contentFresh, false);
    assert.deepEqual(validation.staleChangedSources, [{ path: "src/change-a.ts", reason: "source identity changed" }]);
    assert.deepEqual(validation.staleContextReferences, []);
    assert.equal(JSON.stringify(validation).includes("changedA = false"), false);
  });
});

test("detects stale exact context references independently", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const handoff = await createFixtureHandoff();
    await writeFile(path.join(root, "src", "context.ts"), "export function paymentRetryContext() { return 'changed'; }\n", "utf8");
    const validation = await validateContextHandoff(handoff);
    assert.equal(validation.contentFresh, false);
    assert.deepEqual(validation.staleChangedSources, []);
    assert.equal(validation.staleContextReferences.length, 1);
    assert.equal(validation.staleContextReferences[0]?.path, "src/context.ts");
  });
});

test("denies sensitive changed paths and sensitive context references", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    await assert.rejects(
      () => createContextHandoff({ fromAgent: "claude", goal: "handoff", changedPaths: [".env"] }),
      /sensitive path/,
    );
  });
});
