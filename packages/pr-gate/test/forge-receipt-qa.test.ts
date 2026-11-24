// SolveLang PR Gate — QA pins for the Gitea/Forgejo packaging.
//
// These pins lock the cross-file contract the feature depends on:
//   - the collector's emitted JSON keeps the exact field contract of
//     ChangeImpactReceiptInput in
//     site/app/change-impact-receipt/core/receipt.ts (the shape the
//     live /change-impact-receipt/ page consumes);
//   - each workflow template carries its platform's required mechanics
//     (token source, API endpoints, sticky-comment marker, docs
//     citations) and does NOT carry the other platform's assumptions;
//   - package.json wires the collector bin to the built file;
//   - the README documents both templates and the collector.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { collectForgeReceiptInput } from "../src/forge-receipt";

// The compiled test lives at packages/pr-gate/dist/packages/pr-gate/test,
// so four levels up is the package directory and six is the repo root.
const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

function readPkgFile(name: string): string {
  return readFileSync(path.join(pkgDir, name), "utf8");
}

test("workflow templates carry their platform's required mechanics", () => {
  const gitea = readPkgFile("workflow-template.gitea.yml");
  for (const needle of [
    ".gitea/workflows/pr-gate.yml",
    "${{ secrets.GITEA_TOKEN }}",
    "https://docs.gitea.com/usage/actions/comparison",
    "https://docs.gitea.com/usage/actions/token-permissions",
    "/statuses/",
    "/issues/",
    "comments",
    "<!-- pr-gate:report -->",
    "<PINNED_SHA>",
    "permissions:",
    "pull_request:",
  ]) {
    assert.ok(gitea.includes(needle), `gitea template is missing: ${needle}`);
  }
  assert.ok(!gitea.includes("FORGEJO_TOKEN"), "gitea template must not rely on Forgejo env vars");

  const forgejo = readPkgFile("workflow-template.forgejo.yml");
  for (const needle of [
    ".forgejo/workflows/pr-gate.yml",
    "FORGEJO_TOKEN",
    "FORGEJO_API_URL",
    "FORGEJO_OUTPUT",
    "https://forgejo.org/docs/latest/user/actions/github-actions/",
    "https://forgejo.org/docs/latest/user/actions/reference/",
    "/statuses/",
    "/issues/",
    "comments",
    "<!-- pr-gate:report -->",
    "<PINNED_SHA>",
    "pull_request:",
  ]) {
    assert.ok(forgejo.includes(needle), `forgejo template is missing: ${needle}`);
  }
  // Forgejo ignores the `permissions` job key (its own docs), so the
  // template must not carry one as a YAML key. The word may appear in
  // explanatory comments only.
  assert.ok(!/^\s+permissions:/m.test(forgejo), "forgejo template must not set a permissions key");
  assert.ok(!forgejo.includes("secrets.GITEA_TOKEN"), "forgejo template must not rely on the Gitea token secret");
});

test("package.json wires the collector bin to the built file", () => {
  const pkg = JSON.parse(readPkgFile("package.json")) as { bin: Record<string, string> };
  assert.equal(pkg.bin["solvelang-forge-receipt"], "dist/packages/pr-gate/src/forge-receipt.js");
  assert.ok(
    existsSync(path.join(pkgDir, "dist", "packages", "pr-gate", "src", "forge-receipt.js")),
    "the built collector must exist at the bin path (tests run after the build)",
  );
});

test("README documents the collector and both templates with doc citations", () => {
  const readme = readPkgFile("README.md");
  for (const needle of [
    "solvelang-forge-receipt",
    "workflow-template.gitea.yml",
    "workflow-template.forgejo.yml",
    "https://docs.gitea.com/usage/actions/comparison",
    "https://docs.gitea.com/usage/actions/token-permissions",
    "https://forgejo.org/docs/latest/user/actions/github-actions/",
    "https://forgejo.org/docs/latest/user/actions/reference/",
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

test("collector output keeps the ChangeImpactReceiptInput field contract", async () => {
  const payloads: Record<string, unknown> = {
    "pulls/3": {
      number: 3, title: "pin", html_url: "http://forge.test/o/r/pulls/3", state: "open", draft: true,
      user: { login: "o" }, created_at: "2026-11-24T00:00:00Z", updated_at: "2026-11-24T01:00:00Z",
      head: { ref: "feat", sha: "cccccccccccccccccccccccccccccccccccccccc" },
      base: { ref: "main", sha: "dddddddddddddddddddddddddddddddddddddddd" },
      mergeable: false, changed_files: 1, additions: 2, deletions: 1,
    },
    "pulls/3/files": [{ filename: "a.ts", status: "modified", additions: 2, deletions: 1 }],
    "pulls/3/reviews": [],
    "pulls/3/commits": [{ sha: "c1" }],
    "commits/cccccccccccccccccccccccccccccccccccccccc/status": { state: "success", statuses: [{ context: "ci", state: "success" }] },
    "compare/main...feat": { total_commits: 1 },
    "compare/feat...main": { total_commits: 0 },
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://forge.test");
    const rest = url.pathname.split("/").filter(Boolean).slice(5).join("/");
    const body = payloads[rest];
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { message: "unhandled" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("stub server has no port");
    const input = await collectForgeReceiptInput({
      baseUrl: `http://127.0.0.1:${address.port}`,
      owner: "o",
      repo: "r",
      pr: 3,
      platform: "forgejo",
    });
    assert.deepEqual(Object.keys(input).sort(), EXPECTED_INPUT_KEYS);
    assert.deepEqual(Object.keys(input.pr).sort(), EXPECTED_PR_KEYS);
    assert.equal(typeof input.pr.mergeable, "boolean");
    assert.equal(input.pr.mergeableState, "dirty");
    assert.equal(input.pr.draft, true);
    assert.deepEqual(input.compare, { status: "ahead", aheadBy: 1, behindBy: 0 });
    for (const file of input.files) {
      assert.deepEqual(Object.keys(file).sort(), ["additions", "deletions", "filename", "status"]);
    }
    for (const run of input.checkRuns) {
      assert.deepEqual(Object.keys(run).sort(), ["conclusion", "name", "status"]);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the receipt core still declares the contract the collector mirrors", () => {
  const receiptCore = readFileSync(path.join(repoRoot, "site", "app", "change-impact-receipt", "core", "receipt.ts"), "utf8");
  assert.ok(receiptCore.includes("ChangeImpactReceiptInput"), "receipt core must keep the input type");
  for (const field of EXPECTED_PR_KEYS) {
    assert.ok(receiptCore.includes(`${field}:`), `receipt core no longer declares pr.${field}`);
  }
  assert.ok(receiptCore.includes('schema: "solvelang.change-impact-receipt.v1"'));
});
