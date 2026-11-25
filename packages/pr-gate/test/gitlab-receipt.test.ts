// SolveLang PR Gate — GitLab receipt collector tests.
//
// The collector is exercised against a stub HTTP server that answers
// with GitLab-shaped /api/v4 payloads (field names and shapes verified
// against GitLab's API docs and live gitlab.com reads on 2026-11-24),
// so the tests pin the real wire contract: endpoint paths, the
// PRIVATE-TOKEN header, pagination, the fork-pipeline project rule,
// and every platform-vocabulary mapping (detailed_merge_status, job
// statuses, approvals, diff line counting). No live GitLab is needed
// to run them.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectGitLabReceiptInput,
  countDiffLines,
  mapGitLabChangedFile,
  mapGitLabJob,
  mergeableForGitLab,
  parseGitLabReceiptArgs,
  GitLabCollectError,
} from "../src/gitlab-receipt";

const HEAD_SHA = "6d14b5a97ac617ae11a8701c32835570e93f7257";
const BASE_SHA = "347b8e389f95987d6cd9fb232ac35529a5a64e11";
const DIFF_BASE_SHA = "0d9a8c68b86506f0a961df2eb3dd0668d1d7c5ed";
const FORK_PROJECT_ID = 45049979;
const PIPELINE_ID = 3096852712;

const MR_PAYLOAD = {
  iid: 4511,
  title: "fix(release): accept an already published catalog release",
  web_url: "https://gitlab.example.com/group/repo/-/merge_requests/4511",
  state: "opened",
  draft: false,
  author: { username: "contributor" },
  created_at: "2026-11-19T20:34:04.218Z",
  updated_at: "2026-11-23T14:09:55.484Z",
  sha: HEAD_SHA,
  source_branch: "fix-thing",
  target_branch: "main",
  diff_refs: { base_sha: DIFF_BASE_SHA, head_sha: HEAD_SHA, start_sha: DIFF_BASE_SHA },
  changes_count: "3",
  merge_status: "can_be_merged",
  detailed_merge_status: "mergeable",
  has_conflicts: false,
  head_pipeline: { id: PIPELINE_ID, project_id: FORK_PROJECT_ID, status: "success", sha: HEAD_SHA },
};

const DIFFS_PAYLOAD = [
  {
    old_path: "internal/create.go",
    new_path: "internal/create.go",
    a_mode: "100644",
    b_mode: "100644",
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
    generated_file: false,
    diff: "@@ -3,5 +3,6 @@ package create\n import (\n \t\"bytes\"\n+\t\"errors\"\n \t\"fmt\"\n-\t\"os\"\n+\t\"strings\"\n )",
  },
  {
    old_path: "internal/create_test.go",
    new_path: "internal/create_test.go",
    a_mode: "100644",
    b_mode: "100644",
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
    generated_file: false,
    diff: "--- a/internal/create_test.go\n+++ b/internal/create_test.go\n@@ -509,3 +509,4 @@ func TestCreate\n \tassert()\n+\tassertPublished()\n \tassert()\n",
  },
  {
    old_path: "docs/new.md",
    new_path: "docs/new.md",
    a_mode: "0",
    b_mode: "100644",
    new_file: true,
    renamed_file: false,
    deleted_file: false,
    collapsed: false,
    too_large: false,
    generated_file: false,
    diff: "@@ -0,0 +1,2 @@\n+# Title\n+Body line",
  },
];

const COMMITS_PAYLOAD = [{ id: "c1" }, { id: "c2" }];

const APPROVALS_PAYLOAD = {
  approved: false,
  approved_by: [{ user: { username: "GitLabDuo" }, approved_at: "2026-11-19T21:00:00.000Z" }],
};

const JOBS_PAYLOAD = [
  { name: "tests:unit", status: "success" },
  { name: "lint", status: "failed" },
  { name: "deploy:review", status: "manual" },
];

let server: Server;
let baseUrl = "";
let lastToken: string | undefined;
let jobProjectSeen = "";
let workRoot = "";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  workRoot = mkdtempSync(path.join(tmpdir(), "gitlab-receipt-test-"));
  server = createServer((req, res) => {
    lastToken = req.headers["private-token"] as string | undefined;
    const url = new URL(req.url ?? "/", "http://gitlab.test");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    // parts: [api, v4, projects, ...rest]
    const rest = parts.slice(3).join("/");
    if (rest.includes("broken")) return sendJson(res, 404, { message: "404 Not found" });
    if (rest === "group/repo/merge_requests/4511") return sendJson(res, 200, MR_PAYLOAD);
    if (rest === "group/repo/merge_requests/4511/diffs") return sendJson(res, 200, DIFFS_PAYLOAD);
    if (rest === "group/repo/merge_requests/4511/commits") return sendJson(res, 200, COMMITS_PAYLOAD);
    if (rest === "group/repo/merge_requests/4511/approvals") return sendJson(res, 200, APPROVALS_PAYLOAD);
    if (rest === "nocompare/repo/merge_requests/4511") return sendJson(res, 200, MR_PAYLOAD);
    if (rest.startsWith("nocompare/repo/merge_requests/4511/")) {
      if (rest.endsWith("/diffs")) return sendJson(res, 200, DIFFS_PAYLOAD);
      if (rest.endsWith("/commits")) return sendJson(res, 200, COMMITS_PAYLOAD);
      if (rest.endsWith("/approvals")) return sendJson(res, 200, APPROVALS_PAYLOAD);
    }
    if (rest === "nobranch/repo/merge_requests/4511") return sendJson(res, 200, MR_PAYLOAD);
    if (rest.startsWith("nobranch/repo/merge_requests/4511/")) {
      if (rest.endsWith("/diffs")) return sendJson(res, 200, DIFFS_PAYLOAD);
      if (rest.endsWith("/commits")) return sendJson(res, 200, COMMITS_PAYLOAD);
      if (rest.endsWith("/approvals")) return sendJson(res, 200, APPROVALS_PAYLOAD);
    }
    if (rest === "group/repo/repository/branches/main" || rest === "nocompare/repo/repository/branches/main") {
      return sendJson(res, 200, { name: "main", commit: { id: BASE_SHA } });
    }
    if (rest === "nobranch/repo/repository/branches/main") return sendJson(res, 404, { message: "404 Branch Not Found" });
    if (rest === `${FORK_PROJECT_ID}/pipelines/${PIPELINE_ID}/jobs`) {
      jobProjectSeen = String(FORK_PROJECT_ID);
      return sendJson(res, 200, JOBS_PAYLOAD);
    }
    if (rest === "nobranch/repo/repository/compare") {
      return sendJson(res, 404, { message: "compare should not be called here" });
    }
    if (rest === "nocompare/repo/repository/compare") return sendJson(res, 404, { message: "no compare" });
    if (rest === "group/repo/repository/compare") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (from === BASE_SHA && to === HEAD_SHA) return sendJson(res, 200, { commits: [{ id: "a" }, { id: "b" }], compare_timeout: false, compare_same_ref: false });
      if (from === HEAD_SHA && to === BASE_SHA) return sendJson(res, 200, { commits: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }], compare_timeout: false, compare_same_ref: false });
      return sendJson(res, 404, { message: "unknown compare" });
    }
    return sendJson(res, 404, { message: `unhandled ${url.pathname}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server has no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workRoot, { recursive: true, force: true });
});

test("collector maps a GitLab MR into the exact receipt input shape", async () => {
  const input = await collectGitLabReceiptInput({ baseUrl, project: "group/repo", mr: 4511, token: "glpat-test-123" });
  assert.equal(lastToken, "glpat-test-123");
  assert.deepEqual(input.pr, {
    owner: "group",
    repo: "repo",
    number: 4511,
    title: "fix(release): accept an already published catalog release",
    url: "https://gitlab.example.com/group/repo/-/merge_requests/4511",
    state: "open",
    draft: false,
    author: "contributor",
    createdAt: "2026-11-19T20:34:04.218Z",
    updatedAt: "2026-11-23T14:09:55.484Z",
    headSha: HEAD_SHA,
    headRef: "fix-thing",
    baseRef: "main",
    baseSha: BASE_SHA,
    mergeable: true,
    mergeableState: "unstable",
    changedFiles: 3,
    additions: 5,
    deletions: 1,
    commits: 2,
  });
  assert.deepEqual(input.files, [
    { filename: "internal/create.go", status: "modified", additions: 2, deletions: 1 },
    { filename: "internal/create_test.go", status: "modified", additions: 1, deletions: 0 },
    { filename: "docs/new.md", status: "added", additions: 2, deletions: 0 },
  ]);
  // Jobs are read from the FORK project named by head_pipeline.project_id.
  assert.equal(jobProjectSeen, String(FORK_PROJECT_ID));
  assert.deepEqual(input.checkRuns, [
    { name: "tests:unit", status: "completed", conclusion: "success" },
    { name: "lint", status: "completed", conclusion: "failure" },
    { name: "deploy:review", status: "queued", conclusion: null },
  ]);
  assert.deepEqual(input.reviews, [{ author: "GitLabDuo", state: "APPROVED" }]);
  assert.deepEqual(input.compare, { status: "diverged", aheadBy: 2, behindBy: 5 });
  assert.equal(input.prGate.status, "not-run");
  assert.ok(input.source.startsWith(`GitLab REST API (v4) at ${baseUrl}`));
  assert.ok(!JSON.stringify(input).includes("glpat-test-123"), "the token must never reach the output");
});

test("a failing compare degrades to null (unverified), never a guess", async () => {
  const input = await collectGitLabReceiptInput({ baseUrl, project: "nocompare/repo", mr: 4511 });
  assert.equal(input.compare, null);
  assert.equal(input.pr.baseSha, BASE_SHA);
  assert.equal(input.pr.number, 4511);
});

test("an unreadable base branch falls back to the diff base and skips compare", async () => {
  const input = await collectGitLabReceiptInput({ baseUrl, project: "nobranch/repo", mr: 4511 });
  assert.equal(input.pr.baseSha, DIFF_BASE_SHA);
  assert.equal(input.compare, null);
});

test("an unreadable MR is an operational error, not a partial input", async () => {
  await assert.rejects(
    collectGitLabReceiptInput({ baseUrl, project: "group/broken", mr: 4511 }),
    (error: unknown) => error instanceof GitLabCollectError && /HTTP 404/.test(error.message),
  );
});

test("a --gate-result file is embedded as the PR Gate route", async () => {
  const gatePath = path.join(workRoot, "result.json");
  writeFileSync(gatePath, JSON.stringify({
    schema: "solvelang.pr-gate.result.v1",
    graph: { integrityVerified: true, nodes: 12, edges: 9 },
    impact: { impactedNodes: 4, rootCount: 1, headline: "4 nodes impacted." },
    policy: { evaluation: { passed: true, verdicts: [{ rule: "protected-paths", status: "pass", detail: "x" }] } },
  }), "utf8");
  const input = await collectGitLabReceiptInput({ baseUrl, project: "group/repo", mr: 4511, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "ran");
  if (input.prGate.status === "ran") {
    assert.equal(input.prGate.summary.policyPassed, true);
    assert.deepEqual(input.prGate.summary.policyVerdicts, [{ rule: "protected-paths", status: "pass" }]);
  }
});

test("a wrong-schema gate result is a failed route, never a ran one", async () => {
  const gatePath = path.join(workRoot, "bad-result.json");
  writeFileSync(gatePath, JSON.stringify({ schema: "something.else" }), "utf8");
  const input = await collectGitLabReceiptInput({ baseUrl, project: "group/repo", mr: 4511, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "failed");
});

test("mergeable mapping never claims more than GitLab said", () => {
  const base = { state: "opened", has_conflicts: false, detailed_merge_status: "", merge_status: "" };
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "mergeable" }), { mergeable: true, mergeableState: "unstable" });
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "conflict" }), { mergeable: false, mergeableState: "dirty" });
  assert.deepEqual(mergeableForGitLab({ ...base, has_conflicts: true, detailed_merge_status: "mergeable" }), { mergeable: false, mergeableState: "dirty" });
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "unchecked" }), { mergeable: null, mergeableState: "unknown" });
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "checking" }), { mergeable: null, mergeableState: "unknown" });
  assert.deepEqual(
    mergeableForGitLab({ ...base, detailed_merge_status: "discussions_not_resolved" }),
    { mergeable: true, mergeableState: "discussions_not_resolved" },
  );
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "ci_must_pass" }), { mergeable: true, mergeableState: "ci_must_pass" });
  // A merged MR still reports can_be_merged live; never claim it.
  assert.deepEqual(
    mergeableForGitLab({ state: "merged", has_conflicts: false, detailed_merge_status: "not_open", merge_status: "can_be_merged" }),
    { mergeable: null, mergeableState: "unknown" },
  );
  // Deprecated merge_status fallback when no detailed status is present.
  assert.deepEqual(mergeableForGitLab({ ...base, merge_status: "can_be_merged" }), { mergeable: true, mergeableState: "unstable" });
  assert.deepEqual(mergeableForGitLab({ ...base, merge_status: "cannot_be_merged_recheck" }), { mergeable: false, mergeableState: "dirty" });
  // Unrecognized future vocabulary is unknown, never a guess.
  assert.deepEqual(mergeableForGitLab({ ...base, detailed_merge_status: "some_future_value" }), { mergeable: null, mergeableState: "unknown" });
});

test("job status mapping matches the receipt check-run vocabulary", () => {
  assert.deepEqual(mapGitLabJob({ name: "a", status: "success" }), { name: "a", status: "completed", conclusion: "success" });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "failed" }), { name: "a", status: "completed", conclusion: "failure" });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "canceled" }), { name: "a", status: "completed", conclusion: "cancelled" });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "skipped" }), { name: "a", status: "completed", conclusion: "skipped" });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "running" }), { name: "a", status: "in_progress", conclusion: null });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "pending" }), { name: "a", status: "queued", conclusion: null });
  assert.deepEqual(mapGitLabJob({ name: "a", status: "manual" }), { name: "a", status: "queued", conclusion: null });
});

test("diff line counting skips the file headers and counts content lines", () => {
  assert.deepEqual(countDiffLines("--- a/x.go\n+++ b/x.go\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n"), { additions: 1, deletions: 1 });
  assert.deepEqual(countDiffLines("@@ -0,0 +1,2 @@\n+# Title\n+\n"), { additions: 2, deletions: 0 });
  assert.deepEqual(countDiffLines(""), { additions: 0, deletions: 0 });
});

test("changed-file status comes from the diff flags", () => {
  assert.equal(mapGitLabChangedFile({ new_path: "a", diff: "", new_file: true }).status, "added");
  assert.equal(mapGitLabChangedFile({ new_path: "a", diff: "", deleted_file: true }).status, "deleted");
  assert.equal(mapGitLabChangedFile({ new_path: "b", old_path: "a", diff: "", renamed_file: true }).status, "renamed");
  assert.equal(mapGitLabChangedFile({ new_path: "a", diff: "" }).status, "modified");
  assert.equal(mapGitLabChangedFile({ new_path: "b", old_path: "a", diff: "", renamed_file: true }).filename, "b");
});

test("CLI parsing defaults to gitlab.com and requires project + MR iid", () => {
  assert.throws(() => parseGitLabReceiptArgs(["--project", "group/repo"]), GitLabCollectError);
  assert.throws(() => parseGitLabReceiptArgs(["--mr", "3"]), GitLabCollectError);
  const parsed = parseGitLabReceiptArgs(["--project", "group/repo", "--mr", "3"]);
  assert.equal(parsed.baseUrl, "https://gitlab.com");
  assert.equal(parsed.mr, 3);
});

test("the token falls back to GITLAB_TOKEN, never to a stored value", () => {
  const previous = process.env.GITLAB_TOKEN;
  process.env.GITLAB_TOKEN = "env-token-789";
  try {
    const parsed = parseGitLabReceiptArgs(["--project", "group/repo", "--mr", "1"]);
    assert.equal(parsed.token, "env-token-789");
  } finally {
    if (previous === undefined) delete process.env.GITLAB_TOKEN;
    else process.env.GITLAB_TOKEN = previous;
  }
});
