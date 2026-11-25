// SolveLang PR Gate — QA pins for the GitLab packaging.
//
// These pins lock the cross-file contract the feature depends on:
//   - the collector's emitted JSON keeps the exact field contract of
//     ChangeImpactReceiptInput in
//     site/app/change-impact-receipt/core/receipt.ts (the shape the
//     live /change-impact-receipt/ page consumes), and the site's own
//     builder consumes the collector's output unmodified;
//   - the GitLab CI template carries GitLab's required mechanics
//     (MR pipelines, API v4 facts read, notes API sticky comment,
//     commit-status signal, verdict-keyed status mapping, the
//     no-result guard, the pinned kit SHA) and does NOT carry the
//     other platforms' assumptions;
//   - the tier caveat is stated where the template is documented:
//     commit statuses are an all-tier signal, external status checks
//     are Ultimate-only, enforcement is enforce mode + the project's
//     Pipelines-must-succeed setting;
//   - package.json wires the collector bin to the built file;
//   - the README documents the collector and the template.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import { collectGitLabReceiptInput, type GitLabReceiptInput } from "../src/gitlab-receipt";

// The compiled test lives at packages/pr-gate/dist/packages/pr-gate/test,
// so four levels up is the package directory and six is the repo root.
const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

function readPkgFile(name: string): string {
  return readFileSync(path.join(pkgDir, name), "utf8");
}

test("the GitLab CI template carries GitLab's required mechanics", () => {
  const template = readPkgFile("workflow-template.gitlab-ci.yml");
  for (const needle of [
    ".gitlab-ci.yml",
    "merge_request_event",
    "CI_API_V4_URL",
    "CI_MERGE_REQUEST_IID",
    "PR_GATE_TOKEN",
    "CI_JOB_TOKEN",
    "PRIVATE-TOKEN",
    "/merge_requests/",
    "/diffs",
    "/notes",
    "/statuses/",
    "<!-- pr-gate:report -->",
    "<PINNED_SHA>",
    "report-only",
  ]) {
    assert.ok(template.includes(needle), `gitlab template is missing: ${needle}`);
  }
  // The template must not carry the other platforms' assumptions.
  for (const foreign of ["actions/checkout", "actions/github-script", "GITHUB_OUTPUT", "GITEA_TOKEN", "FORGEJO_TOKEN", "FORGEJO_API_URL", "pull_request:"]) {
    assert.ok(!template.includes(foreign), `gitlab template must not rely on: ${foreign}`);
  }
});

test("the GitLab CI template invokes the built CLI at its real path, with the no-result guard", () => {
  const template = readPkgFile("workflow-template.gitlab-ci.yml");
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

test("the GitLab CI template maps the commit status on the recorded verdict, not the exit code", () => {
  const template = readPkgFile("workflow-template.gitlab-ci.yml");
  assert.ok(template.includes("readFileSync('.pr-gate-out/result.json', 'utf8')"), "verdict script must read result.json");
  assert.ok(template.includes('[ "$GATE_VERDICT" = "fail" ]'), "status mapping must key on the verdict");
  assert.ok(!template.includes('elif [ "$GATE_CODE" = "1" ]'), "status mapping must not key policy failure on the exit code");
  assert.ok(template.includes("advisory only (report-only mode)"), "report-only failures must be labeled advisory in the status");
});

test("the tier caveat is stated in the template header and the README", () => {
  for (const source of [readPkgFile("workflow-template.gitlab-ci.yml"), readPkgFile("README.md")]) {
    assert.ok(source.includes("Ultimate"), "the caveat must name the Ultimate tier");
    assert.ok(/external status checks/i.test(source), "the caveat must name external status checks");
    assert.ok(source.includes("Pipelines"), "the caveat must name the pipeline enforcement route");
    assert.ok(/must succeed/i.test(source), "the caveat must name the Pipelines-must-succeed setting");
  }
  const readme = readPkgFile("README.md");
  assert.ok(readme.includes("https://docs.gitlab.com/api/status_checks/"), "README must cite the external status checks API doc");
});

test("package.json wires the collector bin to the built file", () => {
  const pkg = JSON.parse(readPkgFile("package.json")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["solvelang-gitlab-receipt"], "dist/packages/pr-gate/src/gitlab-receipt.js");
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "gitlab-receipt.js")),
    "the built collector must exist at the bin path (tests run after the build)",
  );
});

test("README documents the GitLab collector and template with doc citations", () => {
  const readme = readPkgFile("README.md");
  for (const needle of [
    "solvelang-gitlab-receipt",
    "workflow-template.gitlab-ci.yml",
    "https://docs.gitlab.com/api/merge_requests/",
    "https://docs.gitlab.com/api/merge_request_approvals/",
    "https://docs.gitlab.com/api/status_checks/",
    "https://docs.gitlab.com/api/notes/",
    "https://docs.gitlab.com/api/commits/",
    "GITLAB_TOKEN",
    "approved_by",
    "detailed_merge_status",
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

async function collectQaInput(): Promise<GitLabReceiptInput> {
  const payloads = (rest: string, url: URL): unknown => {
    if (rest === "group/repo/merge_requests/9") {
      return {
        iid: 9,
        title: "pin",
        web_url: "http://gitlab.test/group/repo/-/merge_requests/9",
        state: "opened",
        draft: true,
        author: { username: "o" },
        created_at: "2026-11-24T00:00:00Z",
        updated_at: "2026-11-24T01:00:00Z",
        sha: QA_HEAD_SHA,
        source_branch: "feat",
        target_branch: "main",
        diff_refs: { base_sha: QA_BASE_SHA, head_sha: QA_HEAD_SHA, start_sha: QA_BASE_SHA },
        changes_count: "1",
        merge_status: "cannot_be_merged",
        detailed_merge_status: "conflict",
        has_conflicts: true,
        head_pipeline: { id: 7, project_id: 42, status: "failed", sha: QA_HEAD_SHA },
      };
    }
    if (rest === "group/repo/merge_requests/9/diffs") {
      return [{ old_path: "a.ts", new_path: "a.ts", new_file: false, renamed_file: false, deleted_file: false, collapsed: false, too_large: false, diff: "@@ -1,1 +1,1 @@\n-old\n+new\n" }];
    }
    if (rest === "group/repo/merge_requests/9/commits") return [{ id: "c1" }];
    if (rest === "group/repo/merge_requests/9/approvals") return { approved: true, approved_by: [{ user: { username: "rev" } }] };
    if (rest === "group/repo/repository/branches/main") return { name: "main", commit: { id: QA_BASE_SHA } };
    if (rest === "42/pipelines/7/jobs") return [{ name: "test", status: "success" }];
    if (rest === "group/repo/repository/compare") {
      const from = url.searchParams.get("from");
      if (from === QA_BASE_SHA) return { commits: [{ id: "a" }], compare_timeout: false, compare_same_ref: false };
      return { commits: [], compare_timeout: false, compare_same_ref: false };
    }
    return undefined;
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://gitlab.test");
    const rest = decodeURIComponent(url.pathname).split("/").filter(Boolean).slice(3).join("/");
    const body = payloads(rest, url);
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { message: "unhandled" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("stub server has no port");
    return await collectGitLabReceiptInput({ baseUrl: `http://127.0.0.1:${address.port}`, project: "group/repo", mr: 9 });
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
  assert.deepEqual(input.compare, { status: "ahead", aheadBy: 1, behindBy: 0 });
  assert.deepEqual(input.reviews, [{ author: "rev", state: "APPROVED" }]);
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
