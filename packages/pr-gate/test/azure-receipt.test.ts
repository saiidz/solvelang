// SolveLang PR Gate — Azure DevOps receipt collector tests.
//
// The collector is exercised against a stub HTTP server that answers
// with Azure DevOps-shaped REST payloads (api-version 7.1: the
// { count, value } list envelope, GitPullRequest with reviewers and
// votes, iterations with source/target/common ref commits, iteration
// changes with nextSkip/nextTop paging, PR statuses, refs, and the
// diffs endpoint — field names and enums verified against Microsoft's
// REST API documentation on 2026-11-24), so the tests pin the real
// wire contract: endpoint paths, the PAT Basic / Bearer auth headers,
// iteration grounding, status currency reduction, and every
// platform-vocabulary mapping (mergeStatus, votes, change types,
// status states). No live Azure DevOps is needed to run them.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectAzureReceiptInput,
  currentAzureCheckRuns,
  mapAzureChangedFile,
  mapAzureChangeType,
  mapAzureReview,
  mapAzureStatus,
  mergeableForAzure,
  parseAzureReceiptArgs,
  AzureCollectError,
} from "../src/azure-receipt";

const HEAD_SHA = "6d14b5a97ac617ae11a8701c32835570e93f7257";
const BASE_SHA = "347b8e389f95987d6cd9fb232ac35529a5a64e11";
const ITERATION_TARGET_SHA = "0d9a8c68b86506f0a961df2eb3dd0668d1d7c5ed";
const COMMON_SHA = "be67f8871a4d2c75f13a51c1d3c30ac0d74d4ef4";

const PR_PAYLOAD = {
  pullRequestId: 42,
  title: "Fix the widget frobnicator",
  status: "active",
  mergeStatus: "succeeded",
  isDraft: false,
  createdBy: { displayName: "Ada Dev", uniqueName: "ada@example.com" },
  creationDate: "2026-11-19T20:34:04.218Z",
  sourceRefName: "refs/heads/fix-widget",
  targetRefName: "refs/heads/main",
  lastMergeSourceCommit: { commitId: HEAD_SHA },
  lastMergeTargetCommit: { commitId: ITERATION_TARGET_SHA },
  lastMergeCommit: { commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  repository: { id: "repo-guid", name: "widget-repo", project: { id: "proj-guid", name: "WidgetProject" } },
  reviewers: [
    { displayName: "Rob Reviewer", uniqueName: "rob@example.com", vote: 10, isContainer: false, isRequired: true },
    { displayName: "Sue Suggests", uniqueName: "sue@example.com", vote: 5, isContainer: false, isRequired: false },
    { displayName: "Walt Waiting", uniqueName: "walt@example.com", vote: -5, isContainer: false, isRequired: false },
    { displayName: "Ned NoVote", uniqueName: "ned@example.com", vote: 0, isContainer: false, isRequired: false },
    { displayName: "Team Group", uniqueName: "team@example.com", vote: 10, isContainer: true, isRequired: false },
  ],
  url: "https://dev.azure.com/fabrikam/_apis/git/repositories/repo-guid/pullRequests/42",
};

const ITERATIONS_PAYLOAD = {
  count: 2,
  value: [
    {
      id: 1,
      createdDate: "2026-11-19T20:34:04.218Z",
      updatedDate: "2026-11-19T20:34:04.218Z",
      sourceRefCommit: { commitId: "1111111111111111111111111111111111111111" },
      targetRefCommit: { commitId: ITERATION_TARGET_SHA },
      commonRefCommit: { commitId: COMMON_SHA },
    },
    {
      id: 2,
      createdDate: "2026-11-23T14:09:55.484Z",
      updatedDate: "2026-11-23T14:09:55.484Z",
      sourceRefCommit: { commitId: HEAD_SHA },
      targetRefCommit: { commitId: ITERATION_TARGET_SHA },
      commonRefCommit: { commitId: COMMON_SHA },
    },
  ],
};

// Iteration 2's changes arrive in two pages (nextSkip/nextTop).
const CHANGES_PAGE_1 = {
  changeEntries: [
    { changeTrackingId: 1, changeId: 1, item: { path: "/src/widget.ts", gitObjectType: "blob" }, changeType: "edit" },
    { changeTrackingId: 2, changeId: 2, item: { path: "/src/widget.test.ts", gitObjectType: "blob" }, changeType: "add" },
  ],
  nextSkip: 2,
  nextTop: 1,
};
const CHANGES_PAGE_2 = {
  changeEntries: [
    { changeTrackingId: 3, changeId: 3, item: { path: "/docs", gitObjectType: "tree", isFolder: true }, changeType: "add" },
    { changeTrackingId: 4, changeId: 4, item: { path: "/src/renamed.ts", gitObjectType: "blob" }, originalPath: "/src/old-name.ts", changeType: "edit, rename" },
    { changeTrackingId: 5, changeId: 5, sourceServerItem: "/src/gone.ts", changeType: "delete" },
  ],
  nextSkip: 0,
  nextTop: 0,
};

const COMMITS_PAYLOAD = { count: 2, value: [{ commitId: "c1" }, { commitId: "c2" }] };

const STATUSES_PAYLOAD = {
  count: 4,
  value: [
    // Older iteration: history, must not be claimed as current.
    { id: 1, state: "failed", description: "old", context: { name: "pr-gate", genre: "solvelang" }, iterationId: 1, targetUrl: "https://ci.example/1" },
    // Latest iteration, superseded by id 3 for the same context.
    { id: 2, state: "pending", description: "running", context: { name: "pr-gate", genre: "solvelang" }, iterationId: 2, targetUrl: "https://ci.example/2" },
    { id: 3, state: "succeeded", description: "passed", context: { name: "pr-gate", genre: "solvelang" }, iterationId: 2, targetUrl: "https://ci.example/3" },
    // PR-level posting (no iteration id): current evidence.
    { id: 4, state: "error", description: "boom", context: { name: "coverage", genre: "" }, targetUrl: "https://ci.example/4" },
  ],
};

const REFS_PAYLOAD = { count: 1, value: [{ name: "refs/heads/main", objectId: BASE_SHA }] };

const DIFF_PAYLOAD = { aheadCount: 2, behindCount: 5, commonCommit: COMMON_SHA, allChangesIncluded: true, changeCounts: { Edit: 3 }, changes: [] };

let server: Server;
let orgUrl = "";
let lastAuth: string | undefined;
let workRoot = "";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  workRoot = mkdtempSync(path.join(tmpdir(), "azure-receipt-test-"));
  server = createServer((req, res) => {
    lastAuth = req.headers.authorization as string | undefined;
    const url = new URL(req.url ?? "/", "http://azure.test");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    // parts: [org, project, _apis, git, repositories, repo, ...rest]
    const project = parts[1];
    const rest = parts.slice(6).join("/");
    if (url.pathname.includes("broken")) return sendJson(res, 404, { message: "not found" });
    if (rest === "pullRequests/42") return sendJson(res, 200, PR_PAYLOAD);
    if (rest === "pullRequests/42/iterations") return sendJson(res, 200, ITERATIONS_PAYLOAD);
    if (rest === "pullRequests/42/iterations/2/changes") {
      const skip = Number(url.searchParams.get("$skip") ?? "0");
      return sendJson(res, 200, skip === 0 ? CHANGES_PAGE_1 : CHANGES_PAGE_2);
    }
    if (rest === "pullRequests/42/commits") return sendJson(res, 200, COMMITS_PAYLOAD);
    if (rest === "pullRequests/42/statuses") return sendJson(res, 200, STATUSES_PAYLOAD);
    if (rest === "refs") {
      if (project === "nobranch") return sendJson(res, 404, { message: "no refs" });
      if (project === "nocompare") return sendJson(res, 200, REFS_PAYLOAD);
      return sendJson(res, 200, REFS_PAYLOAD);
    }
    if (rest === "diffs/commits") {
      if (project === "nocompare") return sendJson(res, 404, { message: "no diff" });
      return sendJson(res, 200, DIFF_PAYLOAD);
    }
    return sendJson(res, 404, { message: `unhandled ${url.pathname}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server has no port");
  orgUrl = `http://127.0.0.1:${address.port}/fabrikam`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workRoot, { recursive: true, force: true });
});

test("collector maps an Azure PR into the exact receipt input shape", async () => {
  const input = await collectAzureReceiptInput({ orgUrl, project: "WidgetProject", repository: "widget-repo", pr: 42, token: "pat-test-123" });
  // A PAT is presented as HTTP Basic with an empty user name.
  assert.equal(lastAuth, `Basic ${Buffer.from(":pat-test-123", "utf8").toString("base64")}`);
  assert.deepEqual(input.pr, {
    owner: "WidgetProject",
    repo: "widget-repo",
    number: 42,
    title: "Fix the widget frobnicator",
    url: `${orgUrl}/WidgetProject/_git/widget-repo/pullrequest/42`,
    state: "open",
    draft: false,
    author: "ada@example.com",
    createdAt: "2026-11-19T20:34:04.218Z",
    updatedAt: "2026-11-23T14:09:55.484Z",
    headSha: HEAD_SHA,
    headRef: "fix-widget",
    baseRef: "main",
    baseSha: BASE_SHA,
    mergeable: true,
    mergeableState: "unstable",
    changedFiles: 4,
    additions: 0,
    deletions: 0,
    commits: 2,
  });
  // The folder entry is structure, not a changed file; the delete's
  // path comes from sourceServerItem; paths lose the leading slash.
  assert.deepEqual(input.files, [
    { filename: "src/widget.ts", status: "modified", additions: 0, deletions: 0 },
    { filename: "src/widget.test.ts", status: "added", additions: 0, deletions: 0 },
    { filename: "src/renamed.ts", status: "renamed", additions: 0, deletions: 0 },
    { filename: "src/gone.ts", status: "deleted", additions: 0, deletions: 0 },
  ]);
  // Votes: 10 and 5 approve; -5 is a recorded refusal; 0 is dropped;
  // the container is dropped (its members vote individually).
  assert.deepEqual(input.reviews, [
    { author: "rob@example.com", state: "APPROVED" },
    { author: "sue@example.com", state: "APPROVED" },
    { author: "walt@example.com", state: "CHANGES_REQUESTED" },
  ]);
  // Statuses: latest iteration only, newest per context.
  assert.deepEqual(input.checkRuns, [
    { name: "solvelang/pr-gate", status: "completed", conclusion: "success" },
    { name: "coverage", status: "completed", conclusion: "failure" },
  ]);
  assert.deepEqual(input.compare, { status: "diverged", aheadBy: 2, behindBy: 5 });
  assert.equal(input.prGate.status, "not-run");
  assert.ok(input.source.startsWith(`Azure DevOps REST API (api-version 7.1) at ${orgUrl}`));
  assert.ok(!JSON.stringify(input).includes("pat-test-123"), "the token must never reach the output");
});

test("a bearer token is presented as Bearer and wins over a PAT", async () => {
  await collectAzureReceiptInput({ orgUrl, project: "WidgetProject", repository: "widget-repo", pr: 42, token: "pat-x", bearerToken: "entra-y" });
  assert.equal(lastAuth, "Bearer entra-y");
});

test("a failing compare degrades to null (unverified), never a guess", async () => {
  const input = await collectAzureReceiptInput({ orgUrl, project: "nocompare", repository: "widget-repo", pr: 42 });
  assert.equal(input.compare, null);
  assert.equal(input.pr.baseSha, BASE_SHA);
  assert.equal(input.pr.number, 42);
});

test("an unreadable base branch falls back to the iteration target and skips compare", async () => {
  const input = await collectAzureReceiptInput({ orgUrl, project: "nobranch", repository: "widget-repo", pr: 42 });
  assert.equal(input.pr.baseSha, ITERATION_TARGET_SHA);
  assert.equal(input.compare, null);
});

test("an unreadable PR is an operational error, not a partial input", async () => {
  await assert.rejects(
    collectAzureReceiptInput({ orgUrl, project: "WidgetProject", repository: "broken", pr: 42 }),
    (error: unknown) => error instanceof AzureCollectError && /HTTP 404/.test(error.message),
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
  const input = await collectAzureReceiptInput({ orgUrl, project: "WidgetProject", repository: "widget-repo", pr: 42, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "ran");
  if (input.prGate.status === "ran") {
    assert.equal(input.prGate.summary.policyPassed, true);
    assert.deepEqual(input.prGate.summary.policyVerdicts, [{ rule: "protected-paths", status: "pass" }]);
  }
});

test("a wrong-schema gate result is a failed route, never a ran one", async () => {
  const gatePath = path.join(workRoot, "bad-result.json");
  writeFileSync(gatePath, JSON.stringify({ schema: "something.else" }), "utf8");
  const input = await collectAzureReceiptInput({ orgUrl, project: "WidgetProject", repository: "widget-repo", pr: 42, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "failed");
});

test("mergeable mapping never claims more than Azure said", () => {
  const active = { status: "active" };
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "succeeded" }), { mergeable: true, mergeableState: "unstable" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "conflicts" }), { mergeable: false, mergeableState: "dirty" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "rejectedByPolicy" }), { mergeable: true, mergeableState: "rejectedByPolicy" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "failure" }), { mergeable: null, mergeableState: "failure" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "queued" }), { mergeable: null, mergeableState: "unknown" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "notSet" }), { mergeable: null, mergeableState: "unknown" });
  assert.deepEqual(mergeableForAzure({ ...active, mergeStatus: "some_future_value" }), { mergeable: null, mergeableState: "unknown" });
  // A completed PR's mergeStatus describes the merge that happened.
  assert.deepEqual(mergeableForAzure({ status: "completed", mergeStatus: "succeeded" }), { mergeable: null, mergeableState: "unknown" });
  assert.deepEqual(mergeableForAzure({ status: "abandoned", mergeStatus: "conflicts" }), { mergeable: null, mergeableState: "unknown" });
});

test("vote mapping follows Microsoft's enumeration", () => {
  const person = { uniqueName: "r@example.com", displayName: "R", isContainer: false };
  assert.deepEqual(mapAzureReview({ ...person, vote: 10 }), { author: "r@example.com", state: "APPROVED" });
  assert.deepEqual(mapAzureReview({ ...person, vote: 5 }), { author: "r@example.com", state: "APPROVED" });
  assert.deepEqual(mapAzureReview({ ...person, vote: -10 }), { author: "r@example.com", state: "CHANGES_REQUESTED" });
  assert.deepEqual(mapAzureReview({ ...person, vote: -5 }), { author: "r@example.com", state: "CHANGES_REQUESTED" });
  assert.equal(mapAzureReview({ ...person, vote: 0 }), null);
  assert.equal(mapAzureReview({ ...person, vote: 10, isContainer: true }), null);
});

test("status state mapping matches the receipt check-run vocabulary", () => {
  const ctx = { context: { name: "pr-gate", genre: "solvelang" } };
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "succeeded" }), { name: "solvelang/pr-gate", status: "completed", conclusion: "success" });
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "failed" }), { name: "solvelang/pr-gate", status: "completed", conclusion: "failure" });
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "error" }), { name: "solvelang/pr-gate", status: "completed", conclusion: "failure" });
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "notApplicable" }), { name: "solvelang/pr-gate", status: "completed", conclusion: "neutral" });
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "pending" }), { name: "solvelang/pr-gate", status: "in_progress", conclusion: null });
  assert.deepEqual(mapAzureStatus({ ...ctx, state: "notSet" }), { name: "solvelang/pr-gate", status: "queued", conclusion: null });
  // No genre: the name stands alone.
  assert.deepEqual(mapAzureStatus({ context: { name: "coverage", genre: "" }, state: "succeeded" }), { name: "coverage", status: "completed", conclusion: "success" });
});

test("status currency: latest iteration only, newest per context", () => {
  const runs = currentAzureCheckRuns(
    [
      { id: 1, state: "failed", context: { name: "a", genre: "g" }, iterationId: 1 },
      { id: 2, state: "failed", context: { name: "a", genre: "g" }, iterationId: 2 },
      { id: 3, state: "succeeded", context: { name: "a", genre: "g" }, iterationId: 2 },
      { id: 4, state: "pending", context: { name: "b", genre: "" } },
    ],
    2,
  );
  assert.deepEqual(runs, [
    { name: "g/a", status: "completed", conclusion: "success" },
    { name: "b", status: "in_progress", conclusion: null },
  ]);
});

test("change type mapping handles Azure's flag lists", () => {
  assert.equal(mapAzureChangeType("add"), "added");
  assert.equal(mapAzureChangeType("delete"), "deleted");
  assert.equal(mapAzureChangeType("rename"), "renamed");
  assert.equal(mapAzureChangeType("edit, rename"), "renamed");
  assert.equal(mapAzureChangeType("edit"), "modified");
  assert.equal(mapAzureChangeType("merge"), "modified");
  assert.equal(mapAzureChangeType(""), "modified");
  assert.equal(mapAzureChangedFile({ item: { path: "/x.ts", gitObjectType: "blob" }, changeType: "edit" })?.filename, "x.ts");
  assert.equal(mapAzureChangedFile({ item: { path: "/dir", gitObjectType: "tree" }, changeType: "add" }), null);
  assert.equal(mapAzureChangedFile({ item: { path: "/dir", isFolder: true }, changeType: "add" }), null);
  assert.equal(mapAzureChangedFile({ sourceServerItem: "/gone.ts", changeType: "delete" })?.filename, "gone.ts");
});

test("CLI parsing requires org, project, repository, and PR id", () => {
  assert.throws(() => parseAzureReceiptArgs(["--project", "P", "--repository", "R", "--pr", "3"]), AzureCollectError);
  assert.throws(() => parseAzureReceiptArgs(["--org-url", "https://dev.azure.com/o", "--project", "P", "--repository", "R"]), AzureCollectError);
  const parsed = parseAzureReceiptArgs(["--org-url", "https://dev.azure.com/o", "--project", "P", "--repository", "R", "--pr", "3"]);
  assert.equal(parsed.pr, 3);
  assert.equal(parsed.orgUrl, "https://dev.azure.com/o");
});

test("credentials fall back to the environment, never to a stored value", () => {
  const prevPat = process.env.AZURE_DEVOPS_PAT;
  const prevBearer = process.env.AZURE_DEVOPS_BEARER_TOKEN;
  process.env.AZURE_DEVOPS_PAT = "env-pat-1";
  process.env.AZURE_DEVOPS_BEARER_TOKEN = "env-bearer-2";
  try {
    const parsed = parseAzureReceiptArgs(["--org-url", "https://dev.azure.com/o", "--project", "P", "--repository", "R", "--pr", "1"]);
    assert.equal(parsed.token, "env-pat-1");
    assert.equal(parsed.bearerToken, "env-bearer-2");
  } finally {
    if (prevPat === undefined) delete process.env.AZURE_DEVOPS_PAT;
    else process.env.AZURE_DEVOPS_PAT = prevPat;
    if (prevBearer === undefined) delete process.env.AZURE_DEVOPS_BEARER_TOKEN;
    else process.env.AZURE_DEVOPS_BEARER_TOKEN = prevBearer;
  }
});
