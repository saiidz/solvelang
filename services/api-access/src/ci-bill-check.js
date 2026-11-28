// Public CI bill check: a free, read-only doorway that takes a
// PUBLIC GitHub repository's most recent completed workflow runs
// and computes, from the real job start/finish times the GitHub
// API reports, what those same job-seconds cost under two billing
// models:
//
// - GitHub's model: every job rounded UP to the next whole minute,
//   at GitHub's published per-minute rates for standard
//   GitHub-hosted runners (Linux $0.008, Windows $0.016, macOS
//   $0.08 - "About billing for GitHub Actions", read 2026-11-24).
// - SolveLang's Standard model: per-second metering at the
//   published Standard rate of $0.004 per minute, with a
//   10-second minimum per job (the shelf stated in agent-facts.js).
//
// Honesty discipline, stated on the page and in every response:
// - GitHub does not charge for standard runners on public
//   repositories. These figures are NOT a bill GitHub sent; they
//   are what the same measured work costs under each billing
//   model - the comparison that applies to paid (private-repo)
//   usage, and the rounding difference is the whole point.
// - SolveLang runners are Linux-only today, so the per-second
//   figure covers the Linux jobs only; Windows and macOS jobs are
//   totalled separately under GitHub's model and never folded
//   into the comparison.
// - When GitHub returns no runs, the check says "data
//   unavailable" in plain words. Nothing is estimated, projected,
//   or invented: no monthly figures, no forecasts - totals over
//   the stated sample only.
// - Self-hosted jobs carry no GitHub per-minute charge and are
//   excluded, counted, and stated.
//
// The module is self-contained: it imports nothing from the
// account, tenant, ledger, Stripe, or GitHub App code, holds no
// credential, and reads only public data.
//
// - KILL SWITCH: the CI_BILL_CHECK_ENABLED flag (parsed in
//   config.js). Anything other than the exact value "true" leaves
//   the route answering 503 ci_bill_check_disabled.
// - Rate limit: a fixed window per source address (60 calls per
//   60 seconds, the same shape as the agent talk-back doorway),
//   enforced before any GitHub work happens.
// - Results are cached per repository for 30 minutes in memory
//   (the check reads unauthenticated, and GitHub's unauthenticated
//   budget is small). The response states when the data was read,
//   and a cached answer carries cached: true.
// - Every call is logged (outcome + the public repository slug).

export const CI_BILL_CHECK_RATE_LIMIT = Object.freeze({ limit: 60, windowMs: 60_000 });
export const CI_BILL_CHECK_CACHE_TTL_MS = 30 * 60_000;
export const CI_BILL_CHECK_SAMPLE_RUNS = 10;

export const GITHUB_PER_MINUTE_USD = Object.freeze({ linux: 0.008, windows: 0.016, macos: 0.08 });
export const STANDARD_PER_MINUTE_USD = 0.004;
export const STANDARD_MINIMUM_SECONDS = 10;

const GITHUB_API_BASE = "https://api.github.com";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const CAMPAIGN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// The landing campaign tag the site sends with a check (the
// persisted first-touch utm_campaign, SEO -> Sales map section 3
// item 3). It is a slug the site's own SEO CTAs minted - bounded
// and slug-shaped. Anything else is dropped, never logged: the
// log line stays a record of our own pages, not of caller input.
export function normalizeCampaignTag(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CAMPAIGN_PATTERN.test(trimmed) ? trimmed : null;
}
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoSlug(owner, repo) {
  return typeof owner === "string" && typeof repo === "string" && OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo) && repo !== "." && repo !== "..";
}

export function classifyJobOs(labels) {
  if (!Array.isArray(labels)) return "unknown";
  const normalized = labels.filter((label) => typeof label === "string").map((label) => label.toLowerCase());
  if (normalized.includes("self-hosted")) return "self-hosted";
  if (normalized.some((label) => label.startsWith("ubuntu"))) return "linux";
  if (normalized.some((label) => label.startsWith("windows"))) return "windows";
  if (normalized.some((label) => label.startsWith("macos"))) return "macos";
  return "unknown";
}

export function jobSeconds(job) {
  const started = Date.parse(job?.started_at ?? "");
  const completed = Date.parse(job?.completed_at ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
  return Math.round((completed - started) / 1000);
}

// Pure computation over normalized job records:
// [{ os: "linux"|"windows"|"macos"|"self-hosted"|"unknown", seconds: number|null }]
export function computeBillCheck(jobs) {
  const byOs = {
    linux: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
    windows: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
    macos: { jobs: 0, seconds: 0, githubMinutes: 0, githubUsd: 0 },
  };
  let selfHostedJobs = 0;
  let unknownOsJobs = 0;
  let unmeasuredJobs = 0;
  let measuredJobs = 0;

  for (const job of jobs) {
    if (job.os === "self-hosted") { selfHostedJobs += 1; continue; }
    if (job.os === "unknown") { unknownOsJobs += 1; continue; }
    if (job.seconds === null) { unmeasuredJobs += 1; continue; }
    const bucket = byOs[job.os];
    bucket.jobs += 1;
    bucket.seconds += job.seconds;
    bucket.githubMinutes += Math.ceil(job.seconds / 60);
    measuredJobs += 1;
  }
  for (const [os, bucket] of Object.entries(byOs)) {
    bucket.githubUsd = bucket.githubMinutes * GITHUB_PER_MINUTE_USD[os];
  }

  const linux = byOs.linux;
  const solvelangSeconds = jobs
    .filter((job) => job.os === "linux" && job.seconds !== null)
    .reduce((sum, job) => sum + Math.max(job.seconds, STANDARD_MINIMUM_SECONDS), 0);
  const solvelangUsd = (solvelangSeconds / 60) * STANDARD_PER_MINUTE_USD;

  const githubTotalUsd = byOs.linux.githubUsd + byOs.windows.githubUsd + byOs.macos.githubUsd;
  const round2 = (value) => Math.round(value * 100) / 100;

  return {
    measuredJobs,
    selfHostedJobs,
    unknownOsJobs,
    unmeasuredJobs,
    byOs: {
      linux: { jobs: linux.jobs, seconds: linux.seconds, githubMinutes: linux.githubMinutes, githubUsd: round2(linux.githubUsd) },
      windows: { jobs: byOs.windows.jobs, seconds: byOs.windows.seconds, githubMinutes: byOs.windows.githubMinutes, githubUsd: round2(byOs.windows.githubUsd) },
      macos: { jobs: byOs.macos.jobs, seconds: byOs.macos.seconds, githubMinutes: byOs.macos.githubMinutes, githubUsd: round2(byOs.macos.githubUsd) },
    },
    githubModel: {
      totalUsd: round2(githubTotalUsd),
      linuxUsd: round2(linux.githubUsd),
      otherOsUsd: round2(byOs.windows.githubUsd + byOs.macos.githubUsd),
    },
    solvelangModel: {
      linuxSecondsBilled: solvelangSeconds,
      linuxUsd: round2(solvelangUsd),
    },
    linuxDifferenceUsd: round2(linux.githubUsd - solvelangUsd),
  };
}

// --- the check ------------------------------------------------------

const RATES_PROVENANCE = "GitHub per-minute rates are GitHub's published prices for standard GitHub-hosted runners (Linux $0.008, Windows $0.016, macOS $0.08 per minute, from 'About billing for GitHub Actions', read 2026-11-24). The SolveLang Standard rate is the published shelf: $0.004 per minute, metered per second, 10-second minimum per job.";
const MODEL_STATEMENT = "GitHub does not charge for standard runners on public repositories, so these are not figures from a GitHub bill: they are what the same measured job-seconds cost under each billing model - the comparison that applies to paid (private-repository) usage. Totals cover the stated sample only; nothing is projected or estimated.";

export function createCiBillCheck({ enabled = false, fetchImpl = globalThis.fetch, logger = console, now = Date.now, rateLimit = CI_BILL_CHECK_RATE_LIMIT, cacheTtlMs = CI_BILL_CHECK_CACHE_TTL_MS, sampleRuns = CI_BILL_CHECK_SAMPLE_RUNS } = {}) {
  const windows = new Map();
  const cache = new Map();

  function log(outcome, repo, campaign = null) {
    try {
      // The campaign field is additive and present only when the
      // call carried a valid tag, so existing log consumers see
      // the exact shape they have always seen for untagged calls.
      logger.info({ type: "ci_bill_check_call", at: new Date(now()).toISOString(), repo: repo ?? null, outcome, ...(campaign ? { campaign } : {}) });
    } catch {
      // Logging must never break the surface it observes.
    }
  }

  function rateLimitAllows(source) {
    const key = typeof source === "string" && source ? source : "unknown";
    const at = now();
    const window = windows.get(key);
    if (!window || at - window.startedAt >= rateLimit.windowMs) {
      windows.set(key, { startedAt: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= rateLimit.limit;
  }

  async function gh(path) {
    const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "solvelang-api-access",
      },
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  function rateLimited(json) {
    return typeof json?.message === "string" && /rate limit/i.test(json.message);
  }

  async function check(owner, repo) {
    const slug = `${owner}/${repo}`;
    const routes = [];
    const readAt = new Date(now()).toISOString();
    const api = (path) => `/repos/${owner}/${repo}${path}`;
    const base = {
      schema: "solvelang.ci-bill-check.v1",
      repo: slug,
      url: `https://github.com/${slug}`,
      readAt,
      cached: false,
      rates: { githubPerMinuteUsd: GITHUB_PER_MINUTE_USD, standardPerMinuteUsd: STANDARD_PER_MINUTE_USD, standardMinimumSeconds: STANDARD_MINIMUM_SECONDS, provenance: RATES_PROVENANCE },
      modelStatement: MODEL_STATEMENT,
      routes,
    };

    // Route 1: repository metadata (existence + public check).
    let meta;
    try {
      const result = await gh(api(""));
      if (result.status === 404) return { notFound: true };
      if (result.status !== 200 || !result.json) {
        routes.push({ route: `GET ${api("")}`, status: "failed", detail: `GitHub answered ${result.status}${rateLimited(result.json) ? " (rate limit)" : ""}.` });
        return { ...base, availability: "failed", statement: "The repository record could not be read, so no bill could be computed. Nothing is estimated in its place.", sample: null, totals: null };
      }
      meta = result.json;
      routes.push({ route: `GET ${api("")}`, status: "ok" });
    } catch (error) {
      routes.push({ route: `GET ${api("")}`, status: "failed", detail: String(error?.message ?? error) });
      return { ...base, availability: "failed", statement: "The repository record could not be read, so no bill could be computed. Nothing is estimated in its place.", sample: null, totals: null };
    }
    if (typeof meta.html_url === "string") base.url = meta.html_url;

    // Route 2: the most recent completed workflow runs.
    let runs;
    try {
      const result = await gh(api(`/actions/runs?status=completed&per_page=${sampleRuns}`));
      if (result.status !== 200 || !Array.isArray(result.json?.workflow_runs)) {
        routes.push({ route: `GET ${api("/actions/runs")}`, status: "failed", detail: `GitHub answered ${result.status}${rateLimited(result.json) ? " (rate limit)" : ""}.` });
        return { ...base, availability: "failed", statement: "The workflow-run list could not be read, so no bill could be computed. Nothing is estimated in its place.", sample: null, totals: null };
      }
      runs = result.json.workflow_runs;
      routes.push({ route: `GET ${api("/actions/runs")}`, status: "ok" });
    } catch (error) {
      routes.push({ route: `GET ${api("/actions/runs")}`, status: "failed", detail: String(error?.message ?? error) });
      return { ...base, availability: "failed", statement: "The workflow-run list could not be read, so no bill could be computed. Nothing is estimated in its place.", sample: null, totals: null };
    }

    if (runs.length === 0) {
      return { ...base, availability: "unavailable", statement: "Data unavailable: GitHub returned no completed workflow runs for this repository, so there is no measured work to price. Nothing is estimated in its place.", sample: { runs: 0, jobs: 0 }, totals: null };
    }

    // Route 3: the jobs of each sampled run.
    const jobs = [];
    let jobsFailed = 0;
    let jobsTruncated = 0;
    for (const run of runs) {
      try {
        const result = await gh(api(`/actions/runs/${run.id}/jobs?per_page=100`));
        if (result.status === 200 && Array.isArray(result.json?.jobs)) {
          if (typeof result.json.total_count === "number" && result.json.total_count > result.json.jobs.length) jobsTruncated += 1;
          for (const job of result.json.jobs) {
            jobs.push({ os: classifyJobOs(job.labels), seconds: jobSeconds(job) });
          }
        } else {
          jobsFailed += 1;
        }
      } catch {
        jobsFailed += 1;
      }
    }
    routes.push({ route: `GET ${api("/actions/runs/{id}/jobs")}`, status: jobsFailed === 0 ? "ok" : "failed", detail: jobsFailed === 0 ? undefined : `${jobsFailed} of ${runs.length} run job lists could not be read; the totals cover the runs that were read.` });

    const totals = computeBillCheck(jobs);
    const startedTimes = runs.map((run) => run.run_started_at ?? run.created_at).filter((value) => typeof value === "string").sort();
    const sample = {
      runs: runs.length,
      jobs: jobs.length,
      measuredJobs: totals.measuredJobs,
      selfHostedJobs: totals.selfHostedJobs,
      unknownOsJobs: totals.unknownOsJobs,
      unmeasuredJobs: totals.unmeasuredJobs,
      jobsListsFailed: jobsFailed,
      jobsListsTruncated: jobsTruncated,
      windowFrom: startedTimes[0] ?? null,
      windowTo: startedTimes[startedTimes.length - 1] ?? null,
    };

    if (totals.measuredJobs === 0) {
      return { ...base, availability: "unavailable", statement: "Data unavailable: the sampled runs contain no GitHub-hosted jobs with measurable start and finish times, so there is nothing to price. Nothing is estimated in its place.", sample, totals: null };
    }

    return {
      ...base,
      availability: "ok",
      statement: `Computed from the job start and finish times GitHub's API reports for the ${runs.length} most recent completed runs. GitHub's model rounds every job up to the next whole minute; the SolveLang Standard model meters the same Linux job-seconds per second with a 10-second minimum per job.`,
      sample,
      totals,
    };
  }

  async function handle({ method, bodyText, source } = {}) {
    if (!enabled) {
      log("refused_disabled", null);
      return { statusCode: 503, body: { ok: false, error: { code: "ci_bill_check_disabled", message: "The CI bill check is not enabled." } } };
    }
    if (method !== "POST") {
      log("method_not_allowed", null);
      return { statusCode: 405, body: { ok: false, error: { code: "method_not_allowed", message: "Use POST with a JSON body naming a public repository." } } };
    }
    if (!rateLimitAllows(source)) {
      log("rate_limited", null);
      return { statusCode: 429, body: { ok: false, error: { code: "rate_limited", message: "Too many checks from this address. The limit is 60 calls per 60 seconds; try again shortly." } } };
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText ?? "");
    } catch {
      log("rejected", null);
      return { statusCode: 400, body: { ok: false, error: { code: "invalid_body", message: "The request body must be JSON: { \"owner\": \"...\", \"repo\": \"...\" }." } } };
    }
    const owner = typeof parsed?.owner === "string" ? parsed.owner.trim() : "";
    const repo = typeof parsed?.repo === "string" ? parsed.repo.trim() : "";
    if (!isValidRepoSlug(owner, repo)) {
      log("rejected", null);
      return { statusCode: 400, body: { ok: false, error: { code: "invalid_repo", message: "Name a public repository as owner and repo (letters, digits, hyphens, dots, underscores)." } } };
    }

    const slug = `${owner}/${repo}`;
    const campaign = normalizeCampaignTag(parsed?.campaign);
    const cacheKey = slug.toLowerCase();
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < cacheTtlMs) {
      log("served_cached", slug, campaign);
      return { statusCode: 200, body: { ok: true, check: { ...hit.check, cached: true } } };
    }

    let outcome;
    try {
      outcome = await check(owner, repo);
    } catch (error) {
      log("check_failed", slug, campaign);
      return { statusCode: 500, body: { ok: false, error: { code: "check_failed", message: `The check could not be completed: ${String(error?.message ?? error)}` } } };
    }
    if (outcome.notFound) {
      log("not_found", slug, campaign);
      return { statusCode: 404, body: { ok: false, error: { code: "repo_not_found", message: "Repository not found. The check reads public repositories only; GitHub answers the same way for a private repository as for a missing one." } } };
    }

    cache.set(cacheKey, { at: now(), check: outcome });
    log("served", slug, campaign);
    return { statusCode: 200, body: { ok: true, check: outcome } };
  }

  return { handle };
}
