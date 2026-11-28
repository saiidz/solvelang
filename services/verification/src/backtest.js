// Backtest — replay the verification grading over a public
// repository's most recent merged pull requests and report what the
// check would have found on each: the sales surface's proof engine
// and the demo's second data source. Read-only throughout: public
// repositories only, unauthenticated GitHub reads (the established
// public-tool pattern — rate-limited, cached), nothing is posted,
// commented, or changed anywhere.
//
// The grading is the product's own: the same GitHub receipt
// collector, the same receipt builder, the same PR Gate run on the
// head tree, and blocking rules aligned with src/verdict.js — with
// the repo's own .github/solvelang-verification.json (read at each
// PR's base SHA) supplying requiredChecks, exactly as a live run
// would read it. No check run is created and no audit record is
// written for a replay: it grades history, it does not act on it.
//
// Published definitions (the methodology page states them verbatim;
// they are also carried in every report's `definitions`):
//   catch — blocking evidence existed on the PR's head under the
//     product's blocking rules: the latest completed run of any of
//     the repo's own checks failed or timed out; a config-named
//     required check was absent, unfinished, or not successful; or
//     the executed PR Gate policy evaluation failed.
//   false-block candidate — no catch by latest state, but a failing
//     run on the head was superseded by a successful re-run of the
//     same check on the same head SHA that completed before the PR
//     merged: verification running between the failure and the
//     re-run would have blocked on superseded evidence.
//   evidence incomplete — the PR Gate route failed or did not run,
//     so blast-radius / policy evidence is missing. Never counted
//     as a catch: missing evidence is not evidence.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseVerificationConfig } from "./verdict.js";

const execFileAsync = promisify(execFile);

export const BACKTEST_SCHEMA = "solvelang.verification-backtest.v1";
export const BACKTEST_DEFAULT_COUNT = 10;
export const BACKTEST_MAX_COUNT = 10;
export const BACKTEST_CACHE_TTL_MS = 24 * 60 * 60_000;
export const BACKTEST_DEFINITIONS = Object.freeze({
  catch:
    "Blocking evidence existed on the PR's head under the product's blocking rules: the latest completed run of any of the repo's own checks failed or timed out; a check named as required in the repo's own verification config was absent, unfinished, or not successful; or the executed PR Gate policy evaluation failed.",
  falseBlockCandidate:
    "No catch by latest state, but a failing run on the head was superseded by a successful re-run of the same check on the same head SHA that completed before the PR merged — verification running between the failure and the re-run would have blocked on superseded evidence.",
  evidenceIncomplete:
    "The PR Gate route failed or did not run, so blast-radius and policy evidence is missing. Never counted as a catch: missing evidence is not evidence.",
});

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONFIG_PATH = ".github/solvelang-verification.json";
const POLICY_PATH = "pr-gate.policy.json";

export function isValidRepoSlug(owner, repo) {
  return (
    typeof owner === "string" &&
    typeof repo === "string" &&
    OWNER_PATTERN.test(owner) &&
    REPO_PATTERN.test(repo) &&
    repo !== "." &&
    repo !== ".."
  );
}

export class BacktestError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "BacktestError";
    this.code = code;
    this.status = status;
  }
}

// --- Classification (pure) ---

function runRecency(run) {
  const completed = Date.parse(run?.completedAt || "") || 0;
  const started = Date.parse(run?.startedAt || "") || 0;
  return { time: completed || started, id: run?.id ?? 0 };
}

export function latestRunsByName(rawRuns) {
  const byName = new Map();
  for (const run of rawRuns ?? []) {
    if (!run || typeof run.name !== "string" || run.name === "") continue;
    const prev = byName.get(run.name);
    if (!prev) {
      byName.set(run.name, run);
      continue;
    }
    const a = runRecency(run);
    const b = runRecency(prev);
    if (a.time > b.time || (a.time === b.time && a.id > b.id)) {
      byName.set(run.name, run);
    }
  }
  return byName;
}

export function classifyBacktestPr({
  gateRoute,
  rawCheckRuns,
  requiredChecks,
  ownCheckName,
  mergedAt,
}) {
  const catchReasons = [];
  const falseBlockReasons = [];
  const incompleteReasons = [];

  const mergedMs = Date.parse(mergedAt || "") || Number.POSITIVE_INFINITY;
  const others = (rawCheckRuns ?? []).filter(
    (run) => run && run.name !== ownCheckName
  );
  // The replay judges the head as it stood when the PR merged: runs
  // that only completed after the merge (a re-run someone fired
  // later) say nothing about the evidence verification would have
  // seen, so the latest-state view is cut at mergedAt.
  const atMerge = others.filter((run) => {
    const recency = runRecency(run);
    return recency.time === 0 || recency.time <= mergedMs;
  });
  const latest = latestRunsByName(atMerge);

  for (const run of latest.values()) {
    if (
      run.status === "completed" &&
      (run.conclusion === "failure" || run.conclusion === "timed_out")
    ) {
      catchReasons.push(
        `Head CI check "${run.name}" ${run.conclusion === "timed_out" ? "timed out" : "failed"} on the merged head.`
      );
    }
  }

  for (const name of requiredChecks ?? []) {
    const run = latest.get(name);
    if (!run) {
      catchReasons.push(`Required check not present on the head: ${name}.`);
    } else if (run.status !== "completed") {
      catchReasons.push(`Required check not completed: ${name} (${run.status}).`);
    } else if (run.conclusion !== "success") {
      catchReasons.push(
        `Required check not successful: ${name} (${run.conclusion ?? "no conclusion"}).`
      );
    }
  }

  if (gateRoute?.status === "failed") {
    incompleteReasons.push(
      "PR Gate route failed — blast-radius and policy evidence is unusable."
    );
  } else if (!gateRoute || gateRoute.status === "not-run") {
    incompleteReasons.push(
      "PR Gate route was not run — blast-radius evidence was not produced."
    );
  } else if (gateRoute.status === "ran") {
    const summary = gateRoute.summary;
    const failedRules = (summary?.policyVerdicts ?? [])
      .filter((verdict) => verdict.status === "fail")
      .map((verdict) => verdict.rule);
    if (summary && summary.policyPassed === false && failedRules.length > 0) {
      catchReasons.push(`PR Gate policy failed: ${failedRules.join(", ")}.`);
    }
    if (summary && summary.integrityVerified === false) {
      incompleteReasons.push(
        "Solve Graph integrity did not verify — the blast-radius output is not relied on."
      );
    }
  }

  for (const run of atMerge) {
    if (run.status !== "completed") continue;
    if (run.conclusion !== "failure" && run.conclusion !== "timed_out") continue;
    const winner = latest.get(run.name);
    if (!winner || winner === run) continue;
    if (winner.conclusion !== "success") continue;
    falseBlockReasons.push(
      `Check "${run.name}" failed on the head but a re-run succeeded before the merge — verification running in between would have blocked on superseded evidence.`
    );
  }

  return {
    catch: catchReasons.length > 0,
    catchReasons,
    falseBlockCandidate:
      catchReasons.length === 0 && falseBlockReasons.length > 0,
    falseBlockReasons,
    evidenceIncomplete: incompleteReasons.length > 0,
    incompleteReasons,
  };
}

export function summarizeBacktest(entries) {
  const graded = (entries ?? []).filter((entry) => entry.graded);
  const findings = { verified: 0, failed: 0, unverified: 0 };
  for (const entry of graded) {
    findings.verified += entry.grading?.verified ?? 0;
    findings.failed += entry.grading?.failed ?? 0;
    findings.unverified += entry.grading?.unverified ?? 0;
  }
  const totalFindings = findings.verified + findings.failed + findings.unverified;
  return {
    prsRequested: (entries ?? []).length,
    prsGraded: graded.length,
    prsErrored: (entries ?? []).length - graded.length,
    catches: graded.filter((entry) => entry.classification?.catch).length,
    falseBlockCandidates: graded.filter(
      (entry) => entry.classification?.falseBlockCandidate
    ).length,
    evidenceIncomplete: graded.filter(
      (entry) => entry.classification?.evidenceIncomplete
    ).length,
    findings,
    unverifiedShare: totalFindings > 0 ? findings.unverified / totalFindings : 0,
  };
}

// --- Public GitHub reader (unauthenticated) ---

export function createPublicGithubReader({
  fetchImpl = fetch,
  baseUrl = "https://api.github.com",
} = {}) {
  const base = baseUrl.replace(/\/+$/, "");

  async function getJson(url) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "solvelang-verification",
        },
      });
    } catch {
      throw new BacktestError("github_request_failed", 0);
    }
    if (response.status === 429) {
      throw new BacktestError("github_rate_limited", 429);
    }
    if (response.status === 403) {
      const remaining =
        typeof response.headers?.get === "function"
          ? response.headers.get("x-ratelimit-remaining")
          : null;
      if (remaining === "0") {
        throw new BacktestError("github_rate_limited", 403);
      }
      throw new BacktestError("github_request_failed", 403);
    }
    if (!response.ok) {
      throw new BacktestError("github_request_failed", response.status || 0);
    }
    return response.json().catch(() => null);
  }

  const repoRoute = (owner, repo) =>
    `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  return {
    async getRepo(owner, repo) {
      const payload = await getJson(repoRoute(owner, repo)).catch((err) => {
        if (err instanceof BacktestError && err.status === 404) return null;
        throw err;
      });
      if (!payload) return null;
      return { private: payload.private === true };
    },

    async listMergedPrs(owner, repo, count) {
      const payload = await getJson(
        `${repoRoute(owner, repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=100`
      );
      const merged = (Array.isArray(payload) ? payload : [])
        .filter((pr) => pr && typeof pr.merged_at === "string" && pr.merged_at)
        .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
        .slice(0, count);
      return merged.map((pr) => ({
        number: pr.number,
        title: typeof pr.title === "string" ? pr.title : "",
        url: typeof pr.html_url === "string" ? pr.html_url : "",
        headSha: pr.head?.sha ?? "",
        baseSha: pr.base?.sha ?? "",
        mergedAt: pr.merged_at,
      }));
    },

    async listChangedFiles(owner, repo, prNumber) {
      const files = [];
      for (let page = 1; ; page += 1) {
        const payload = await getJson(
          `${repoRoute(owner, repo)}/pulls/${prNumber}/files?per_page=100&page=${page}`
        );
        const batch = Array.isArray(payload) ? payload : [];
        files.push(...batch.map((entry) => entry?.filename).filter(Boolean));
        if (batch.length < 100) return files;
      }
    },

    async listRawCheckRuns(owner, repo, sha) {
      const payload = await getJson(
        `${repoRoute(owner, repo)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`
      );
      const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
      return runs.map((run) => ({
        id: run?.id ?? null,
        name: typeof run?.name === "string" ? run.name : "check",
        status: typeof run?.status === "string" ? run.status : "completed",
        conclusion: typeof run?.conclusion === "string" ? run.conclusion : null,
        startedAt: typeof run?.started_at === "string" ? run.started_at : null,
        completedAt:
          typeof run?.completed_at === "string" ? run.completed_at : null,
      }));
    },

    async getConfigText(owner, repo, ref) {
      let response;
      try {
        response = await fetchImpl(
          `${repoRoute(owner, repo)}/contents/${CONFIG_PATH.split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(ref)}`,
          {
            headers: {
              accept: "application/vnd.github.raw+json",
              "user-agent": "solvelang-verification",
            },
          }
        );
      } catch {
        return null;
      }
      if (!response.ok) return null;
      return response.text().catch(() => null);
    },
  };
}

// Downloads a public repo tree from codeload (not the rate-limited
// REST budget) and extracts it — the unauthenticated twin of the
// runner's tarball fetcher.
export function createPublicTreeFetcher({ fetchImpl = fetch } = {}) {
  return async function fetchTree({ owner, repo, sha, destDir }) {
    let response;
    try {
      response = await fetchImpl(
        `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(sha)}`,
        { headers: { "user-agent": "solvelang-verification" } }
      );
    } catch {
      throw new BacktestError("tree_download_failed", 0);
    }
    if (!response.ok) {
      throw new BacktestError("tree_download_failed", response.status || 0);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(destDir, { recursive: true });
    const tarPath = path.join(destDir, "tree.tar.gz");
    await writeFile(tarPath, bytes);
    await execFileAsync("tar", ["-xzf", tarPath, "-C", destDir, "--strip-components=1"]);
    await rm(tarPath, { force: true });
  };
}

// --- Grader (composition of the product's own pipeline) ---

export function createBacktestGrader({
  reader,
  collectReceiptInput,
  buildReceipt,
  runGate,
  fetchTree,
  workRoot,
  matchGlob,
  ownCheckName,
}) {
  async function gradePr({ owner, repo, pr }) {
    const workDir = path.join(
      workRoot,
      `backtest-${owner}-${repo}-${pr.number}-${String(pr.headSha).slice(0, 12)}`
    );
    await mkdir(workDir, { recursive: true });
    try {
      const configText = await reader
        .getConfigText(owner, repo, pr.baseSha)
        .catch(() => null);
      const { config } = parseVerificationConfig(configText);

      const allChanged = await reader.listChangedFiles(owner, repo, pr.number);
      const ignored = allChanged.filter((filePath) =>
        config.ignorePaths.some((glob) => matchGlob(glob, filePath))
      );
      const gateChanged = allChanged.filter(
        (filePath) => !ignored.includes(filePath)
      );

      let gateResultPath;
      try {
        const treeDir = path.join(workDir, "tree");
        await fetchTree({ owner, repo, sha: pr.headSha, destDir: treeDir });
        const outDir = path.join(workDir, "gate-out");
        await runGate({
          root: treeDir,
          changedFiles: gateChanged,
          labels: [],
          repo: `${owner}/${repo}`,
          revision: pr.headSha,
          outDir,
          policyPath: existsSync(path.join(treeDir, POLICY_PATH))
            ? POLICY_PATH
            : undefined,
        });
        const resultPath = path.join(outDir, "result.json");
        if (existsSync(resultPath)) gateResultPath = resultPath;
      } catch {
        gateResultPath = undefined;
      }

      const input = await collectReceiptInput({
        baseUrl: "https://api.github.com",
        owner,
        repo,
        pr: pr.number,
        gateResultPath,
      });
      const receipt = buildReceipt(input);
      const rawCheckRuns = await reader.listRawCheckRuns(owner, repo, pr.headSha);
      const classification = classifyBacktestPr({
        gateRoute: input.prGate,
        rawCheckRuns,
        requiredChecks: config.requiredChecks,
        ownCheckName,
        mergedAt: pr.mergedAt,
      });
      return {
        pr: pr.number,
        title: pr.title,
        url: pr.url,
        mergedAt: pr.mergedAt,
        headSha: pr.headSha,
        graded: true,
        grading: {
          verified: receipt.grading.verified,
          failed: receipt.grading.failed,
          unverified: receipt.grading.unverified,
        },
        classification,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { gradePr };
}

// --- Job store + runner ---

export function createFileBacktestStore({ dir }) {
  const jobPath = (id) => path.join(dir, `${id}.json`);
  const indexPath = path.join(dir, "index.json");

  async function readJson(file) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return null;
    }
  }

  return {
    async put(job) {
      await mkdir(dir, { recursive: true });
      const tmp = `${jobPath(job.id)}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(job, null, 2) + "\n", "utf8");
      await rename(tmp, jobPath(job.id));
      if (job.status === "complete" && job.report) {
        const index = (await readJson(indexPath)) ?? {};
        index[job.key] = { id: job.id, generatedAt: job.report.generatedAt };
        const indexTmp = `${indexPath}.tmp-${process.pid}`;
        await writeFile(indexTmp, JSON.stringify(index, null, 2) + "\n", "utf8");
        await rename(indexTmp, indexPath);
      }
    },

    async get(id) {
      if (!JOB_ID_PATTERN.test(id)) return null;
      return readJson(jobPath(id));
    },

    async getCached(key, ttlMs, nowDate) {
      const index = (await readJson(indexPath)) ?? {};
      const entry = index[key];
      if (!entry || !JOB_ID_PATTERN.test(entry.id)) return null;
      const generatedMs = Date.parse(entry.generatedAt || "") || 0;
      if (nowDate.getTime() - generatedMs > ttlMs) return null;
      const job = await readJson(jobPath(entry.id));
      if (!job || job.status !== "complete" || !job.report) return null;
      return job.report;
    },
  };
}

export function createBacktestJobs({
  store,
  reader,
  grader,
  makeId,
  now = () => new Date(),
  log = () => {},
}) {
  async function runJob(job) {
    const [owner, repo] = job.repo.split("/");
    try {
      const repoInfo = await reader.getRepo(owner, repo);
      if (!repoInfo || repoInfo.private) {
        job.status = "error";
        job.error = "repository_not_public_or_not_found";
        job.completedAt = now().toISOString();
        await store.put(job);
        return;
      }
      const prs = await reader.listMergedPrs(owner, repo, job.count);
      const entries = [];
      let rateLimited = false;
      for (const pr of prs) {
        if (rateLimited) {
          entries.push({
            pr: pr.number,
            title: pr.title,
            url: pr.url,
            mergedAt: pr.mergedAt,
            headSha: pr.headSha,
            graded: false,
            error: "github_rate_limited",
          });
          continue;
        }
        try {
          entries.push(await grader.gradePr({ owner, repo, pr }));
        } catch (err) {
          const code =
            err instanceof BacktestError
              ? err.code
              : err?.name || "grade_failed";
          entries.push({
            pr: pr.number,
            title: pr.title,
            url: pr.url,
            mergedAt: pr.mergedAt,
            headSha: pr.headSha,
            graded: false,
            error: code,
          });
          if (code === "github_rate_limited") rateLimited = true;
        }
      }
      job.report = {
        schema: BACKTEST_SCHEMA,
        id: job.id,
        repo: job.repo,
        requestedCount: job.count,
        generatedAt: now().toISOString(),
        cached: false,
        rateLimited,
        definitions: BACKTEST_DEFINITIONS,
        entries,
        summary: summarizeBacktest(entries),
      };
      job.status = "complete";
      job.completedAt = now().toISOString();
    } catch (err) {
      job.status = "error";
      job.error =
        err instanceof BacktestError ? err.code : err?.name || "backtest_failed";
      job.completedAt = now().toISOString();
      log("backtest_failed", `${job.repo} ${job.error}`);
    }
    await store.put(job).catch(() => {});
  }

  return {
    async start({ owner, repo, count }) {
      const key = `${owner}/${repo}#${count}`;
      const cached = await store
        .getCached(key, BACKTEST_CACHE_TTL_MS, now())
        .catch(() => null);
      if (cached) {
        return { id: cached.id, status: "complete", cached: true, report: cached };
      }
      const job = {
        id: makeId(),
        key,
        repo: `${owner}/${repo}`,
        count,
        status: "running",
        startedAt: now().toISOString(),
        completedAt: null,
        error: null,
        report: null,
      };
      await store.put(job);
      runJob(job).catch((err) => log("backtest_crashed", err?.name || "Error"));
      return { id: job.id, status: "running", cached: false };
    },

    async get(id) {
      const job = await store.get(id).catch(() => null);
      if (!job) return null;
      return {
        id: job.id,
        repo: job.repo,
        status: job.status,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        report: job.report,
      };
    },
  };
}
