import assert from "node:assert/strict";
import test from "node:test";

import { classifyJobOs, computeBillCheck, createCiBillCheck, jobSeconds, normalizeCampaignTag } from "../src/ci-bill-check.js";

const silent = { info() {} };

function jsonResponse(status, body) {
  return { status, json: async () => body, headers: { get: () => null } };
}

function job(id, labels, started, completed) {
  return { id, labels, started_at: started, completed_at: completed };
}

const RUNS = {
  total_count: 2,
  workflow_runs: [
    { id: 101, run_started_at: "2026-11-20T10:00:00Z", created_at: "2026-11-20T10:00:00Z" },
    { id: 102, run_started_at: "2026-11-21T10:00:00Z", created_at: "2026-11-21T10:00:00Z" },
  ],
};

const JOBS = {
  101: {
    total_count: 3,
    jobs: [
      job(1, ["ubuntu-latest"], "2026-11-20T10:00:00Z", "2026-11-20T10:00:23Z"), // 23s linux
      job(2, ["windows-latest"], "2026-11-20T10:00:00Z", "2026-11-20T10:01:01Z"), // 61s windows
      job(3, ["self-hosted", "linux"], "2026-11-20T10:00:00Z", "2026-11-20T10:05:00Z"), // self-hosted
    ],
  },
  102: {
    total_count: 2,
    jobs: [
      job(4, ["ubuntu-24.04"], "2026-11-21T10:00:00Z", "2026-11-21T10:02:00Z"), // 120s linux
      job(5, ["macos-latest"], "2026-11-21T10:00:00Z", "2026-11-21T10:00:05Z"), // 5s macos
    ],
  },
};

function fixtureFetch(calls) {
  return async (url) => {
    calls.push(url);
    if (url.endsWith("/repos/acme/widgets")) return jsonResponse(200, { default_branch: "main", html_url: "https://github.com/acme/widgets" });
    if (url.includes("/actions/runs?")) return jsonResponse(200, RUNS);
    const jobsMatch = url.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (jobsMatch) return jsonResponse(200, JOBS[Number(jobsMatch[1])]);
    return jsonResponse(404, { message: "Not Found" });
  };
}

function checkRequest(check, body = { owner: "acme", repo: "widgets" }, source = "203.0.113.7") {
  return check.handle({ method: "POST", bodyText: JSON.stringify(body), source });
}

test("classifyJobOs reads runner labels the way GitHub reports them", () => {
  assert.equal(classifyJobOs(["ubuntu-latest"]), "linux");
  assert.equal(classifyJobOs(["ubuntu-24.04-arm"]), "linux");
  assert.equal(classifyJobOs(["windows-2022"]), "windows");
  assert.equal(classifyJobOs(["macos-14"]), "macos");
  assert.equal(classifyJobOs(["self-hosted", "ubuntu-latest"]), "self-hosted");
  assert.equal(classifyJobOs(["buildjet-2vcpu-ubuntu-2204"]), "unknown");
  assert.equal(classifyJobOs([]), "unknown");
  assert.equal(classifyJobOs(undefined), "unknown");
});

test("jobSeconds measures start to finish and refuses bad stamps", () => {
  assert.equal(jobSeconds({ started_at: "2026-11-20T10:00:00Z", completed_at: "2026-11-20T10:00:23Z" }), 23);
  assert.equal(jobSeconds({ started_at: "2026-11-20T10:00:23Z", completed_at: "2026-11-20T10:00:00Z" }), null);
  assert.equal(jobSeconds({ started_at: null, completed_at: "2026-11-20T10:00:00Z" }), null);
});

test("computeBillCheck rounds GitHub-style per job and meters SolveLang-style per second", () => {
  const totals = computeBillCheck([
    { os: "linux", seconds: 23 },   // GitHub: 1 min x $0.008; SolveLang: 23s
    { os: "linux", seconds: 120 },  // GitHub: 2 min x $0.008; SolveLang: 120s
    { os: "linux", seconds: 5 },    // GitHub: 1 min; SolveLang: 10s minimum
    { os: "windows", seconds: 61 }, // GitHub: 2 min x $0.016
    { os: "macos", seconds: 5 },    // GitHub: 1 min x $0.08
    { os: "self-hosted", seconds: 300 },
    { os: "unknown", seconds: 300 },
    { os: "linux", seconds: null },
  ]);
  assert.equal(totals.measuredJobs, 5);
  assert.equal(totals.selfHostedJobs, 1);
  assert.equal(totals.unknownOsJobs, 1);
  assert.equal(totals.unmeasuredJobs, 1);
  assert.equal(totals.byOs.linux.githubMinutes, 4);
  assert.equal(totals.byOs.linux.githubUsd, 0.03); // 4 x 0.008 = 0.032 -> 0.03
  assert.equal(totals.byOs.windows.githubUsd, 0.03); // 2 x 0.016 = 0.032 -> 0.03
  assert.equal(totals.byOs.macos.githubUsd, 0.08);
  assert.equal(totals.solvelangModel.linuxSecondsBilled, 153); // 23 + 120 + 10
  assert.equal(totals.solvelangModel.linuxUsd, 0.01); // 153/60 x 0.004 = 0.0102 -> 0.01
  assert.equal(totals.linuxDifferenceUsd, 0.02); // 0.032 - 0.0102 = 0.0218 -> 0.02
});

test("disabled check refuses with 503 before any work", async () => {
  const check = createCiBillCheck({ enabled: false, logger: silent, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const outcome = await checkRequest(check);
  assert.equal(outcome.statusCode, 503);
  assert.equal(outcome.body.error.code, "ci_bill_check_disabled");
});

test("a full check prices the sampled runs from real job times", async () => {
  const calls = [];
  const check = createCiBillCheck({ enabled: true, logger: silent, fetchImpl: fixtureFetch(calls) });
  const outcome = await checkRequest(check);
  assert.equal(outcome.statusCode, 200);
  const body = outcome.body.check;
  assert.equal(body.schema, "solvelang.ci-bill-check.v1");
  assert.equal(body.availability, "ok");
  assert.equal(body.sample.runs, 2);
  assert.equal(body.sample.jobs, 5);
  assert.equal(body.sample.selfHostedJobs, 1);
  assert.equal(body.sample.windowFrom, "2026-11-20T10:00:00Z");
  assert.equal(body.sample.windowTo, "2026-11-21T10:00:00Z");
  // Linux: 23s + 120s -> GitHub 1 + 2 = 3 min; SolveLang 143s.
  assert.equal(body.totals.byOs.linux.githubMinutes, 3);
  assert.equal(body.totals.solvelangModel.linuxSecondsBilled, 143);
  assert.match(body.modelStatement, /does not charge for standard runners on public repositories/);
  assert.match(body.rates.provenance, /About billing for GitHub Actions/);
});

test("no completed runs is data unavailable, stated plainly, with no totals", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/acme/widgets")) return jsonResponse(200, { default_branch: "main" });
    if (url.includes("/actions/runs?")) return jsonResponse(200, { total_count: 0, workflow_runs: [] });
    return jsonResponse(404, { message: "Not Found" });
  };
  const check = createCiBillCheck({ enabled: true, logger: silent, fetchImpl });
  const outcome = await checkRequest(check);
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.check.availability, "unavailable");
  assert.match(outcome.body.check.statement, /^Data unavailable:/);
  assert.equal(outcome.body.check.totals, null);
});

test("a failed runs read is labeled failed, never estimated over", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/repos/acme/widgets")) return jsonResponse(200, { default_branch: "main" });
    if (url.includes("/actions/runs?")) return jsonResponse(403, { message: "API rate limit exceeded" });
    return jsonResponse(404, { message: "Not Found" });
  };
  const check = createCiBillCheck({ enabled: true, logger: silent, fetchImpl });
  const outcome = await checkRequest(check);
  assert.equal(outcome.body.check.availability, "failed");
  assert.equal(outcome.body.check.totals, null);
  assert.equal(outcome.body.check.routes.at(-1).status, "failed");
});

test("a missing or private repository answers 404 with the plain reason", async () => {
  const check = createCiBillCheck({ enabled: true, logger: silent, fetchImpl: async () => jsonResponse(404, { message: "Not Found" }) });
  const outcome = await checkRequest(check, { owner: "acme", repo: "secret" });
  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.error.code, "repo_not_found");
});

test("repeat checks are served from cache and say so", async () => {
  const calls = [];
  const check = createCiBillCheck({ enabled: true, logger: silent, fetchImpl: fixtureFetch(calls) });
  await checkRequest(check);
  const after = calls.length;
  const second = await checkRequest(check);
  assert.equal(second.body.check.cached, true);
  assert.equal(calls.length, after);
});

test("normalizeCampaignTag keeps slug-shaped tags and drops everything else", () => {
  assert.equal(normalizeCampaignTag("minutes-cost"), "minutes-cost");
  assert.equal(normalizeCampaignTag("  pricing-compared  "), "pricing-compared");
  assert.equal(normalizeCampaignTag("bad campaign!"), null);
  assert.equal(normalizeCampaignTag(""), null);
  assert.equal(normalizeCampaignTag("x".repeat(65)), null);
  assert.equal(normalizeCampaignTag(undefined), null);
  assert.equal(normalizeCampaignTag(42), null);
});

test("a completed check is logged with the landing campaign tag", async () => {
  const records = [];
  const logger = { info(record) { records.push(record); } };
  const calls = [];
  const check = createCiBillCheck({ enabled: true, logger, fetchImpl: fixtureFetch(calls) });
  const outcome = await checkRequest(check, { owner: "acme", repo: "widgets", campaign: "minutes-cost" });
  assert.equal(outcome.statusCode, 200);
  const served = records.find((record) => record.outcome === "served");
  assert.equal(served.campaign, "minutes-cost");
  assert.equal(served.repo, "acme/widgets");
  // A cached repeat is a completion too and carries the tag as well.
  const second = await checkRequest(check, { owner: "acme", repo: "widgets", campaign: "minutes-cost" });
  assert.equal(second.body.check.cached, true);
  assert.equal(records.find((record) => record.outcome === "served_cached").campaign, "minutes-cost");
});

test("an invalid or absent campaign leaves the log record in its original shape", async () => {
  const records = [];
  const logger = { info(record) { records.push(record); } };
  const calls = [];
  const check = createCiBillCheck({ enabled: true, logger, fetchImpl: fixtureFetch(calls) });
  await checkRequest(check, { owner: "acme", repo: "widgets", campaign: "bad campaign!" });
  await checkRequest(check, { owner: "acme", repo: "widgets" });
  assert.ok(records.length > 0);
  for (const record of records) assert.ok(!("campaign" in record), "untagged calls log no campaign field");
});
