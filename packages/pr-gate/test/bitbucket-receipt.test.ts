// SolveLang PR Gate — Bitbucket Cloud receipt collector tests.
//
// The collector is exercised against a stub HTTP server that answers
// with Bitbucket Cloud-shaped REST payloads (API 2.0: the
// { values, next } paging envelope, a pull request object with
// participants carrying approved flags and review states, diffstat
// entries with lines_added / lines_removed, PR commits, PR build
// statuses, a branch ref, and include/exclude commit listings —
// field names and enums verified against Atlassian's REST API
// documentation and first-hand against the public atlassian/aui
// repository on 2026-11-25), so the tests pin the real wire
// contract: endpoint paths, the Bearer / Basic auth headers, paging,
// and every platform-vocabulary mapping (PR states, diffstat
// statuses, participant verdicts, build-status states). No live
// Bitbucket is needed to run them.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectBitbucketReceiptInput,
  mapBitbucketChangedFile,
  mapBitbucketDiffstatStatus,
  mapBitbucketParticipant,
  mapBitbucketPrState,
  mapBitbucketStatus,
  mergeableForBitbucket,
  parseBitbucketReceiptArgs,
  BitbucketCollectError,
} from "../src/bitbucket-receipt";

const HEAD_SHA = "7951c8b219e97f5bc0e2191d12fb8ff8903cd85b";
const HEAD_SHORT = "7951c8b219e9";
const BASE_SHA = "22232e91f60713482ed8b27b099679fbd14bd5b2";
const BASE_SHORT = "22232e91f607";

const PR_PAYLOAD = {
  type: "pullrequest",
  id: 42,
  title: "Fix the widget frobnicator",
  state: "OPEN",
  draft: false,
  comment_count: 3,
  task_count: 1,
  created_on: "2026-11-19T20:34:04.218000+00:00",
  updated_on: "2026-11-23T14:09:55.484000+00:00",
  author: { display_name: "Ada Dev", nickname: "ada-dev", account_id: "acc-ada", type: "user" },
  source: {
    branch: { name: "fix-widget" },
    commit: { hash: HEAD_SHORT, type: "commit" },
    repository: { full_name: "ada-fork/widget-repo", type: "repository" },
  },
  destination: {
    branch: { name: "main" },
    commit: { hash: BASE_SHORT, type: "commit" },
    repository: { full_name: "widget-ws/widget-repo", type: "repository" },
  },
  links: { html: { href: "https://bitbucket.org/widget-ws/widget-repo/pull-requests/42" } },
  reviewers: [
    { display_name: "Rob Reviewer", nickname: "rob", account_id: "acc-rob", type: "user" },
    { display_name: "Sue Suggests", nickname: "sue", account_id: "acc-sue", type: "user" },
  ],
  participants: [
    { role: "REVIEWER", approved: true, state: "approved", participated_on: "2026-11-20T09:00:00.000000+00:00", user: { display_name: "Rob Reviewer", nickname: "rob", account_id: "acc-rob", type: "user" } },
    { role: "REVIEWER", approved: false, state: "changes_requested", participated_on: "2026-11-21T09:00:00.000000+00:00", user: { display_name: "Sue Suggests", nickname: "sue", account_id: "acc-sue", type: "user" } },
    { role: "PARTICIPANT", approved: true, state: "approved", participated_on: "2026-11-22T09:00:00.000000+00:00", user: { display_name: "Pat Participant", nickname: "pat", account_id: "acc-pat", type: "user" } },
    { role: "REVIEWER", approved: false, state: null, participated_on: "2026-11-22T10:00:00.000000+00:00", user: { display_name: "Ned NoVerdict", nickname: "ned", account_id: "acc-ned", type: "user" } },
    { role: "PARTICIPANT", approved: false, state: null, participated_on: "2026-11-19T20:34:04.218000+00:00", user: { display_name: "Ada Dev", nickname: "ada-dev", account_id: "acc-ada", type: "user" } },
  ],
};

// The diffstat arrives in two pages (the `next` link is filled in by
// the stub once its port is known).
function diffstatPage1(nextUrl: string): unknown {
  return {
    values: [
      { type: "diffstat", status: "modified", lines_added: 4, lines_removed: 2, old: { path: "src/widget.ts", type: "commit_file" }, new: { path: "src/widget.ts", type: "commit_file" } },
      { type: "diffstat", status: "added", lines_added: 25, lines_removed: 0, old: null, new: { path: "src/widget.test.ts", type: "commit_file" } },
    ],
    pagelen: 2,
    next: nextUrl,
  };
}
const DIFFSTAT_PAGE_2 = {
  values: [
    { type: "diffstat", status: "renamed", lines_added: 1, lines_removed: 1, old: { path: "src/old-name.ts", type: "commit_file" }, new: { path: "src/renamed.ts", type: "commit_file" } },
    { type: "diffstat", status: "removed", lines_added: 0, lines_removed: 12, old: { path: "src/gone.ts", type: "commit_file" }, new: null },
  ],
  pagelen: 2,
};

const COMMITS_PAYLOAD = {
  values: [
    { hash: HEAD_SHA, type: "commit" },
    { hash: "b6073d06a762e9d5f1056ff7aa75e474f0f8d626", type: "commit" },
  ],
  pagelen: 100,
};

const STATUSES_PAYLOAD = {
  values: [
    { key: "solvelang-pr-gate", type: "build", state: "SUCCESSFUL", name: "SolveLang PR Gate", url: "https://ci.example/3", description: "PR Gate passed" },
    { key: "3930620514", type: "build", state: "FAILED", name: "Bamboo plan", url: "https://ci.example/1", description: "failed" },
    { key: "coverage", type: "build", state: "INPROGRESS", name: "Coverage", url: "https://ci.example/2", description: "running" },
    { key: "deploy", type: "build", state: "STOPPED", name: "Deploy", url: "https://ci.example/4", description: "stopped" },
  ],
  pagelen: 100,
};

const BRANCH_PAYLOAD = { name: "main", type: "branch", target: { hash: BASE_SHA, type: "commit" } };

let server: Server;
let baseUrl = "";
let lastAuth: string | undefined;
let workRoot = "";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  workRoot = mkdtempSync(path.join(tmpdir(), "bitbucket-receipt-test-"));
  server = createServer((req, res) => {
    lastAuth = req.headers.authorization as string | undefined;
    const url = new URL(req.url ?? "/", "http://bitbucket.test");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    // parts: [2.0, repositories, ws, repo, ...rest]
    const repo = parts[3];
    const rest = parts.slice(4).join("/");
    if (repo === "broken") return sendJson(res, 404, { type: "error", error: { message: "not found" } });
    if (rest === "pullrequests/42") return sendJson(res, 200, PR_PAYLOAD);
    if (rest === "pullrequests/42/diffstat") {
      const address = server.address();
      const port = address !== null && typeof address !== "string" ? address.port : 0;
      if (url.searchParams.get("page") === "2") return sendJson(res, 200, DIFFSTAT_PAGE_2);
      return sendJson(res, 200, diffstatPage1(`http://127.0.0.1:${port}/2.0/repositories/widget-ws/widget-repo/pullrequests/42/diffstat?page=2`));
    }
    if (rest === "pullrequests/42/commits") return sendJson(res, 200, COMMITS_PAYLOAD);
    if (rest === "pullrequests/42/statuses") return sendJson(res, 200, STATUSES_PAYLOAD);
    if (rest === "refs/branches/main") {
      if (repo === "nobranch") return sendJson(res, 404, { type: "error", error: { message: "no branch" } });
      return sendJson(res, 200, BRANCH_PAYLOAD);
    }
    if (rest === "commits") {
      if (repo === "nocompare") return sendJson(res, 404, { type: "error", error: { message: "no listing" } });
      const include = url.searchParams.get("include");
      const exclude = url.searchParams.get("exclude");
      if (include === HEAD_SHA && exclude === BASE_SHA) return sendJson(res, 200, { values: [{ hash: HEAD_SHA }, { hash: "b6073d06a762e9d5f1056ff7aa75e474f0f8d626" }], pagelen: 100 });
      if (include === BASE_SHA && exclude === HEAD_SHA) return sendJson(res, 200, { values: [{ hash: BASE_SHA }], pagelen: 100 });
      return sendJson(res, 404, { type: "error", error: { message: "bad include/exclude" } });
    }
    return sendJson(res, 404, { type: "error", error: { message: `unhandled ${url.pathname}` } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server has no port");
  baseUrl = `http://127.0.0.1:${address.port}/2.0`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workRoot, { recursive: true, force: true });
});

test("collector maps a Bitbucket PR into the exact receipt input shape", async () => {
  const input = await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "widget-repo", pr: 42, token: "access-token-123" });
  // An access token is presented as a bearer token. (The expected
  // header is assembled from fragments: a credential-shaped literal
  // in a source file does not survive every file-writing tool
  // intact, as the sibling collectors' history shows.)
  assert.equal(lastAuth, ["Bearer", "access-token-123"].join(" "));
  assert.deepEqual(input.pr, {
    owner: "widget-ws",
    repo: "widget-repo",
    number: 42,
    title: "Fix the widget frobnicator",
    url: "https://bitbucket.org/widget-ws/widget-repo/pull-requests/42",
    state: "open",
    draft: false,
    author: "Ada Dev",
    createdAt: "2026-11-19T20:34:04.218000+00:00",
    updatedAt: "2026-11-23T14:09:55.484000+00:00",
    // The full head SHA comes from the PR commits list (the PR
    // object abbreviates it); the full base SHA from the branch ref.
    headSha: HEAD_SHA,
    headRef: "fix-widget",
    baseRef: "main",
    baseSha: BASE_SHA,
    // Bitbucket exposes no mergeability verdict: no claim is made.
    mergeable: null,
    mergeableState: "unknown",
    changedFiles: 4,
    additions: 30,
    deletions: 15,
    commits: 2,
  });
  // Line counts are Bitbucket's own lines_added / lines_removed;
  // a removed file's path comes from its old side.
  assert.deepEqual(input.files, [
    { filename: "src/widget.ts", status: "modified", additions: 4, deletions: 2 },
    { filename: "src/widget.test.ts", status: "added", additions: 25, deletions: 0 },
    { filename: "src/renamed.ts", status: "renamed", additions: 1, deletions: 1 },
    { filename: "src/gone.ts", status: "deleted", additions: 0, deletions: 12 },
  ]);
  // Verdicts: approvals (reviewer and participant alike) and the
  // changes request are reviews; no-verdict participants are dropped.
  assert.deepEqual(input.reviews, [
    { author: "Rob Reviewer", state: "APPROVED" },
    { author: "Sue Suggests", state: "CHANGES_REQUESTED" },
    { author: "Pat Participant", state: "APPROVED" },
  ]);
  // Build statuses map onto the check-run vocabulary.
  assert.deepEqual(input.checkRuns, [
    { name: "SolveLang PR Gate", status: "completed", conclusion: "success" },
    { name: "Bamboo plan", status: "completed", conclusion: "failure" },
    { name: "Coverage", status: "in_progress", conclusion: null },
    { name: "Deploy", status: "completed", conclusion: "cancelled" },
  ]);
  assert.deepEqual(input.compare, { status: "diverged", aheadBy: 2, behindBy: 1 });
  assert.equal(input.prGate.status, "not-run");
  assert.ok(input.source.startsWith(`Bitbucket Cloud REST API (2.0) at ${baseUrl}`));
  assert.ok(!JSON.stringify(input).includes("access-token-123"), "the token must never reach the output");
});

test("an Atlassian API token is presented as HTTP Basic with the account email", async () => {
  await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "widget-repo", pr: 42, username: "ada@example.com", apiToken: "api-token-9" });
  assert.equal(lastAuth, `Basic ${Buffer.from("ada@example.com:api-token-9", "utf8").toString("base64")}`);
});

test("a bearer <redacted> wins over API-token Basic auth", async () => {
  await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "widget-repo", pr: 42, token: "tok-1", username: "ada@example.com", apiToken: "api-token-9" });
  assert.equal(lastAuth, ["Bearer", "tok-1"].join(" "));
});

test("a failing compare degrades to null (unverified), never a guess", async () => {
  const input = await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "nocompare", pr: 42 });
  assert.equal(input.compare, null);
  assert.equal(input.pr.baseSha, BASE_SHA);
  assert.equal(input.pr.number, 42);
});

test("an unreadable destination branch falls back to the PR's destination commit and skips compare", async () => {
  const input = await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "nobranch", pr: 42 });
  // The fallback is the abbreviated hash exactly as the PR returned
  // it — recorded as returned, never padded out or guessed.
  assert.equal(input.pr.baseSha, BASE_SHORT);
  assert.equal(input.compare, null);
});

test("an unreadable PR is an operational error, not a partial input", async () => {
  await assert.rejects(
    collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "broken", pr: 42 }),
    (error: unknown) => error instanceof BitbucketCollectError && /HTTP 404/.test(error.message),
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
  const input = await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "widget-repo", pr: 42, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "ran");
  if (input.prGate.status === "ran") {
    assert.equal(input.prGate.summary.policyPassed, true);
    assert.deepEqual(input.prGate.summary.policyVerdicts, [{ rule: "protected-paths", status: "pass" }]);
  }
});

test("a wrong-schema gate result is a failed route, never a ran one", async () => {
  const gatePath = path.join(workRoot, "bad-result.json");
  writeFileSync(gatePath, JSON.stringify({ schema: "something.else" }), "utf8");
  const input = await collectBitbucketReceiptInput({ baseUrl, workspace: "widget-ws", repository: "widget-repo", pr: 42, gateResultPath: gatePath });
  assert.equal(input.prGate.status, "failed");
});

test("PR state mapping follows Bitbucket's enum", () => {
  assert.equal(mapBitbucketPrState("OPEN"), "open");
  assert.equal(mapBitbucketPrState("MERGED"), "merged");
  assert.equal(mapBitbucketPrState("DECLINED"), "closed");
  assert.equal(mapBitbucketPrState("SUPERSEDED"), "closed");
  // An unrecognized state passes through rather than being renamed.
  assert.equal(mapBitbucketPrState("SOME_FUTURE_STATE"), "SOME_FUTURE_STATE");
});

test("mergeability is never claimed for Bitbucket", () => {
  assert.deepEqual(mergeableForBitbucket(), { mergeable: null, mergeableState: "unknown" });
});

test("participant verdict mapping follows the approved flag and state", () => {
  const user = { display_name: "R", nickname: "r", account_id: "acc-r" };
  assert.deepEqual(mapBitbucketParticipant({ role: "REVIEWER", approved: true, state: "approved", user }), { author: "R", state: "APPROVED" });
  assert.deepEqual(mapBitbucketParticipant({ role: "PARTICIPANT", approved: true, state: null, user }), { author: "R", state: "APPROVED" });
  assert.deepEqual(mapBitbucketParticipant({ role: "REVIEWER", approved: false, state: "changes_requested", user }), { author: "R", state: "CHANGES_REQUESTED" });
  assert.equal(mapBitbucketParticipant({ role: "REVIEWER", approved: false, state: null, user }), null);
  // A changes request outranks a stale approval flag on the same
  // participant: the recorded refusal is the current verdict.
  assert.deepEqual(mapBitbucketParticipant({ role: "REVIEWER", approved: true, state: "changes_requested", user }), { author: "R", state: "CHANGES_REQUESTED" });
});

test("build-status state mapping matches the receipt check-run vocabulary", () => {
  const named = { key: "k1", name: "Build" };
  assert.deepEqual(mapBitbucketStatus({ ...named, state: "SUCCESSFUL" }), { name: "Build", status: "completed", conclusion: "success" });
  assert.deepEqual(mapBitbucketStatus({ ...named, state: "FAILED" }), { name: "Build", status: "completed", conclusion: "failure" });
  assert.deepEqual(mapBitbucketStatus({ ...named, state: "INPROGRESS" }), { name: "Build", status: "in_progress", conclusion: null });
  assert.deepEqual(mapBitbucketStatus({ ...named, state: "STOPPED" }), { name: "Build", status: "completed", conclusion: "cancelled" });
  // No display name: the key is the name.
  assert.deepEqual(mapBitbucketStatus({ key: "only-key", state: "SUCCESSFUL" }), { name: "only-key", status: "completed", conclusion: "success" });
});

test("diffstat status and file mapping keep Bitbucket's line counts", () => {
  assert.equal(mapBitbucketDiffstatStatus("added"), "added");
  assert.equal(mapBitbucketDiffstatStatus("removed"), "deleted");
  assert.equal(mapBitbucketDiffstatStatus("renamed"), "renamed");
  assert.equal(mapBitbucketDiffstatStatus("modified"), "modified");
  assert.equal(mapBitbucketDiffstatStatus(""), "modified");
  assert.deepEqual(
    mapBitbucketChangedFile({ status: "modified", lines_added: 3, lines_removed: 5, old: { path: "a.ts" }, new: { path: "a.ts" } }),
    { filename: "a.ts", status: "modified", additions: 3, deletions: 5 },
  );
  assert.deepEqual(
    mapBitbucketChangedFile({ status: "removed", lines_added: 0, lines_removed: 9, old: { path: "gone.ts" }, new: null }),
    { filename: "gone.ts", status: "deleted", additions: 0, deletions: 9 },
  );
  assert.equal(mapBitbucketChangedFile({ status: "modified", lines_added: 1, lines_removed: 1, old: null, new: null }), null);
});

test("CLI parsing requires workspace, repository, and PR id", () => {
  assert.throws(() => parseBitbucketReceiptArgs(["--repository", "R", "--pr", "3"]), BitbucketCollectError);
  assert.throws(() => parseBitbucketReceiptArgs(["--workspace", "W", "--repository", "R"]), BitbucketCollectError);
  const parsed = parseBitbucketReceiptArgs(["--workspace", "W", "--repository", "R", "--pr", "3"]);
  assert.equal(parsed.pr, 3);
  assert.equal(parsed.workspace, "W");
});

test("credentials fall back to the environment, never to a stored value", () => {
  const prevToken = process.env.BITBUCKET_TOKEN;
  const prevUser = process.env.BITBUCKET_USERNAME;
  const prevApi = process.env.BITBUCKET_API_TOKEN;
  process.env.BITBUCKET_TOKEN = "env-token-1";
  process.env.BITBUCKET_USERNAME = "env-user@example.com";
  process.env.BITBUCKET_API_TOKEN = "env-api-2";
  try {
    const parsed = parseBitbucketReceiptArgs(["--workspace", "W", "--repository", "R", "--pr", "1"]);
    assert.equal(parsed.token, "env-token-1");
    assert.equal(parsed.username, "env-user@example.com");
    assert.equal(parsed.apiToken, "env-api-2");
  } finally {
    if (prevToken === undefined) delete process.env.BITBUCKET_TOKEN;
    else process.env.BITBUCKET_TOKEN = prevToken;
    if (prevUser === undefined) delete process.env.BITBUCKET_USERNAME;
    else process.env.BITBUCKET_USERNAME = prevUser;
    if (prevApi === undefined) delete process.env.BITBUCKET_API_TOKEN;
    else process.env.BITBUCKET_API_TOKEN = prevApi;
  }
});
