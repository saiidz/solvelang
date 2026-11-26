#!/usr/bin/env node
// SolveLang Change Impact Receipt collector for GitHub.
//
// Reads one pull request from the GitHub REST API (api.github.com or a
// GitHub Enterprise Server base URL) and emits a Change Impact Receipt
// INPUT object: the exact JSON shape the Change Impact Receipts page
// (site/app/change-impact-receipt) consumes and turns into a receipt
// with buildChangeImpactReceipt. It is the GitHub sibling of
// solvelang-forge-receipt (src/forge-receipt.ts) — the last of the five
// platform collectors to be built (map:
// verification-product-slice1-map.md §4.1); the field contract is the
// same ChangeImpactReceiptInput in
// site/app/change-impact-receipt/core/receipt.ts, and the QA pins in
// test/github-receipt-qa.test.ts assert the two stay in lock-step.
//
// GitHub wire facts this mapping relies on (each is a documented,
// stable property of the REST API, and the receipt builder in
// receipt.ts was written against this same vocabulary):
//   - The PR object's `mergeable` is null while GitHub is still
//     computing mergeability; the collector re-reads the PR a bounded
//     number of times before accepting null (the builder labels a null
//     "unverified" rather than guessing). `mergeable_state` is passed
//     through verbatim (clean / dirty / blocked / unstable / behind /
//     unknown / draft) — never translated.
//   - Per-file additions/deletions are carried on the files endpoint
//     itself, so counts come from the diffs actually read; the PR
//     object's totals are used for the headline size, as printed by
//     the API.
//   - Check runs carry status (queued / in_progress / completed) and a
//     conclusion vocabulary (success / failure / neutral / cancelled /
//     skipped / timed_out / action_required / stale) that IS the
//     receipt vocabulary — mapped through unchanged.
//   - Review states are APPROVED / CHANGES_REQUESTED / COMMENTED /
//     DISMISSED / PENDING; PENDING is not a submitted review and is
//     dropped, the rest pass through verbatim.
//   - The compare endpoint (base branch name ... head SHA) reports
//     status identical / ahead / behind / diverged with ahead_by /
//     behind_by — the receipt's compare shape exactly.
//
// Provenance discipline (the receipt builder's rules, applied at the
// collection step):
//   - The token is supplied by the operator at runtime (--token or the
//     GITHUB_TOKEN environment variable) and is never stored, logged,
//     or written to the output. Public repositories read without one.
//   - A section that cannot be read (PR, files, check runs, reviews)
//     is an operational error (exit 2): emitting a partial input would
//     let the builder print "verified" findings the records do not
//     support.
//   - The compare section is the one honest exception: when the
//     compare endpoint cannot answer, compare is null and the builder
//     labels base drift unverified rather than guessing.
//
// Exit codes mirror the PR Gate CLI: 0 = input emitted, 2 =
// operational error (bad arguments, unreachable API, unreadable gate
// result).

import { readFile, writeFile } from "node:fs/promises";

import {
  mapPrGateResult,
  type ForgePrGateRoute,
  type ForgeReceiptChangedFile,
  type ForgeReceiptCheckRun,
  type ForgeReceiptCompare,
  type ForgeReceiptInput,
  type ForgeReceiptPullRequest,
  type ForgeReceiptReview,
} from "./forge-receipt";

// The GitHub collector emits the same receipt input contract as the
// forge collector; the types are aliases so the two cannot drift.
export type GithubReceiptPullRequest = ForgeReceiptPullRequest;
export type GithubReceiptChangedFile = ForgeReceiptChangedFile;
export type GithubReceiptCheckRun = ForgeReceiptCheckRun;
export type GithubReceiptReview = ForgeReceiptReview;
export type GithubReceiptCompare = ForgeReceiptCompare;
export type GithubPrGateRoute = ForgePrGateRoute;
export type GithubReceiptInput = ForgeReceiptInput;

export type GithubReceiptOptions = {
  baseUrl: string;
  owner: string;
  repo: string;
  pr: number;
  token?: string;
  gateResultPath?: string;
  // Extra PR re-reads while `mergeable` is null (GitHub computes it
  // asynchronously). Default 2; tests pass 0.
  mergeablePolls?: number;
};

export class GithubCollectError extends Error {}

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<FetchResponse>;

const defaultFetch: FetchLike = (url, init) =>
  (globalThis as { fetch: FetchLike }).fetch(url, init);

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // api.github.com is its own API root; a GHES host serves the REST
  // API under /api/v3.
  return trimmed === "https://api.github.com" ? trimmed : `${trimmed}/api/v3`;
}

async function githubApiGet(
  baseUrl: string,
  route: string,
  token: string | undefined,
  fetchImpl: FetchLike
): Promise<unknown> {
  const url = `${apiRoot(baseUrl)}${route}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "solvelang-github-receipt",
  };
  if (token) headers.authorization = "Bearer " + token;
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { headers });
  } catch (caught) {
    throw new GithubCollectError(
      `GitHub API request failed for ${route}: ${caught instanceof Error ? caught.message : String(caught)}`
    );
  }
  if (!response.ok) {
    throw new GithubCollectError(
      `GitHub API request failed for ${route}: HTTP ${response.status}.`
    );
  }
  return response.json();
}

async function githubApiGetAll(
  baseUrl: string,
  route: string,
  token: string | undefined,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const separator = route.includes("?") ? "&" : "?";
    const batch = (await githubApiGet(
      baseUrl,
      `${route}${separator}per_page=${perPage}&page=${page}`,
      token,
      fetchImpl
    )) as Record<string, unknown>[];
    if (!Array.isArray(batch)) {
      throw new GithubCollectError(
        `GitHub API request for ${route} did not return a list.`
      );
    }
    items.push(...batch);
    if (batch.length < perPage) return items;
  }
}

// The check-runs endpoint wraps its list in an envelope
// ({ total_count, check_runs: [...] }) instead of returning a bare list.
async function githubApiGetCheckRuns(
  baseUrl: string,
  route: string,
  token: string | undefined,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const raw = asRecord(
      await githubApiGet(
        baseUrl,
        `${route}?per_page=${perPage}&page=${page}`,
        token,
        fetchImpl
      )
    );
    const batch = Array.isArray(raw.check_runs) ? raw.check_runs : [];
    items.push(...(batch as Record<string, unknown>[]));
    if (batch.length < perPage) return items;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// --- Platform vocabulary mappings (pinned by tests) ---

export function mapGithubPullRequest(
  raw: Record<string, unknown>,
  owner: string,
  repo: string
): GithubReceiptPullRequest {
  const head = asRecord(raw.head);
  const base = asRecord(raw.base);
  const user = asRecord(raw.user);
  return {
    owner,
    repo,
    number: asNumber(raw.number),
    title: asString(raw.title),
    url: asString(raw.html_url),
    state: asString(raw.state),
    draft: raw.draft === true,
    author: asString(user.login, "unknown"),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
    headSha: asString(head.sha),
    headRef: asString(head.ref),
    baseRef: asString(base.ref),
    baseSha: asString(base.sha),
    mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
    mergeableState: asString(raw.mergeable_state, "unknown"),
    changedFiles: asNumber(raw.changed_files),
    additions: asNumber(raw.additions),
    deletions: asNumber(raw.deletions),
    commits: asNumber(raw.commits),
  };
}

export function mapGithubChangedFile(
  raw: Record<string, unknown>
): GithubReceiptChangedFile {
  return {
    filename: asString(raw.filename),
    status: asString(raw.status, "changed"),
    additions: asNumber(raw.additions),
    deletions: asNumber(raw.deletions),
  };
}

// GitHub check-run status/conclusion vocabulary is the receipt
// vocabulary; the only normalization is a missing conclusion on a
// completed run, which stays null (the builder prints the status
// instead) rather than being invented.
export function mapGithubCheckRun(
  raw: Record<string, unknown>
): GithubReceiptCheckRun {
  return {
    name: asString(raw.name, "check"),
    status: asString(raw.status, "completed"),
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : null,
  };
}

// PENDING reviews are not submitted and are dropped; DISMISSED is a
// real submitted state (a review that was later dismissed) and stays.
export function mapGithubReview(
  raw: Record<string, unknown>
): GithubReceiptReview | null {
  const state = asString(raw.state);
  if (state === "PENDING" || state === "") return null;
  const user = asRecord(raw.user);
  return { author: asString(user.login, "unknown"), state };
}

export function mapGithubCompare(
  raw: Record<string, unknown>
): GithubReceiptCompare {
  return {
    status: asString(raw.status, "diverged"),
    aheadBy: asNumber(raw.ahead_by),
    behindBy: asNumber(raw.behind_by),
  };
}

// --- PR Gate route embedding ---

async function loadPrGateRoute(
  gateResultPath: string | undefined,
  readAt: string
): Promise<GithubPrGateRoute> {
  if (!gateResultPath) {
    return {
      status: "not-run",
      reason:
        "No PR Gate result was supplied to the collector. Run the PR Gate (packages/pr-gate action or CLI) and pass --gate-result <result.json> to embed it.",
      provenance: `solvelang-github-receipt collector invocation, ${readAt}.`,
    };
  }
  const provenance = `SolveLang PR Gate CLI (packages/pr-gate, report-only mode) result at ${gateResultPath}, read by solvelang-github-receipt ${readAt}.`;
  let text: string;
  try {
    text = await readFile(gateResultPath, "utf8");
  } catch (caught) {
    return {
      status: "failed",
      error: `PR Gate result file could not be read: ${caught instanceof Error ? caught.message : String(caught)}`,
      provenance,
    };
  }
  try {
    return mapPrGateResult(asRecord(JSON.parse(text)), provenance);
  } catch (caught) {
    return {
      status: "failed",
      error: `PR Gate result file is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`,
      provenance,
    };
  }
}

// --- Collection ---

export async function collectGithubReceiptInput(
  options: GithubReceiptOptions,
  fetchImpl: FetchLike = defaultFetch
): Promise<GithubReceiptInput> {
  const { baseUrl, owner, repo, pr } = options;
  const repoRoute = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const readAt = new Date().toISOString();
  const source = `GitHub REST API at ${baseUrl.replace(/\/+$/, "")} via solvelang-github-receipt (packages/pr-gate)`;

  // GitHub computes `mergeable` asynchronously: a fresh PR often
  // reads null on the first GET. Re-read a bounded number of times
  // before accepting null (which the builder labels unverified).
  let prRaw = asRecord(
    await githubApiGet(baseUrl, `${repoRoute}/pulls/${pr}`, options.token, fetchImpl)
  );
  const polls = options.mergeablePolls ?? 2;
  for (let attempt = 0; attempt < polls && prRaw.mergeable === null; attempt += 1) {
    await sleep(1500);
    prRaw = asRecord(
      await githubApiGet(baseUrl, `${repoRoute}/pulls/${pr}`, options.token, fetchImpl)
    );
  }
  const mappedPr = mapGithubPullRequest(prRaw, owner, repo);
  if (!mappedPr.headSha) {
    throw new GithubCollectError(
      `GitHub API PR response for ${owner}/${repo}#${pr} carried no head SHA.`
    );
  }

  const filesRaw = await githubApiGetAll(
    baseUrl,
    `${repoRoute}/pulls/${pr}/files`,
    options.token,
    fetchImpl
  );
  const files = filesRaw.map(mapGithubChangedFile);
  const checkRunsRaw = await githubApiGetCheckRuns(
    baseUrl,
    `${repoRoute}/commits/${mappedPr.headSha}/check-runs`,
    options.token,
    fetchImpl
  );
  const checkRuns = checkRunsRaw.map(mapGithubCheckRun);
  const reviewsRaw = await githubApiGetAll(
    baseUrl,
    `${repoRoute}/pulls/${pr}/reviews`,
    options.token,
    fetchImpl
  );
  const reviews = reviewsRaw
    .map(mapGithubReview)
    .filter((review): review is GithubReceiptReview => review !== null);

  // Compare is the one section allowed to degrade: the builder labels
  // a null compare "unverified" instead of guessing base drift.
  let compare: GithubReceiptCompare | null = null;
  try {
    const compareRaw = asRecord(
      await githubApiGet(
        baseUrl,
        `${repoRoute}/compare/${encodeURIComponent(mappedPr.baseRef)}...${encodeURIComponent(mappedPr.headSha)}`,
        options.token,
        fetchImpl
      )
    );
    compare = mapGithubCompare(compareRaw);
  } catch {
    compare = null;
  }

  const prGate = await loadPrGateRoute(options.gateResultPath, readAt);

  return { pr: mappedPr, files, checkRuns, reviews, compare, prGate, readAt, source };
}

// --- CLI ---

export type GithubReceiptCliOptions = GithubReceiptOptions & {
  outPath?: string;
};

export function parseGithubReceiptArgs(argv: string[]): GithubReceiptCliOptions {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new GithubCollectError(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new GithubCollectError(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  const pr = Number(parsed.pr);
  if (!parsed.owner || !parsed.repo || !Number.isInteger(pr) || pr <= 0) {
    throw new GithubCollectError(
      "Required: --owner <owner> --repo <repo> --pr <number>."
    );
  }
  return {
    baseUrl: parsed["base-url"] ?? "https://api.github.com",
    owner: parsed.owner,
    repo: parsed.repo,
    pr,
    token: parsed.token ?? process.env.GITHUB_TOKEN,
    gateResultPath: parsed["gate-result"],
    outPath: parsed.out,
  };
}

const USAGE = `Usage: solvelang-github-receipt --owner <owner> --repo <repo> --pr <number> [options]

Reads one pull request from the GitHub REST API and writes a Change
Impact Receipt input JSON object (the shape consumed by
site/app/change-impact-receipt) to --out or stdout.

  --owner <owner>       Repository owner (required)
  --repo <repo>         Repository name (required)
  --pr <number>         Pull request number (required)
  --base-url <url>      API base URL (default https://api.github.com;
                        a GitHub Enterprise Server host URL also works)
  --token <token>       API token. Falls back to GITHUB_TOKEN. Never
                        stored or printed.
  --gate-result <path>  A PR Gate result.json (solvelang.pr-gate.result.v1)
                        to embed as the receipt's PR Gate route
  --out <path>          Write the input JSON to this file instead of stdout

Exit codes: 0 = input emitted, 2 = operational error.`;

export async function main(argv: string[]): Promise<number> {
  let options: GithubReceiptCliOptions;
  try {
    options = parseGithubReceiptArgs(argv);
  } catch (caught) {
    console.error(
      `github-receipt: ${caught instanceof Error ? caught.message : String(caught)}`
    );
    console.error(USAGE);
    return 2;
  }
  try {
    const input = await collectGithubReceiptInput(options);
    const json = `${JSON.stringify(input, null, 2)}\n`;
    if (options.outPath) {
      await writeFile(options.outPath, json, "utf8");
      console.log(
        `github-receipt: receipt input for ${options.owner}/${options.repo}#${options.pr} written to ${options.outPath}`
      );
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (caught) {
    console.error(
      `github-receipt: ${caught instanceof Error ? caught.message : String(caught)}`
    );
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
