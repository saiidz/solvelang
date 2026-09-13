import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWorkspaceContextPack, planWorkspaceContext, retrieveWorkspaceContext } from "../src/context-workspace.js";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-"));
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
  await mkdir(path.join(root, "test"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "noise"), { recursive: true });
  await writeFile(path.join(root, "src", "invoice.ts"), "export function retryInvoice() {\n  return schedulePaymentRetry();\n}\n", "utf8");
  await writeFile(path.join(root, "test", "invoice.test.ts"), "test('payment retry', () => retryInvoice());\n", "utf8");
  await writeFile(path.join(root, "node_modules", "noise", "invoice.ts"), "payment retry secret noise\n", "utf8");
  await writeFile(path.join(root, ".env"), "API_TOKEN=do-not-read\n", "utf8");
}

test("automatic discovery is task-aware and skips vendor and secret paths", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const result = await buildWorkspaceContextPack("fix payment retry in invoice flow", { budgetBytes: 8_192 });
    assert.equal(result.workspace.mode, "discovery");
    assert.ok(result.pack.entries.some((entry) => entry.path === "src/invoice.ts"));
    assert.ok(result.pack.entries.some((entry) => entry.path === "test/invoice.test.ts"));
    assert.ok(result.pack.entries.every((entry) => !entry.path.includes("node_modules")));
    assert.ok(result.pack.entries.every((entry) => entry.path !== ".env"));
    assert.ok(result.workspace.skippedSensitive >= 1);
  });
});

test("plan returns provenance without source content", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const plan = await planWorkspaceContext("retry invoice", { paths: ["src/invoice.ts"], budgetBytes: 4_096 });
    assert.equal(plan.schema, "solvelang.context.plan.v0");
    assert.equal(plan.workspace.mode, "explicit");
    assert.equal(plan.pack.entries.length, 1);
    assert.equal("content" in plan.pack.entries[0]!, false);
  });
});

test("retrieval returns the exact excerpt and rejects stale source identity", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const result = await buildWorkspaceContextPack("retry invoice", { paths: ["src/invoice.ts"], budgetBytes: 4_096 });
    const entry = result.pack.entries[0]!;
    const retrieved = await retrieveWorkspaceContext(entry);
    assert.equal(retrieved.content, entry.content);
    assert.equal(retrieved.handle, entry.handle);

    await writeFile(path.join(root, "src", "invoice.ts"), `${entry.content}\n// changed\n`, "utf8");
    await assert.rejects(() => retrieveWorkspaceContext(entry), /source changed/);
  });
});

test("explicit sensitive context paths are denied", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    await assert.rejects(
      () => buildWorkspaceContextPack("token", { paths: [".env"], budgetBytes: 4_096 }),
      /sensitive path/,
    );
  });
});

test("explicit source order does not change the context pack identity", { concurrency: false }, async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const first = await buildWorkspaceContextPack("invoice retry", { paths: ["src/invoice.ts", "test/invoice.test.ts"], budgetBytes: 8_192 });
    const second = await buildWorkspaceContextPack("invoice retry", { paths: ["test/invoice.test.ts", "src/invoice.ts"], budgetBytes: 8_192 });
    assert.deepEqual(first, second);
  });
});
