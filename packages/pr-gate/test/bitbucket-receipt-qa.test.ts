// SolveLang PR Gate — QA pins for the Bitbucket Cloud packaging.
//
// These pins lock the cross-file contract the feature depends on:
//   - the collector's emitted JSON keeps the exact field contract of
//     ChangeImpactReceiptInput in
//     site/app/change-impact-receipt/core/receipt.ts (the shape the
//     live /change-impact-receipt/ page consumes), and the site's own
//     builder consumes the collector's output unmodified;
//   - the Bitbucket Pipelines template carries Bitbucket's required
//     mechanics (pull-request pipelines, REST 2.0 facts read from the
//     PR object + diffstat, comments API sticky comment, keyed build
//     status on the head commit with refname, verdict-keyed status
//     mapping, the no-result guard, the pinned kit SHA, governed
//     exit code) and does NOT carry the other platforms' assumptions
//     (no labels, no ambient token, no error status state);
//   - the blocking caveat is stated where the template is
//     documented: the status feeds the built-in successful-builds
//     merge check, unresolved checks only warn below Premium, and
//     blocking requires Premium + "Prevent a merge with unresolved
//     merge checks"; Cloud has no per-key required-builds gate;
//   - package.json wires the collector bin to the built file;
//   - the README documents the collector and the template.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import { collectBitbucketReceiptInput, type BitbucketReceiptInput } from "../src/bitbucket-receipt";

// The compiled test lives at packages/pr-gate/dist/packages/pr-gate/test,
// so four levels up is the package directory and six is the repo root.
const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

function readPkgFile(name: string): string {
  return readFileSync(path.join(pkgDir, name), "utf8");
}

test("the Bitbucket Pipelines template carries Bitbucket's required mechanics", () => {
  const template = readPkgFile("workflow-template.bitbucket-pipelines.yml");
  for (const needle of [
    "bitbucket-pipelines.yml",
    "pull-requests:",
    "BITBUCKET_PR_ID",
    "BITBUCKET_CLONE_DIR",
    "api.bitbucket.org/2.0",
    "/pullrequests/",
    "/diffstat",
    "/comments",
    "/statuses/build",
    "key: 'solvelang-pr-gate'",
    "refname",
    "<!-- pr-gate:report -->",
    "<PINNED_SHA>",
    "report-only",
    "Prevent a merge with unresolved merge checks",
  ]) {
    assert.ok(template.includes(needle), `bitbucket template is missing: ${needle}`);
  }
  // The template must not carry the other platforms' mechanics.
  // (The header names CI_JOB_TOKEN, System.AccessToken, and
  // --labels only to state that Bitbucket has none of them — the
  // divergence is documented, never used.)
  for (const foreign of ["CI_API_V4_URL", "CI_MERGE_REQUEST_IID", "PRIVATE-TOKEN", "/merge_requests/", "merge_request_event", "actions/github-script", "GITHUB_OUTPUT", "api-version=7.1", "genre: 'solvelang'"]) {
    assert.ok(!template.includes(foreign), `bitbucket template must not rely on: ${foreign}`);
  }
  // The gate invocation passes no --labels argument (the facts and
  // run blocks mention the word only to document its absence).
  assert.ok(!template.includes('ARGS+=(--labels'), "the gate must not be invoked with --labels");
  assert.ok(!template.includes('ARGS=(--root "$BITBUCKET_CLONE_DIR" --changed "$CHANGED" --labels'), "the gate must not be invoked with --labels");
});

test("the Bitbucket Pipelines template invokes the built CLI at its real path, with the no-result guard", () => {
  const template = readPkgFile("workflow-template.bitbucket-pipelines.yml");
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

test("the Bitbucket Pipelines template maps the build status on the recorded verdict, not the exit code", () => {
  const template = readPkgFile("workflow-template.bitbucket-pipelines.yml");
  assert.ok(template.includes("readFileSync('.pr-gate-out/result.json', 'utf8')"), "verdict script must read result.json");
  assert.ok(template.includes('[ "$GATE_VERDICT" = "fail" ]'), "status mapping must key on the verdict");
  assert.ok(!template.includes('elif [ "$GATE_CODE" = "1" ]'), "status mapping must not key policy failure on the exit code");
  assert.ok(template.includes("advisory only (report-only mode)"), "report-only failures must be labeled advisory in the status");
  assert.ok(template.includes('STATE="FAILED"'), "operational failures must post Bitbucket's FAILED status state");
  assert.ok(template.includes("failed operationally"), "operational failures must be described as operational");
});

test("the blocking caveat is stated in the template header and the README", () => {
  for (const source of [readPkgFile("workflow-template.bitbucket-pipelines.yml"), readPkgFile("README.md")]) {
    assert.ok(source.includes("Minimum number of successful builds"), "the caveat must name the built-in builds merge check");
    assert.ok(source.includes("Prevent a merge with unresolved merge checks"), "the caveat must name the Premium blocking setting");
    assert.ok(source.includes("Premium"), "the caveat must name the Premium plan requirement");
    assert.ok(source.includes("blocking nothing") || source.includes("nothing blocks"), "the caveat must state the status alone blocks nothing");
    assert.ok(source.includes("Data Center"), "the caveat must separate Cloud from Data Center's per-key required builds");
  }
  const readme = readPkgFile("README.md");
  assert.ok(
    readme.includes("https://support.atlassian.com/bitbucket-cloud/docs/suggest-or-require-checks-before-a-merge/"),
    "README must cite the merge checks doc",
  );
});

test("package.json wires the collector bin to the built file", () => {
  const pkg = JSON.parse(readPkgFile("package.json")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["solvelang-bitbucket-receipt"], "dist/packages/pr-gate/src/bitbucket-receipt.js");
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "bitbucket-receipt.js")),
    "the built collector must exist at the bin path (tests run after the build)",
  );
});

test("README documents the Bitbucket collector and template with doc citations", () => {
  const readme = readPkgFile("README.md");
  for (const needle of [
    "solvelang-bitbucket-receipt",
    "workflow-template.bitbucket-pipelines.yml",
    "https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/",
    "https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/",
    "https://support.atlassian.com/bitbucket-cloud/docs/suggest-or-require-checks-before-a-merge/",
    "BITBUCKET_TOKEN",
    "lines_added",
    "changes_requested",
    "405",
    "no combined-tree preview",
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

async function collectQaInput(): Promise<BitbucketReceiptInput> {
  const payloads = (rest: string, url: URL): unknown => {
    if (rest === "pullrequests/9") {
      return {
        type: "pullrequest",
        id: 9,
        title: "pin",
        state: "DECLINED",
        draft: true,
        comment_count: 0,
        task_count: 0,
        created_on: "2026-11-24T00:00:00.000000+00:00",
        updated_on: "2026-11-24T01:00:00.000000+00:00",
        author: { display_name: "O", nickname: "o", account_id: "acc-o", type: "user" },
        source: { branch: { name: "feat" }, commit: { hash: "111111111111" }, repository: { full_name: "ws/repo" } },
        destination: { branch: { name: "main" }, commit: { hash: "222222222222" }, repository: { full_name: "ws/repo" } },
        links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/9" } },
        reviewers: [],
        participants: [
          { role: "REVIEWER", approved: true, state: "approved", user: { display_name: "Rev", nickname: "rev", account_id: "acc-rev", type: "user" } },
        ],
      };
    }
    if (rest === "pullrequests/9/diffstat") {
      return { values: [{ type: "diffstat", status: "added", lines_added: 7, lines_removed: 0, old: null, new: { path: "a.ts" } }], pagelen: 100 };
    }
    if (rest === "pullrequests/9/commits") {
      return { values: [{ hash: QA_HEAD_SHA, type: "commit" }], pagelen: 100 };
    }
    if (rest === "pullrequests/9/statuses") {
      return { values: [{ key: "solvelang-pr-gate", type: "build", state: "SUCCESSFUL", name: "SolveLang PR Gate", url: "https://ci.example/9" }], pagelen: 100 };
    }
    if (rest === "refs/branches/main") return { name: "main", type: "branch", target: { hash: QA_BASE_SHA, type: "commit" } };
    if (rest === "commits") {
      const include = url.searchParams.get("include");
      const exclude = url.searchParams.get("exclude");
      if (include === QA_HEAD_SHA && exclude === QA_BASE_SHA) return { values: [{ hash: QA_HEAD_SHA }], pagelen: 100 };
      if (include === QA_BASE_SHA && exclude === QA_HEAD_SHA) return { values: [], pagelen: 100 };
      return undefined;
    }
    return undefined;
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://bitbucket.test");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    // parts: [2.0, repositories, ws, repo, ...rest]
    const rest = parts.slice(4).join("/");
    const body = payloads(rest, url);
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { type: "error", error: { message: "unhandled" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("stub server has no port");
    return await collectBitbucketReceiptInput({
      baseUrl: `http://127.0.0.1:${address.port}/2.0`,
      workspace: "ws",
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
  // A declined PR is closed; Bitbucket mergeability is never claimed.
  assert.equal(input.pr.state, "closed");
  assert.equal(input.pr.mergeable, null);
  assert.equal(input.pr.mergeableState, "unknown");
  assert.equal(input.pr.draft, true);
  assert.equal(input.pr.headSha, QA_HEAD_SHA);
  assert.equal(input.pr.baseSha, QA_BASE_SHA);
  assert.equal(input.pr.additions, 7);
  assert.deepEqual(input.compare, { status: "ahead", aheadBy: 1, behindBy: 0 });
  assert.deepEqual(input.reviews, [{ author: "Rev", state: "APPROVED" }]);
  assert.deepEqual(input.checkRuns, [{ name: "SolveLang PR Gate", status: "completed", conclusion: "success" }]);
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
