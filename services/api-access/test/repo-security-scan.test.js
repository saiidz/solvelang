import assert from "node:assert/strict";
import test from "node:test";

import { analyzeWorkflowFile, createRepoSecurityScan, isValidRepoSlug } from "../src/repo-security-scan.js";

const silent = { info() {} };

function jsonResponse(status, body) {
  return { status, json: async () => body, headers: { get: () => null } };
}

const WORKFLOW_CI = [
  "name: CI",
  "on: [push]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  "      - uses: github/codeql-action/init@v3",
  "      - run: npm test",
  "",
].join("\n");

const WORKFLOW_RISKY = [
  "name: Triage",
  "on:",
  "  pull_request_target:",
  "jobs:",
  "  triage:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "      - run: echo \"${{ github.event.issue.title }}\"",
  "",
].join("\n");

function fixtureFetch(calls) {
  const tree = {
    truncated: false,
    tree: [
      { type: "blob", path: "SECURITY.md" },
      { type: "blob", path: ".github/dependabot.yml" },
      { type: "blob", path: ".github/workflows/ci.yml" },
      { type: "blob", path: ".github/workflows/triage.yml" },
      { type: "blob", path: "src/index.js" },
    ],
  };
  const contents = {
    ".github/workflows/ci.yml": WORKFLOW_CI,
    ".github/workflows/triage.yml": WORKFLOW_RISKY,
  };
  return async (url) => {
    calls.push(url);
    if (url.endsWith("/repos/acme/widgets")) {
      return jsonResponse(200, { default_branch: "main", archived: false, license: { spdx_id: "MIT" }, html_url: "https://github.com/acme/widgets" });
    }
    if (url.includes("/git/trees/")) return jsonResponse(200, tree);
    if (url.includes("/contents/")) {
      const match = Object.entries(contents).find(([key]) => url.includes("/contents/" + key + "?"));
      const file = match ? match[1] : "";
      return jsonResponse(200, { content: Buffer.from(file, "utf8").toString("base64") });
    }
    if (url.includes("/branches/")) return jsonResponse(404, { message: "Not Found" });
    return jsonResponse(404, { message: "Not Found" });
  };
}

function scanRequest(scan, body = { owner: "acme", repo: "widgets" }, source = "203.0.113.7") {
  return scan.handle({ method: "POST", bodyText: JSON.stringify(body), source });
}

test("disabled scan refuses with 503 before any work", async () => {
  let fetches = 0;
  const scan = createRepoSecurityScan({ enabled: false, logger: silent, fetchImpl: async () => { fetches += 1; throw new Error("must not fetch"); } });
  const outcome = await scanRequest(scan);
  assert.equal(outcome.statusCode, 503);
  assert.equal(outcome.body.error.code, "security_scan_disabled");
  assert.equal(fetches, 0);
});

test("non-POST is refused and bad input is rejected", async () => {
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl: fixtureFetch([]) });
  assert.equal((await scan.handle({ method: "GET", bodyText: "{}", source: "x" })).statusCode, 405);
  assert.equal((await scan.handle({ method: "POST", bodyText: "not json", source: "x" })).statusCode, 400);
  const bad = await scanRequest(scan, { owner: "acme/widgets", repo: "x" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error.code, "invalid_repo");
  assert.equal(isValidRepoSlug("acme", "wid.gets_1-2"), true);
  assert.equal(isValidRepoSlug("-acme", "widgets"), false);
  assert.equal(isValidRepoSlug("acme", ".."), false);
});

test("a missing or private repository answers 404 with the plain reason", async () => {
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl: async () => jsonResponse(404, { message: "Not Found" }) });
  const outcome = await scanRequest(scan, { owner: "acme", repo: "secret" });
  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.error.code, "repo_not_found");
  assert.match(outcome.body.error.message, /public repositories only/);
});

test("a full scan labels every finding and never produces a score", async () => {
  const calls = [];
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl: fixtureFetch(calls) });
  const outcome = await scanRequest(scan);
  assert.equal(outcome.statusCode, 200);
  const report = outcome.body.scan;
  assert.equal(report.schema, "solvelang.repo-security-scan.v1");
  assert.equal(report.repo, "acme/widgets");
  assert.equal(report.cached, false);

  const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
  assert.equal(byId["security-policy"].label, "verified");
  assert.match(byId["security-policy"].text, /SECURITY\.md/);
  assert.equal(byId["dependency-automation"].label, "verified");
  assert.match(byId["dependency-automation"].text, /Dependabot/);
  assert.equal(byId["license"].label, "verified");
  assert.match(byId["license"].text, /MIT/);
  assert.equal(byId["code-scanning"].label, "verified");
  assert.match(byId["code-scanning"].text, /CodeQL/);
  assert.equal(byId["action-pinning"].label, "verified");
  assert.match(byId["action-pinning"].text, /1 of 3 action references are pinned/);
  assert.equal(byId["token-permissions"].label, "verified");
  assert.match(byId["token-permissions"].text, /1 of 2 workflow files/);
  assert.equal(byId["script-injection"].label, "verified");
  assert.match(byId["script-injection"].text, /github\.event\.issue\.title/);
  assert.equal(byId["pr-target-checkout"].label, "verified");
  assert.match(byId["pr-target-checkout"].text, /pull_request_target/);
  assert.equal(byId["branch-protection"].label, "unverified");
  assert.equal(byId["security-features"].label, "unverified");

  for (const item of report.findings) {
    assert.ok(["verified", "failed", "unverified"].includes(item.label), item.id);
    assert.ok(item.provenance.length > 0, item.id);
    assert.ok(!/risk|score|grade [a-f]/i.test(item.text), item.id);
  }
  assert.equal(report.grading.falseVerifiedLabel, false);
  assert.equal(report.grading.verified + report.grading.failed + report.grading.unverified, report.findings.length);
});

test("repeat scans are served from cache and say so", async () => {
  const calls = [];
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl: fixtureFetch(calls) });
  await scanRequest(scan);
  const countAfterFirst = calls.length;
  const second = await scanRequest(scan);
  assert.equal(second.body.scan.cached, true);
  assert.equal(calls.length, countAfterFirst);
});

test("the per-source rate limit refuses the 61st call in a window", async () => {
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl: fixtureFetch([]), rateLimit: { limit: 60, windowMs: 60_000 } });
  for (let i = 0; i < 60; i += 1) {
    assert.equal((await scanRequest(scan)).statusCode, 200);
  }
  const limited = await scanRequest(scan);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.code, "rate_limited");
});

test("a failed tree read labels the tree-based checks failed, never drops them", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/acme/widgets")) return jsonResponse(200, { default_branch: "main", archived: false, license: null, html_url: "https://github.com/acme/widgets" });
    if (url.includes("/git/trees/")) return jsonResponse(403, { message: "API rate limit exceeded" });
    if (url.includes("/branches/")) return jsonResponse(404, { message: "Not Found" });
    return jsonResponse(404, { message: "Not Found" });
  };
  const scan = createRepoSecurityScan({ enabled: true, logger: silent, fetchImpl });
  const outcome = await scanRequest(scan);
  assert.equal(outcome.statusCode, 200);
  const byId = Object.fromEntries(outcome.body.scan.findings.map((f) => [f.id, f]));
  assert.equal(byId["security-policy"].label, "failed");
  assert.equal(byId["dependency-automation"].label, "failed");
  assert.equal(byId["workflow-checks"].label, "failed");
  assert.equal(outcome.body.scan.grading.failed, 3);
});

test("analyzeWorkflowFile counts pins and finds injection sites", () => {
  const ci = analyzeWorkflowFile("ci.yml", WORKFLOW_CI);
  assert.equal(ci.usesRefs, 2);
  assert.equal(ci.pinnedRefs, 1);
  assert.equal(ci.declaresPermissions, true);
  assert.deepEqual(ci.scanners, ["CodeQL"]);
  assert.equal(ci.injectionSites.length, 0);

  const risky = analyzeWorkflowFile("triage.yml", WORKFLOW_RISKY);
  assert.equal(risky.pullRequestTargetCheckout, true);
  assert.equal(risky.injectionSites.length, 1);
  assert.equal(risky.injectionSites[0].context, "github.event.issue.title");
});
