// QA pins for Slice 2 backtest edges the root suite does not cover:
// the file store's 24h cache, rate-limit degradation inside a job,
// and the grader's gate-failure path (missing gate evidence grades
// as evidence-incomplete, never as a catch).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BacktestError,
  createBacktestGrader,
  createBacktestJobs,
  createFileBacktestStore,
} from "../src/backtest.js";

test("file store: a completed report is cached per repo for 24h", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "backtest-store-"));
  try {
    const store = createFileBacktestStore({ dir });
    const job = {
      id: "bt_cache1",
      key: "o/r#10",
      repo: "o/r",
      count: 10,
      status: "complete",
      startedAt: "2026-11-28T00:00:00Z",
      completedAt: "2026-11-28T00:01:00Z",
      error: null,
      report: {
        schema: "solvelang.verification-backtest.v1",
        id: "bt_cache1",
        repo: "o/r",
        generatedAt: "2026-11-28T00:01:00Z",
        entries: [],
        summary: {},
      },
    };
    await store.put(job);
    const fresh = await store.getCached("o/r#10", 24 * 60 * 60_000, new Date("2026-11-28T12:00:00Z"));
    assert.equal(fresh.id, "bt_cache1");
    const stale = await store.getCached("o/r#10", 24 * 60 * 60_000, new Date("2026-11-30T00:00:00Z"));
    assert.equal(stale, null);
    assert.equal((await store.get("bt_cache1")).status, "complete");
    assert.equal(await store.get("../etc/passwd"), null);
    assert.equal(await store.get("bt_missing"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

function memoryStore() {
  const jobs = new Map();
  return {
    async put(job) { jobs.set(job.id, JSON.parse(JSON.stringify(job))); },
    async get(id) { return jobs.get(id) ?? null; },
    async getCached() { return null; },
  };
}

test("a mid-job GitHub rate limit degrades the remaining PRs, not the job", async () => {
  const store = memoryStore();
  let gradeCalls = 0;
  const reader = {
    async getRepo() { return { private: false }; },
    async listMergedPrs() {
      return [1, 2, 3].map((n) => ({
        number: n, title: `pr ${n}`, url: "u", headSha: `sha${n}`, baseSha: "base", mergedAt: "2026-11-20T12:00:00Z",
      }));
    },
  };
  const grader = {
    async gradePr() {
      gradeCalls += 1;
      throw new BacktestError("github_rate_limited", 403);
    },
  };
  const jobs = createBacktestJobs({
    store, reader, grader, makeId: () => "bt_rl1", now: () => new Date("2026-11-28T00:00:00Z"),
  });
  await jobs.start({ owner: "o", repo: "r", count: 10 });
  const done = await waitFor(async () => (await jobs.get("bt_rl1"))?.status === "complete");
  assert.equal(done, true);
  const job = await jobs.get("bt_rl1");
  assert.equal(job.report.rateLimited, true);
  assert.equal(job.report.summary.prsGraded, 0);
  assert.equal(job.report.summary.prsErrored, 3);
  assert.equal(gradeCalls, 1);
  assert.ok(job.report.entries.every((entry) => entry.error === "github_rate_limited"));
});

test("grader: a failed tree/gate route grades as evidence-incomplete", async () => {
  let collectorOptions = null;
  const grader = createBacktestGrader({
    reader: {
      async getConfigText() { return null; },
      async listChangedFiles() { return ["src/a.js"]; },
      async listRawCheckRuns() {
        return [
          { id: 1, name: "tests", status: "completed", conclusion: "success", startedAt: "2026-11-20T10:00:00Z", completedAt: "2026-11-20T10:05:00Z" },
        ];
      },
    },
    collectReceiptInput: async (options) => {
      collectorOptions = options;
      return { prGate: { status: "not-run" } };
    },
    buildReceipt: () => ({ grading: { verified: 1, failed: 0, unverified: 2 } }),
    runGate: async () => { throw new Error("must not run without a tree"); },
    fetchTree: async () => { throw new BacktestError("tree_download_failed", 0); },
    workRoot: os.tmpdir(),
    matchGlob: () => false,
    ownCheckName: "SolveLang Verification",
  });
  const entry = await grader.gradePr({
    owner: "o",
    repo: "r",
    pr: { number: 5, title: "t", url: "u", headSha: "headsha123456", baseSha: "base", mergedAt: "2026-11-20T12:00:00Z" },
  });
  assert.equal(collectorOptions.gateResultPath, undefined);
  assert.equal(entry.graded, true);
  assert.deepEqual(entry.grading, { verified: 1, failed: 0, unverified: 2 });
  assert.equal(entry.classification.catch, false);
  assert.equal(entry.classification.evidenceIncomplete, true);
});
