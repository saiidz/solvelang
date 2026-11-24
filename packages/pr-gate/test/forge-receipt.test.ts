// SolveLang PR Gate — Gitea/Forgejo receipt collector tests.
//
// The collector is exercised against a stub HTTP server that answers
// with Gitea-shaped /api/v1 payloads, so the tests pin the real wire
// contract: endpoint paths, the token header, pagination, and every
// platform-vocabulary mapping (review states, commit-status states,
// mergeable, compare). No live forge is needed to run them.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectForgeReceiptInput,
  mapForgeCompare,
  mapForgeReview,
  mergeableStateFor,
  parseForgeReceiptArgs,
  ForgeCollectError,
} from "../src/forge-receipt";

const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const PR_PAYLOAD = {
  number: 7,
  title: "Tighten the leaf module",
  html_url: "http://forge.test/octo/demo/pulls/7",
  state: "open",
  draft: false,
  user: { login: "octo" },
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-24T09:00:00Z",
  head: { ref: "feat-x", sha: HEAD_SHA },
  base: { ref: "main", sha: BASE_SHA },
  mergeable: true,
  changed_files: 2,
  additions: 10,
  deletions: 3,
};

const FILES_PAYLOAD = [
  { filename: "src/leaf.ts", status: "modified", additions: 6, deletions: 2 },
  { filename: "src/leaf.test.ts", status: "added", additions: 4, deletions: 1 },
];

const REVIEWS_PAYLOAD = [
  { user: { login: "rev1" }, state: "REQUEST_CHANGES" },
  { user: { login: "rev1" }, state: "APPROVED" },
  { user: { login: "rev2" }, state: "PENDING" },
];

const COMMITS_PAYLOAD = [{ sha: "c1" }, { sha: "c2" }, { sha: "c3" }];

const COMBINED_STATUS_PAYLOAD = {
  state: "pending",
  total_count: 3,
  statuses: [
    { context: "ci/build", state: "success" },
    { context: "ci/lint", state: "pending" },
    { context: "ci/docs", state: "error" },
  ],
};

let server: Server;
let baseUrl = "";
let lastAuthorization: string | undefined;
let workRoot = "";

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  workRoot = mkdtempSync(path.join(tmpdir(), "forge-receipt-test-"));
  server = createServer((req, res) => {
    lastAuthorization = req.headers.authorization;
    const url = new URL(req.url ?? "/", "http://forge.test");
    const parts = url.pathname.split("/").filter(Boolean);
    // /api/v1/repos/{owner}/{repo}/...
    const repo = parts[4];
    const rest = parts.slice(5).join("/");
    if (repo === "broken") {
      sendJson(res, 404, { message: "not found" });
      return;
    }
    if (rest === "pulls/7") return sendJson(res, 200, PR_PAYLOAD);
    if (rest === "pulls/7/files") return sendJson(res, 200, FILES_PAYLOAD);
    if (rest === "pulls/7/reviews") return sendJson(res, 200, REVIEWS_PAYLOAD);
    if (rest === "pulls/7/commits") return sendJson(res, 200, COMMITS_PAYLOAD);
    if (rest === `commits/${HEAD_SHA}/status`) return sendJson(res, 200, COMBINED_STATUS_PAYLOAD);
    if (rest.startsWith("compare/")) {
      if (repo === "nocompare") return sendJson(res, 404, { message: "no compare" });
      if (rest === "compare/main...feat-x") return sendJson(res, 200, { total_commits: 3 });
      if (rest === "compare/feat-x...main") return sendJson(res, 200, { total_commits: 1 });
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

test("collector maps a Gitea PR into the exact receipt input shape", async () => {
  const input = await collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "demo", pr: 7, platform: "gitea", token: "test-token-123" });
  assert.equal(lastAuthorization, "token test-token-123");
  assert.deepEqual(input.pr, {
    owner: "octo",
    repo: "demo",
    number: 7,
    title: "Tighten the leaf module",
    url: "http://forge.test/octo/demo/pulls/7",
    state: "open",
    draft: false,
    author: "octo",
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-24T09:00:00Z",
    headSha: HEAD_SHA,
    headRef: "feat-x",
    baseRef: "main",
    baseSha: BASE_SHA,
    mergeable: true,
    mergeableState: "unstable",
    changedFiles: 2,
    additions: 10,
    deletions: 3,
    commits: 3,
  });
  assert.deepEqual(input.files, FILES_PAYLOAD);
  assert.deepEqual(input.checkRuns, [
    { name: "ci/build", status: "completed", conclusion: "success" },
    { name: "ci/lint", status: "in_progress", conclusion: null },
    { name: "ci/docs", status: "completed", conclusion: "failure" },
  ]);
  assert.deepEqual(input.reviews, [
    { author: "rev1", state: "CHANGES_REQUESTED" },
    { author: "rev1", state: "APPROVED" },
  ]);
  assert.deepEqual(input.compare, { status: "diverged", aheadBy: 3, behindBy: 1 });
  assert.equal(input.prGate.status, "not-run");
  assert.ok(input.source.startsWith(`Gitea REST API (/api/v1) at ${baseUrl}`));
  assert.ok(!JSON.stringify(input).includes("test-token-123"), "the token must never reach the output");
});

test("platform forgejo only changes the provenance naming", async () => {
  const input = await collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "demo", pr: 7, platform: "forgejo" });
  assert.ok(input.source.startsWith("Forgejo REST API (/api/v1)"));
  assert.equal(input.pr.number, 7);
});

test("a --gate-result file is embedded as the PR Gate route", async () => {
  const gatePath = path.join(workRoot, "result.json");
  writeFileSync(gatePath, JSON.stringify({
    schema: "solvelang.pr-gate.result.v1",
    graph: { integrityVerified: true, nodes: 12, edges: 9 },
    impact: { impactedNodes: 4, rootCount: 1, headline: "4 nodes impacted." },
    policy: { evaluation: { passed: false, verdicts: [{ rule: "max-impact-nodes", status: "fail", detail: "x" }] } },
  }), "utf8");
  const input = await collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "demo", pr: 7, platform: "gitea", gateResultPath: gatePath });
  assert.equal(input.prGate.status, "ran");
  if (input.prGate.status === "ran") {
    assert.equal(input.prGate.summary.integrityVerified, true);
    assert.equal(input.prGate.summary.nodes, 12);
    assert.equal(input.prGate.summary.impactedNodes, 4);
    assert.equal(input.prGate.summary.policyPassed, false);
    assert.deepEqual(input.prGate.summary.policyVerdicts, [{ rule: "max-impact-nodes", status: "fail" }]);
  }
});

test("a wrong-schema gate result is a failed route, never a ran one", async () => {
  const gatePath = path.join(workRoot, "bad-result.json");
  writeFileSync(gatePath, JSON.stringify({ schema: "something.else" }), "utf8");
  const input = await collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "demo", pr: 7, platform: "gitea", gateResultPath: gatePath });
  assert.equal(input.prGate.status, "failed");
});

test("an unreadable PR is an operational error, not a partial input", async () => {
  await assert.rejects(
    collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "broken", pr: 7, platform: "gitea" }),
    (error: unknown) => error instanceof ForgeCollectError && /HTTP 404/.test(error.message),
  );
});

test("a failing compare degrades to null (unverified), never a guess", async () => {
  const input = await collectForgeReceiptInput({ baseUrl, owner: "octo", repo: "nocompare", pr: 7, platform: "gitea" });
  assert.equal(input.compare, null);
  assert.equal(input.pr.number, 7);
});

test("mergeable state never claims more than the API said", () => {
  assert.equal(mergeableStateFor(null), "unknown");
  assert.equal(mergeableStateFor(true), "unstable");
  assert.equal(mergeableStateFor(false), "dirty");
});

test("compare status vocabulary matches the receipt builder", () => {
  assert.deepEqual(mapForgeCompare(0, 0), { status: "identical", aheadBy: 0, behindBy: 0 });
  assert.deepEqual(mapForgeCompare(2, 0), { status: "ahead", aheadBy: 2, behindBy: 0 });
  assert.deepEqual(mapForgeCompare(0, 2), { status: "behind", aheadBy: 0, behindBy: 2 });
  assert.deepEqual(mapForgeCompare(1, 1), { status: "diverged", aheadBy: 1, behindBy: 1 });
});

test("unsubmitted reviews are dropped; submitted ones keep their order", () => {
  assert.equal(mapForgeReview({ user: { login: "a" }, state: "PENDING" }), null);
  assert.equal(mapForgeReview({ user: { login: "a" }, state: "REQUEST_REVIEW" }), null);
  assert.deepEqual(mapForgeReview({ user: { login: "a" }, state: "COMMENT" }), { author: "a", state: "COMMENT" });
});

test("CLI parsing requires the instance coordinates and a known platform", () => {
  assert.throws(() => parseForgeReceiptArgs(["--owner", "octo"]), ForgeCollectError);
  assert.throws(
    () => parseForgeReceiptArgs(["--base-url", "http://x", "--owner", "o", "--repo", "r", "--pr", "1", "--platform", "gitlab"]),
    ForgeCollectError,
  );
  const parsed = parseForgeReceiptArgs(["--base-url", "http://x/", "--owner", "o", "--repo", "r", "--pr", "3"]);
  assert.equal(parsed.platform, "gitea");
  assert.equal(parsed.pr, 3);
});

test("the token falls back to the environment, never to a stored value", () => {
  const previous = process.env.FORGE_TOKEN;
  process.env.FORGE_TOKEN = "env-token-456";
  try {
    const parsed = parseForgeReceiptArgs(["--base-url", "http://x", "--owner", "o", "--repo", "r", "--pr", "1"]);
    assert.equal(parsed.token, "env-token-456");
  } finally {
    if (previous === undefined) delete process.env.FORGE_TOKEN;
    else process.env.FORGE_TOKEN = previous;
  }
});
