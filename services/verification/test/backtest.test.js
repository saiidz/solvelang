// Slice 2 root pins: the backtest's pure classification, summary
// math, and job flow. The classification definitions are published
// (methodology page), so these pins are the contract: a catch needs
// executed or latest-state evidence, superseded failures are
// false-block candidates and never catches, and a missing PR Gate
// route is evidence-incomplete, never a catch.
import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKTEST_DEFINITIONS,
  classifyBacktestPr,
  createBacktestJobs,
  isValidRepoSlug,
  latestRunsByName,
  summarizeBacktest,
} from "../src/backtest.js";

const OWN = "SolveLang Verification";

function run(overrides = {}) {
  return {
    id: 1,
    name: "tests",
    status: "completed",
    conclusion: "success",
    startedAt: "2026-11-20T10:00:00Z",
    completedAt: "2026-11-20T10:05:00Z",
    ...overrides,
  };
}

const GATE_RAN_OK = {
  status: "ran",
  summary: { policyPassed: true, integrityVerified: true, policyVerdicts: [] },
};
const MERGED = "2026-11-20T12:00:00Z";

test("slug validation accepts GitHub shapes and rejects traversal", () => {
  assert.equal(isValidRepoSlug("saiidz", "solvelang"), true);
  assert.equal(isValidRepoSlug("some-org", "repo.name_1-2"), true);
  assert.equal(isValidRepoSlug("bad owner", "repo"), false);
  assert.equal(isValidRepoSlug("owner", ".."), false);
  assert.equal(isValidRepoSlug("owner", "a/b"), false);
  assert.equal(isValidRepoSlug("", "repo"), false);
});

test("latestRunsByName keeps the most recent run per check name", () => {
  const older = run({ id: 1, conclusion: "failure", completedAt: "2026-11-20T10:05:00Z" });
  const newer = run({ id: 2, conclusion: "success", completedAt: "2026-11-20T10:20:00Z" });
  const latest = latestRunsByName([older, newer]);
  assert.equal(latest.get("tests").id, 2);
});

test("a failing latest check run is a catch", () => {
  const result = classifyBacktestPr({
    gateRoute: GATE_RAN_OK,
    rawCheckRuns: [run({ conclusion: "failure" })],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, true);
  assert.equal(result.falseBlockCandidate, false);
  assert.match(result.catchReasons[0], /Head CI check "tests" failed/);
});

test("the service's own check runs never count as CI evidence", () => {
  const result = classifyBacktestPr({
    gateRoute: GATE_RAN_OK,
    rawCheckRuns: [run({ name: OWN, conclusion: "failure" })],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, false);
  assert.equal(result.catchReasons.length, 0);
});

test("a superseded failure is a false-block candidate, not a catch", () => {
  const failed = run({ id: 1, conclusion: "failure", completedAt: "2026-11-20T10:05:00Z" });
  const rerun = run({ id: 2, conclusion: "success", startedAt: "2026-11-20T10:10:00Z", completedAt: "2026-11-20T10:15:00Z" });
  const result = classifyBacktestPr({
    gateRoute: GATE_RAN_OK,
    rawCheckRuns: [failed, rerun],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, false);
  assert.equal(result.falseBlockCandidate, true);
  assert.match(result.falseBlockReasons[0], /re-run succeeded before the merge/);
});

test("a re-run that succeeded only after the merge does not excuse the head", () => {
  const failed = run({ id: 1, conclusion: "failure", completedAt: "2026-11-20T10:05:00Z" });
  const lateRerun = run({ id: 2, conclusion: "success", startedAt: "2026-11-20T13:00:00Z", completedAt: "2026-11-20T13:05:00Z" });
  const result = classifyBacktestPr({
    gateRoute: GATE_RAN_OK,
    rawCheckRuns: [failed, lateRerun],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  // The replay cuts the evidence at mergedAt: at merge time the
  // head's latest completed state was the failure, so it is a catch,
  // and the post-merge success is not a pre-merge supersession.
  assert.equal(result.catch, true);
  assert.equal(result.falseBlockCandidate, false);
});

test("a missing PR Gate route is evidence-incomplete, never a catch", () => {
  const result = classifyBacktestPr({
    gateRoute: { status: "not-run" },
    rawCheckRuns: [run()],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, false);
  assert.equal(result.evidenceIncomplete, true);
});

test("an executed PR Gate policy failure is a catch", () => {
  const result = classifyBacktestPr({
    gateRoute: {
      status: "ran",
      summary: {
        policyPassed: false,
        integrityVerified: true,
        policyVerdicts: [{ rule: "no-large-change", status: "fail" }],
      },
    },
    rawCheckRuns: [run()],
    requiredChecks: [],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, true);
  assert.match(result.catchReasons[0], /PR Gate policy failed: no-large-change/);
});

test("a config-named required check that is absent is a catch", () => {
  const result = classifyBacktestPr({
    gateRoute: GATE_RAN_OK,
    rawCheckRuns: [run()],
    requiredChecks: ["security-scan"],
    ownCheckName: OWN,
    mergedAt: MERGED,
  });
  assert.equal(result.catch, true);
  assert.match(result.catchReasons[0], /Required check not present/);
});

test("summary math: unverified share is over graded findings only", () => {
  const summary = summarizeBacktest([
    { graded: true, grading: { verified: 6, failed: 1, unverified: 1 }, classification: { catch: true, falseBlockCandidate: false, evidenceIncomplete: false } },
    { graded: true, grading: { verified: 5, failed: 2, unverified: 1 }, classification: { catch: false, falseBlockCandidate: true, evidenceIncomplete: true } },
    { graded: false, error: "github_rate_limited" },
  ]);
  assert.equal(summary.prsRequested, 3);
  assert.equal(summary.prsGraded, 2);
  assert.equal(summary.prsErrored, 1);
  assert.equal(summary.catches, 1);
  assert.equal(summary.falseBlockCandidates, 1);
  assert.equal(summary.evidenceIncomplete, 1);
  assert.deepEqual(summary.findings, { verified: 11, failed: 3, unverified: 2 });
  assert.equal(summary.unverifiedShare, 2 / 16);
});

test("definitions are published verbatim and frozen", () => {
  assert.match(BACKTEST_DEFINITIONS.catch, /blocking rules/);
  assert.match(BACKTEST_DEFINITIONS.evidenceIncomplete, /missing evidence is not evidence/i);
});

// --- Job flow with fakes ---

function memoryStore() {
  const jobs = new Map();
  return {
    async put(job) { jobs.set(job.id, JSON.parse(JSON.stringify(job))); },
    async get(id) { return jobs.get(id) ?? null; },
    async getCached() { return null; },
  };
}

async function waitFor(predicate, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

test("job flow: public repo grades its merged PRs into a report", async () => {
  const store = memoryStore();
  const reader = {
    async getRepo() { return { private: false }; },
    async listMergedPrs() {
      return [
        { number: 7, title: "t", url: "u", headSha: "abc", baseSha: "def", mergedAt: MERGED },
      ];
    },
  };
  const grader = {
    async gradePr({ pr }) {
      return {
        pr: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt, headSha: pr.headSha,
        graded: true,
        grading: { verified: 4, failed: 1, unverified: 1 },
        classification: { catch: true, catchReasons: ["x"], falseBlockCandidate: false, falseBlockReasons: [], evidenceIncomplete: false, incompleteReasons: [] },
      };
    },
  };
  const jobs = createBacktestJobs({
    store, reader, grader, makeId: () => "bt_test1", now: () => new Date("2026-11-28T00:00:00Z"),
  });
  const started = await jobs.start({ owner: "o", repo: "r", count: 10 });
  assert.equal(started.status, "running");
  const done = await waitFor(async () => (await jobs.get("bt_test1"))?.status === "complete");
  assert.equal(done, true);
  const job = await jobs.get("bt_test1");
  assert.equal(job.report.summary.catches, 1);
  assert.equal(job.report.summary.unverifiedShare, 1 / 6);
  assert.equal(job.report.schema, "solvelang.verification-backtest.v1");
});

test("job flow: a private or missing repo ends in a plain error state", async () => {
  const store = memoryStore();
  const reader = {
    async getRepo() { return { private: true }; },
    async listMergedPrs() { throw new Error("must not be called"); },
  };
  const jobs = createBacktestJobs({
    store, reader, grader: { async gradePr() { throw new Error("must not be called"); } },
    makeId: () => "bt_test2", now: () => new Date("2026-11-28T00:00:00Z"),
  });
  await jobs.start({ owner: "o", repo: "secret", count: 10 });
  const done = await waitFor(async () => (await jobs.get("bt_test2"))?.status === "error");
  assert.equal(done, true);
  assert.equal((await jobs.get("bt_test2")).error, "repository_not_public_or_not_found");
});
