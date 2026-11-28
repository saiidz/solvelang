import assert from "node:assert/strict";
import test from "node:test";

import { applyHeader, createLicenseHeadersExecutor } from "../src/license-headers.js";
import { createRegistry } from "../src/registry.js";
import { createRecipesRunner } from "../src/runner.js";

// QA pins for dispatch-mode wiring: the executor sends the SAME
// deterministic header-only changes as contentBase64 to MGOV, the
// returned bot author login is what the receipt finding states, a
// failed dispatch is graded honestly with NO fallback to the direct
// token path, and the server wiring selects the mode from the flag.

const HEADER = "// Copyright (c) 2026 SolveLang Recipes Proof\n// SPDX-License-Identifier: MIT";
const FILES = {
  "src/good.js": `${HEADER}\n\nexport const a = 1;\n`,
  "src/missing.js": `export const c = 3;\n`,
  "src/stale.js": `// Copyright (c) 1999 Someone Else\n\nexport const e = 5;\n`,
};
const DEF = createRegistry().get("license-headers");

function fakeSource() {
  const created = [];
  return {
    created,
    async listBlobPaths() {
      return Object.keys(FILES);
    },
    async getFileBytesAtRef(owner, repo, path) {
      const text = FILES[path];
      return text === undefined ? null : Buffer.from(text, "utf8");
    },
    async createFixPullRequest(owner, repo, args) {
      created.push(args);
      return { number: 7, url: "https://github.com/octo/widgets/pull/7", authorLogin: "saiidz", commitSha: "cafe" };
    },
  };
}

function stubDispatch(result) {
  const calls = [];
  const fn = async (request) => {
    calls.push(request);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = calls;
  return fn;
}

const SUCCESS = {
  ok: true,
  prNumber: 42,
  prUrl: "https://github.com/octo/widgets/pull/42",
  authorLogin: "solvelang-process-solution[bot]",
  headBranch: "solvelang-recipes/license-headers/run-abcd",
  plan: { batchId: "batch-1", status: "opened" },
};

test("dispatch success: contract request shape, base64 changes equal the direct-mode changes, bot login in the finding, direct path untouched", async () => {
  const source = fakeSource();
  const dispatchFix = stubDispatch(SUCCESS);
  const execute = createLicenseHeadersExecutor({ source, dispatchFix, fixViaMgov: true });
  const outcome = await execute({
    definition: DEF,
    repo: "octo/widgets",
    trigger: "manual",
    baseSha: "base-sha",
    runId: "run-abcdef123456",
    tenantId: "tenant-1",
    options: { header: HEADER, mode: "fix" },
  });
  assert.equal(outcome.conclusion, "success");
  assert.equal(source.created.length, 0); // direct path never used
  assert.equal(dispatchFix.calls.length, 1);
  const req = dispatchFix.calls[0];
  assert.equal(req.recipeId, "license-headers");
  assert.equal(req.runId, "run-abcdef123456");
  assert.equal(req.tenantId, "tenant-1");
  assert.equal(req.repo, "octo/widgets");
  assert.equal(req.baseBranch, "main");
  assert.equal(req.baseSha, "base-sha");
  assert.equal(req.branchName, "solvelang-recipes/license-headers/run-abcd");
  assert.equal(req.changes.length, 2);
  for (const change of req.changes) {
    const decoded = Buffer.from(change.contentBase64, "base64").toString("utf8");
    assert.equal(decoded, applyHeader(FILES[change.path], HEADER));
  }
  const fixFinding = outcome.findings[outcome.findings.length - 1];
  assert.equal(fixFinding.label, "verified");
  assert.equal(fixFinding.evidence, true);
  assert.match(fixFinding.text, /fix PR #42/);
  assert.match(fixFinding.text, /solvelang-process-solution\[bot\]/);
  assert.equal(outcome.fixPullRequest.authorLogin, "solvelang-process-solution[bot]");
  assert.deepEqual(outcome.fixPullRequest.plan, { batchId: "batch-1", status: "opened" });
});

test("dispatch failure: honest unverified finding with the error code, conclusion failure, NO fallback to direct mode", async () => {
  const source = fakeSource();
  const dispatchFix = stubDispatch({ ok: false, error: "tenant_repo_mismatch", status: 403 });
  const execute = createLicenseHeadersExecutor({ source, dispatchFix, fixViaMgov: true });
  const outcome = await execute({
    definition: DEF,
    repo: "octo/widgets",
    trigger: "manual",
    baseSha: "base-sha",
    runId: "run-abcdef123456",
    options: { header: HEADER, mode: "fix" },
  });
  assert.equal(outcome.conclusion, "failure");
  assert.equal(source.created.length, 0); // no PR under another identity
  assert.equal(outcome.fixPullRequest, undefined);
  const last = outcome.findings[outcome.findings.length - 1];
  assert.equal(last.label, "unverified");
  assert.match(last.text, /tenant_repo_mismatch/);
  assert.match(last.text, /no fallback identity was used/);
});

test("dispatch mode without a dispatch client, and a throwing client, both fail honestly without fallback", async () => {
  const sourceA = fakeSource();
  const noClient = createLicenseHeadersExecutor({ source: sourceA, dispatchFix: null, fixViaMgov: true });
  const a = await noClient({
    definition: DEF, repo: "octo/widgets", trigger: "manual", baseSha: "b",
    runId: "run-abcdef123456", options: { header: HEADER, mode: "fix" },
  });
  assert.equal(a.conclusion, "failure");
  assert.match(a.findings[a.findings.length - 1].text, /fix_dispatch_unconfigured/);
  assert.equal(sourceA.created.length, 0);

  const sourceB = fakeSource();
  const throwing = createLicenseHeadersExecutor({
    source: sourceB,
    dispatchFix: stubDispatch(new Error("boom")),
    fixViaMgov: true,
  });
  const b = await throwing({
    definition: DEF, repo: "octo/widgets", trigger: "manual", baseSha: "b",
    runId: "run-abcdef123456", options: { header: HEADER, mode: "fix" },
  });
  assert.equal(b.conclusion, "failure");
  assert.match(b.findings[b.findings.length - 1].text, /fix_dispatch_request_failed/);
  assert.equal(sourceB.created.length, 0);
});

test("dispatch mode on a compliant repo dispatches nothing (idempotent)", async () => {
  const source = {
    listBlobPaths: async () => ["src/good.js"],
    getFileBytesAtRef: async () => Buffer.from(FILES["src/good.js"], "utf8"),
    createFixPullRequest: async () => { throw new Error("must_not_be_called"); },
  };
  const dispatchFix = stubDispatch(SUCCESS);
  const execute = createLicenseHeadersExecutor({ source, dispatchFix, fixViaMgov: true });
  const outcome = await execute({
    definition: DEF, repo: "octo/widgets", trigger: "manual", baseSha: "b",
    runId: "run-abcdef123456", options: { header: HEADER, mode: "fix" },
  });
  assert.equal(outcome.conclusion, "success");
  assert.equal(dispatchFix.calls.length, 0);
});

test("runner passes its run record id through, so the dispatch branch is derived from the run id", async () => {
  const source = fakeSource();
  const dispatchFix = stubDispatch(SUCCESS);
  const runner = createRecipesRunner({
    registry: createRegistry(),
    readConfigTextAtRef: async () =>
      JSON.stringify({
        version: 1,
        recipes: { "license-headers": { enabled: true, options: { header: HEADER, mode: "fix" } } },
      }),
    executeRecipe: createLicenseHeadersExecutor({ source, dispatchFix, fixViaMgov: true }),
    postAudit: async () => ({ ok: true }),
    createId: () => "recordid-1234567890",
  });
  const { record, receipt } = await runner.runRecipe({
    repo: "octo/widgets", recipeId: "license-headers", trigger: "manual", baseSha: "base",
  });
  assert.equal(record.id, "recordid-1234567890");
  assert.equal(dispatchFix.calls[0].runId, "recordid-1234567890");
  assert.equal(dispatchFix.calls[0].branchName, "solvelang-recipes/license-headers/recordid");
  assert.equal(receipt.conclusion, "success");
  assert.equal(receipt.falseVerifiedLabel, false);
});

test("server wiring: fixViaMgov override routes the executor through the injected dispatch client", async () => {
  process.env.RECIPES_NO_LISTEN = "1";
  const { createRecipesService } = await import("../src/server.js");
  const source = fakeSource();
  const dispatchFix = stubDispatch(SUCCESS);
  const { runner } = createRecipesService({
    githubSource: source,
    dispatchFix,
    fixViaMgov: true,
    adminToken: "test-admin",
    readConfigTextAtRef: async () =>
      JSON.stringify({
        version: 1,
        recipes: { "license-headers": { enabled: true, options: { header: HEADER, mode: "fix" } } },
      }),
    postAudit: async () => ({ ok: true }),
  });
  const { receipt } = await runner.runRecipe({
    repo: "octo/widgets", recipeId: "license-headers", trigger: "manual", baseSha: "base",
  });
  assert.equal(dispatchFix.calls.length, 1);
  assert.equal(source.created.length, 0);
  assert.equal(receipt.conclusion, "success");
  assert.match(receipt.findings[receipt.findings.length - 1].text, /solvelang-process-solution\[bot\]/);
});
