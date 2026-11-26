// SolveLang PR Gate — QA pins for the GitHub receipt collector.
//
// These pins lock the cross-file contract the verification product
// depends on:
//   - the collector's emitted JSON keeps the exact field contract of
//     ChangeImpactReceiptInput in
//     site/app/change-impact-receipt/core/receipt.ts, and the site's
//     own builder consumes the collector's output unmodified;
//   - GitHub vocabulary passes through untranslated (mergeable_state,
//     check conclusions, review states) — the receipt builder was
//     written against this API's words, so any "helpful" translation
//     here would falsify evidence;
//   - mergeable is re-read while GitHub computes it, and a null that
//     never resolves stays null (labeled unverified downstream);
//   - compare is the only section allowed to degrade to null; every
//     other unreadable section is an operational error;
//   - package.json wires the collector bin to the built file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectGithubReceiptInput,
  mapGithubCheckRun,
  mapGithubCompare,
  mapGithubPullRequest,
  mapGithubReview,
  parseGithubReceiptArgs,
  GithubCollectError,
  type FetchLike,
} from "../src/github-receipt";
import { buildChangeImpactReceipt } from "../../../site/app/change-impact-receipt/core/receipt";

// The compiled test lives at packages/pr-gate/dist/packages/pr-gate/test,
// so four levels up is the package directory.
const pkgDir = path.resolve(__dirname, "..", "..", "..", "..");

const PR_BODY = {
  number: 7,
  title: "Fix the thing",
  html_url: "https://github.com/octo/widgets/pull/7",
  state: "open",
  draft: false,
  user: { login: "octo-dev" },
  created_at: "2026-11-26T10:00:00Z",
  updated_at: "2026-11-26T11:00:00Z",
  head: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ref: "fix-thing" },
  base: { ref: "main", sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  mergeable: true,
  mergeable_state: "unstable",
  changed_files: 2,
  additions: 10,
  deletions: 3,
  commits: 1,
};

function stubFetch(routes: Record<string, unknown>, seen?: { url: string; headers?: Record<string, string> }[]): FetchLike {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    if (seen) seen.push({ url, headers: init?.headers });
    // Longest needle wins: "/pulls/7/files" must beat "/pulls/7".
    for (const [needle, body] of Object.entries(routes).sort((a, b) => b[0].length - a[0].length)) {
      if (url.includes(needle)) {
        if (body instanceof Error) throw body;
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
      text: async () => "Not Found",
    };
  };
}

function fullRoutes(): Record<string, unknown> {
  return {
    "/pulls/7": PR_BODY,
    "/pulls/7/files": [
      { filename: "src/core.js", status: "modified", additions: 8, deletions: 3 },
      { filename: "README.md", status: "modified", additions: 2, deletions: 0 },
    ],
    "/check-runs": {
      total_count: 2,
      check_runs: [
        { name: "test", status: "completed", conclusion: "success" },
        { name: "lint", status: "completed", conclusion: "failure" },
      ],
    },
    "/pulls/7/reviews": [
      { user: { login: "reviewer-a" }, state: "APPROVED" },
      { user: { login: "reviewer-b" }, state: "PENDING" },
    ],
    "/compare/": { status: "diverged", ahead_by: 1, behind_by: 2 },
  };
}

test("GitHub vocabulary passes through untranslated", () => {
  const pr = mapGithubPullRequest(PR_BODY as never, "octo", "widgets");
  assert.equal(pr.mergeable, true);
  assert.equal(pr.mergeableState, "unstable");
  assert.equal(pr.changedFiles, 2);
  assert.equal(pr.author, "octo-dev");
  assert.deepEqual(mapGithubCheckRun({ name: "x", status: "in_progress", conclusion: null }), {
    name: "x",
    status: "in_progress",
    conclusion: null,
  });
  assert.equal(mapGithubReview({ user: { login: "a" }, state: "PENDING" }), null);
  assert.deepEqual(mapGithubReview({ user: { login: "a" }, state: "DISMISSED" }), {
    author: "a",
    state: "DISMISSED",
  });
  assert.deepEqual(mapGithubCompare({ status: "ahead", ahead_by: 3, behind_by: 0 }), {
    status: "ahead",
    aheadBy: 3,
    behindBy: 0,
  });
});

test("collection assembles the full receipt input and carries the token as a Bearer header", async () => {
  const seen: { url: string; headers?: Record<string, string> }[] = [];
  const input = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, token: "tok-123", mergeablePolls: 0 },
    stubFetch(fullRoutes(), seen)
  );
  assert.equal(input.pr.headSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(input.files.length, 2);
  assert.equal(input.checkRuns.length, 2);
  assert.equal(input.checkRuns[1].conclusion, "failure");
  assert.deepEqual(input.reviews, [{ author: "reviewer-a", state: "APPROVED" }]);
  assert.deepEqual(input.compare, { status: "diverged", aheadBy: 1, behindBy: 2 });
  assert.equal(input.prGate.status, "not-run");
  assert.ok(input.source.includes("api.github.com"));
  assert.ok(seen.length >= 5);
  for (const call of seen) {
    assert.equal(call.headers?.authorization, "Bearer " + "tok-123");
  }
  assert.ok(seen.some((call) => call.url.includes("/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs")));
});

test("the site's own receipt builder consumes the collected input unmodified", async () => {
  const input = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 0 },
    stubFetch(fullRoutes())
  );
  const receipt = buildChangeImpactReceipt(input as never);
  assert.equal(receipt.schema, "solvelang.change-impact-receipt.v1");
  assert.equal(receipt.grading.falseVerifiedLabel, false);
  // The failing lint check run must surface as a verified CI finding.
  const ciFinding = receipt.findings.find((finding) => finding.text.includes("CI has failing check run(s)"));
  assert.ok(ciFinding);
  assert.equal(ciFinding.label, "verified");
});

test("mergeable is re-read while null and stays null when it never resolves", async () => {
  let prReads = 0;
  const routes = fullRoutes();
  const fetchImpl: FetchLike = async (url, init) => {
    if (url.includes("/pulls/7") && !url.includes("/files") && !url.includes("/reviews")) {
      prReads += 1;
      const body = prReads < 2 ? { ...PR_BODY, mergeable: null, mergeable_state: "unknown" } : PR_BODY;
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    }
    return stubFetch(routes)(url, init);
  };
  const resolved = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7 },
    fetchImpl
  );
  assert.equal(resolved.pr.mergeable, true);
  assert.ok(prReads >= 2);

  const neverResolves: FetchLike = async (url, init) => {
    if (url.includes("/pulls/7") && !url.includes("/files") && !url.includes("/reviews")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...PR_BODY, mergeable: null, mergeable_state: "unknown" }),
        text: async () => "",
      };
    }
    return stubFetch(routes)(url, init);
  };
  const unresolved = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 1 },
    neverResolves
  );
  assert.equal(unresolved.pr.mergeable, null);
});

test("compare failure degrades to null; a files failure is an operational error", async () => {
  const routes = fullRoutes();
  routes["/compare/"] = new Error("boom");
  const input = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 0 },
    stubFetch(routes)
  );
  assert.equal(input.compare, null);

  const failing: FetchLike = async (url, init) => {
    if (url.includes("/files")) {
      return { ok: false, status: 500, json: async () => ({}), text: async () => "err" };
    }
    return stubFetch(fullRoutes())(url, init);
  };
  await assert.rejects(
    () =>
      collectGithubReceiptInput(
        { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 0 },
        failing
      ),
    GithubCollectError
  );
});

test("the PR Gate route embeds from a result file and fails honestly without one", async () => {
  const gatePath = path.join(tmpdir(), `gate-result-${process.pid}.json`);
  const gateResult = {
    schema: "solvelang.pr-gate.result.v1",
    graph: { integrityVerified: true, nodes: 12, edges: 9 },
    impact: { impactedNodes: 3, rootCount: 1, headline: "1 root impacts 3 nodes." },
    policy: { evaluation: { passed: false, verdicts: [{ rule: "protected-paths", status: "fail" }] } },
  };
  writeFileSync(gatePath, JSON.stringify(gateResult), "utf8");
  try {
    const input = await collectGithubReceiptInput(
      { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 0, gateResultPath: gatePath },
      stubFetch(fullRoutes())
    );
    assert.equal(input.prGate.status, "ran");
    if (input.prGate.status === "ran") {
      assert.equal(input.prGate.summary.policyPassed, false);
      assert.equal(input.prGate.summary.impactedNodes, 3);
    }
  } finally {
    rmSync(gatePath, { force: true });
  }
  const missing = await collectGithubReceiptInput(
    { baseUrl: "https://api.github.com", owner: "octo", repo: "widgets", pr: 7, mergeablePolls: 0, gateResultPath: "/nonexistent/result.json" },
    stubFetch(fullRoutes())
  );
  assert.equal(missing.prGate.status, "failed");
});

test("CLI parsing enforces required args and the bin is wired to the built file", () => {
  assert.throws(() => parseGithubReceiptArgs(["--owner", "octo"]), GithubCollectError);
  const parsed = parseGithubReceiptArgs(["--owner", "octo", "--repo", "widgets", "--pr", "7"]);
  assert.equal(parsed.baseUrl, "https://api.github.com");
  assert.equal(parsed.pr, 7);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    bin: Record<string, string>;
  };
  assert.equal(pkg.bin["solvelang-github-receipt"], "dist/packages/pr-gate/src/github-receipt.js");
  assert.ok(existsSync(path.join(pkgDir, "dist/packages/pr-gate/src/github-receipt.js")));
});
