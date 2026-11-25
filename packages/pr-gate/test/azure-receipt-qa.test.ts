// SolveLang PR Gate — QA pins for the Azure DevOps packaging.
//
// These pins lock the cross-file contract the feature depends on:
//   - the collector's emitted JSON keeps the exact field contract of
//     ChangeImpactReceiptInput in
//     site/app/change-impact-receipt/core/receipt.ts (the shape the
//     live /change-impact-receipt/ page consumes), and the site's own
//     builder consumes the collector's output unmodified;
//   - the Azure Pipelines template carries Azure's required
//     mechanics (PR trigger, REST 7.1 facts read from the PR's
//     iterations, threads API sticky comment, PR status signal with
//     genre "solvelang" / name "pr-gate", verdict-keyed status
//     mapping, the no-result guard, the pinned kit SHA, governed
//     exit code) and does NOT carry the other platforms' assumptions;
//   - the policy caveat is stated where the template is documented:
//     a posted status blocks only when a "Status checks" branch
//     policy requires that exact genre/name as Required; build
//     validation is the any-project enforcement route; without a
//     policy the status is signal only;
//   - package.json wires the collector bin to the built file;
//   - the README documents the collector and the template.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import { collectAzureReceiptInput, type AzureReceiptInput } from "../src/azure-receipt";

// The compiled test lives at packages/pr-gate/dist/packages/pr-gate/test,
// so four levels up is the package directory and six is the repo root.
const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

function readPkgFile(name: string): string {
  return readFileSync(path.join(pkgDir, name), "utf8");
}

test("the Azure Pipelines template carries Azure's required mechanics", () => {
  const template = readPkgFile("workflow-template.azure-pipelines.yml");
  for (const needle of [
    "azure-pipelines.yml",
    "trigger: none",
    "System.PullRequest.PullRequestId",
    "System.AccessToken",
    "_apis/git",
    "/pullRequests/",
    "/iterations",
    "/changes",
    "/threads",
    "/statuses",
    "api-version=7.1",
    "genre: 'solvelang'",
    "name: 'pr-gate'",
    "<!-- pr-gate:report -->",
    "<PINNED_SHA>",
    "report-only",
    "condition: always()",
  ]) {
    assert.ok(template.includes(needle), `azure template is missing: ${needle}`);
  }
  // The template must not carry the other platforms' assumptions.
  for (const foreign of ["CI_API_V4_URL", "CI_MERGE_REQUEST_IID", "PRIVATE-TOKEN", "/merge_requests/", "merge_request_event", "actions/github-script", "GITHUB_OUTPUT", "pull_request:"]) {
    assert.ok(!template.includes(foreign), `azure template must not rely on: ${foreign}`);
  }
});

test("the Azure Pipelines template invokes the built CLI at its real path, with the no-result guard", () => {
  const template = readPkgFile("workflow-template.azure-pipelines.yml");
  const CORRECT_CLI = 'node "$PR_GATE_KIT_DIR/packages/pr-gate/dist/packages/pr-gate/src/cli.js"';
  const WRONG_CLI = 'node "$PR_GATE_KIT_DIR/dist/packages/pr-gate/src/cli.js"';
  assert.ok(template.includes(CORRECT_CLI), "template must invoke the CLI under packages/pr-gate/dist");
  assert.ok(!template.includes(WRONG_CLI), "template must not invoke the one-segment-short CLI path");
  assert.ok(template.includes("if [ ! -f .pr-gate-out/result.json ]"), "template must treat a missing result.json as an operational error");
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "cli.js")),
    "packages/pr-gate/dist/packages/pr-gate/src/cli.js must exist after the build",
  );
});

test("the Azure Pipelines template maps the PR status on the recorded verdict, not the exit code", () => {
  const template = readPkgFile("workflow-template.azure-pipelines.yml");
  assert.ok(template.includes("readFileSync('.pr-gate-out/result.json', 'utf8')"), "verdict script must read result.json");
  assert.ok(template.includes('[ "$GATE_VERDICT" = "fail" ]'), "status mapping must key on the verdict");
  assert.ok(!template.includes('elif [ "$GATE_CODE" = "1" ]'), "status mapping must not key policy failure on the exit code");
  assert.ok(template.includes("advisory only (report-only mode)"), "report-only failures must be labeled advisory in the status");
  assert.ok(template.includes('STATE="error"'), "operational failures must post Azure's error status state");
});

test("the policy caveat is stated in the template header and the README", () => {
  for (const source of [readPkgFile("workflow-template.azure-pipelines.yml"), readPkgFile("README.md")]) {
    assert.ok(source.includes("Status checks"), "the caveat must name the Status checks branch policy");
    assert.ok(source.includes("solvelang/pr-gate"), "the caveat must name the exact genre/name the policy requires");
    assert.ok(/genre\/name/.test(source), "the caveat must state the genre/name identity");
    assert.ok(source.includes("Build validation"), "the caveat must name the build validation enforcement route");
    assert.ok(source.includes("blocking nothing"), "the caveat must state the status alone blocks nothing");
  }
  const readme = readPkgFile("README.md");
  assert.ok(
    readme.includes("https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies"),
    "README must cite the branch policies doc",
  );
});

test("package.json wires the collector bin to the built file", () => {
  const pkg = JSON.parse(readPkgFile("package.json")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["solvelang-azure-receipt"], "dist/packages/pr-gate/src/azure-receipt.js");
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "azure-receipt.js")),
    "the built collector must exist at the bin path (tests run after the build)",
  );
});

test("README documents the Azure collector and template with doc citations", () => {
  const readme = readPkgFile("README.md");
  for (const needle of [
    "solvelang-azure-receipt",
    "workflow-template.azure-pipelines.yml",
    "https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1",
    "https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1",
    "https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations/list?view=azure-devops-rest-7.1",
    "https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-statuses/list?view=azure-devops-rest-7.1",
    "https://learn.microsoft.com/en-us/rest/api/azure/devops/git/diffs/get?view=azure-devops-rest-7.1",
    "https://learn.microsoft.com/en-us/azure/devops/repos/git/create-pr-status-server",
    "AZURE_DEVOPS_PAT",
    "commonRefCommit",
    "waiting for author",
  ]) {
    assert.ok(readme.includes(needle), `README is missing: ${needle}`);
  }
});

const EXPECTED_INPUT_KEYS = ["checkRuns", "compare", "files", "pr", "prGate", "readAt", "reviews", "source"];
const EXPECTED_PR_KEYS = [
  "additions", "author", "baseRef", "baseSha", "changedFiles", "commits", "createdAt", "deletions",
  "draft", "headRef", "headSha", "mergeable", "mergeableState", "number", "owner", "repo", "state",
  "title", "updatedAt", "url",
];

const QA_HEAD_SHA = "1111111111111111111111111111111111111111";
const QA_BASE_SHA = "2222222222222222222222222222222222222222";
const QA_COMMON_SHA = "3333333333333333333333333333333333333333";

async function collectQaInput(): Promise<AzureReceiptInput> {
  const payloads = (rest: string): unknown => {
    if (rest === "pullRequests/9") {
      return {
        pullRequestId: 9,
        title: "pin",
        status: "active",
        mergeStatus: "conflicts",
        isDraft: true,
        createdBy: { displayName: "O", uniqueName: "o@example.com" },
        creationDate: "2026-11-24T00:00:00Z",
        sourceRefName: "refs/heads/feat",
        targetRefName: "refs/heads/main",
        lastMergeSourceCommit: { commitId: QA_HEAD_SHA },
        repository: { id: "r", name: "repo", project: { id: "p", name: "proj" } },
        reviewers: [{ displayName: "Rev", uniqueName: "rev@example.com", vote: 10, isContainer: false }],
      };
    }
    if (rest === "pullRequests/9/iterations") {
      return {
        count: 1,
        value: [
          {
            id: 1,
            createdDate: "2026-11-24T00:00:00Z",
            updatedDate: "2026-11-24T01:00:00Z",
            sourceRefCommit: { commitId: QA_HEAD_SHA },
            targetRefCommit: { commitId: QA_BASE_SHA },
            commonRefCommit: { commitId: QA_COMMON_SHA },
          },
        ],
      };
    }
    if (rest === "pullRequests/9/iterations/1/changes") {
      return { changeEntries: [{ changeTrackingId: 1, changeId: 1, item: { path: "/a.ts", gitObjectType: "blob" }, changeType: "edit" }], nextSkip: 0, nextTop: 0 };
    }
    if (rest === "pullRequests/9/commits") return { count: 1, value: [{ commitId: "c1" }] };
    if (rest === "pullRequests/9/statuses") {
      return { count: 1, value: [{ id: 1, state: "succeeded", description: "ok", context: { name: "pr-gate", genre: "solvelang" }, iterationId: 1 }] };
    }
    if (rest === "refs") return { count: 1, value: [{ name: "refs/heads/main", objectId: QA_BASE_SHA }] };
    if (rest === "diffs/commits") return { aheadCount: 1, behindCount: 0, commonCommit: QA_COMMON_SHA, allChangesIncluded: true, changeCounts: {}, changes: [] };
    return undefined;
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://azure.test");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    // parts: [org, project, _apis, git, repositories, repo, ...rest]
    const rest = parts.slice(6).join("/");
    const body = payloads(rest);
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { message: "unhandled" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("stub server has no port");
    return await collectAzureReceiptInput({
      orgUrl: `http://127.0.0.1:${address.port}/org`,
      project: "proj",
      repository: "repo",
      pr: 9,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("collector output keeps the ChangeImpactReceiptInput field contract", async () => {
  const input = await collectQaInput();
  assert.deepEqual(Object.keys(input).sort(), EXPECTED_INPUT_KEYS);
  assert.deepEqual(Object.keys(input.pr).sort(), EXPECTED_PR_KEYS);
  assert.equal(input.pr.mergeable, false);
  assert.equal(input.pr.mergeableState, "dirty");
  assert.equal(input.pr.draft, true);
  assert.equal(input.pr.updatedAt, "2026-11-24T01:00:00Z");
  assert.deepEqual(input.compare, { status: "ahead", aheadBy: 1, behindBy: 0 });
  assert.deepEqual(input.reviews, [{ author: "rev@example.com", state: "APPROVED" }]);
  assert.deepEqual(input.checkRuns, [{ name: "solvelang/pr-gate", status: "completed", conclusion: "success" }]);
  for (const file of input.files) {
    assert.deepEqual(Object.keys(file).sort(), ["additions", "deletions", "filename", "status"]);
  }
  for (const run of input.checkRuns) {
    assert.deepEqual(Object.keys(run).sort(), ["conclusion", "name", "status"]);
  }
});

test("the site's own receipt builder consumes the collector output unmodified", async () => {
  const input = await collectQaInput();
  const coreSource = readFileSync(path.join(repoRoot, "site", "app", "change-impact-receipt", "core", "receipt.ts"), "utf8");
  const { outputText } = ts.transpileModule(coreSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "receipt.ts",
  });
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", outputText)(mod, mod.exports);
  const buildChangeImpactReceipt = mod.exports.buildChangeImpactReceipt as (value: unknown) => {
    schema: string;
    findings: unknown[];
    grading: { verified: number; failed: number; unverified: number; falseVerifiedLabel: boolean };
  };
  const renderChangeImpactReceiptMarkdown = mod.exports.renderChangeImpactReceiptMarkdown as (receipt: unknown) => string;
  assert.equal(typeof buildChangeImpactReceipt, "function", "the site core must export the builder");
  const receipt = buildChangeImpactReceipt(input);
  assert.equal(receipt.schema, "solvelang.change-impact-receipt.v1");
  assert.equal(receipt.grading.falseVerifiedLabel, false);
  assert.equal(
    receipt.grading.verified + receipt.grading.failed + receipt.grading.unverified,
    receipt.findings.length,
    "grading counts must cover every finding",
  );
  assert.ok(renderChangeImpactReceiptMarkdown(receipt).includes("Change Impact Receipt"));
});

test("the receipt core still declares the contract the collector mirrors", () => {
  const receiptCore = readFileSync(path.join(repoRoot, "site", "app", "change-impact-receipt", "core", "receipt.ts"), "utf8");
  assert.ok(receiptCore.includes("ChangeImpactReceiptInput"), "receipt core must keep the input type");
  for (const field of EXPECTED_PR_KEYS) {
    assert.ok(receiptCore.includes(`${field}:`), `receipt core no longer declares pr.${field}`);
  }
  assert.ok(receiptCore.includes('schema: "solvelang.change-impact-receipt.v1"'));
});
