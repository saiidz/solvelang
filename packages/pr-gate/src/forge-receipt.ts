#!/usr/bin/env node
// SolveLang Change Impact Receipt collector for Gitea / Forgejo.
//
// Reads one pull request from a self-hosted Gitea or Forgejo instance's
// REST API (/api/v1 — one API family covers both forges) and emits a
// Change Impact Receipt INPUT object: the exact JSON shape the Change
// Impact Receipts page (site/app/change-impact-receipt) consumes and
// turns into a receipt with buildChangeImpactReceipt. The field contract
// mirrored here is ChangeImpactReceiptInput in
// site/app/change-impact-receipt/core/receipt.ts; the QA pins in
// test/forge-receipt-qa.test.ts assert the two stay in lock-step.
//
// Provenance discipline (the receipt builder's rules, applied at the
// collection step):
//   - The token is supplied by the operator at runtime (--token or the
//     FORGE_TOKEN / GITEA_TOKEN / FORGEJO_TOKEN environment variables)
//     and is never stored, logged, or written to the output.
//   - A section that cannot be read (PR, files, reviews, commits,
//     statuses) is an operational error (exit 2): emitting a partial
//     input would let the builder print "verified" findings the records
//     do not support.
//   - The compare section is the one honest exception: when the compare
//     endpoint cannot answer, compare is null and the builder labels
//     base drift unverified rather than guessing.
//   - Platform vocabulary is mapped, never invented: Gitea/Forgejo
//     review states and commit-status states are translated to the
//     receipt builder's vocabulary by the mapping functions below, and
//     the mappings are pinned by tests.
//
// Exit codes mirror the PR Gate CLI: 0 = input emitted, 2 = operational
// error (bad arguments, unreachable instance, unreadable gate result).

import { readFile, writeFile } from "node:fs/promises";

// --- Receipt input contract (mirrors site/app/change-impact-receipt/core/receipt.ts) ---

export type ForgeReceiptPullRequest = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  baseSha: string;
  mergeable: boolean | null;
  mergeableState: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  commits: number;
};

export type ForgeReceiptChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
};

export type ForgeReceiptCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
};

export type ForgeReceiptReview = {
  author: string;
  state: string;
};

export type ForgeReceiptCompare = {
  status: string;
  aheadBy: number;
  behindBy: number;
};

export type ForgePrGateRoute =
  | {
      status: "ran";
      summary: {
        integrityVerified: boolean;
        nodes: number;
        edges: number;
        impactedNodes: number;
        rootCount: number;
        headline: string;
        policyPassed: boolean;
        policyVerdicts: { rule: string; status: string }[];
      };
      provenance: string;
    }
  | { status: "failed"; error: string; provenance: string }
  | { status: "not-run"; reason: string; provenance: string };

export type ForgeReceiptInput = {
  pr: ForgeReceiptPullRequest;
  files: ForgeReceiptChangedFile[];
  checkRuns: ForgeReceiptCheckRun[];
  reviews: ForgeReceiptReview[];
  compare: ForgeReceiptCompare | null;
  prGate: ForgePrGateRoute;
  readAt: string;
  source: string;
};

export type ForgePlatform = "gitea" | "forgejo";

export type ForgeReceiptOptions = {
  baseUrl: string;
  owner: string;
  repo: string;
  pr: number;
  platform: ForgePlatform;
  token?: string;
  gateResultPath?: string;
};

export class ForgeCollectError extends Error {}

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

const defaultFetch: FetchLike = (url, init) => (globalThis as { fetch: FetchLike }).fetch(url, init);

function apiRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1`;
}

async function forgeApiGet(baseUrl: string, route: string, token: string | undefined, fetchImpl: FetchLike): Promise<unknown> {
  const url = `${apiRoot(baseUrl)}${route}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `token ${token}`;
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { headers });
  } catch (caught) {
    throw new ForgeCollectError(`Forge API request failed for ${route}: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  if (!response.ok) {
    throw new ForgeCollectError(`Forge API request failed for ${route}: HTTP ${response.status}.`);
  }
  return response.json();
}

async function forgeApiGetAll(baseUrl: string, route: string, token: string | undefined, fetchImpl: FetchLike): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const limit = 50;
  for (let page = 1; ; page += 1) {
    const separator = route.includes("?") ? "&" : "?";
    const batch = (await forgeApiGet(baseUrl, `${route}${separator}page=${page}&limit=${limit}`, token, fetchImpl)) as Record<string, unknown>[];
    if (!Array.isArray(batch)) {
      throw new ForgeCollectError(`Forge API request for ${route} did not return a list.`);
    }
    items.push(...batch);
    if (batch.length < limit) return items;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// --- Platform vocabulary mappings (pinned by tests) ---

// The Gitea/Forgejo API reports mergeable as a boolean (or omits it while
// the merge check is still running). The receipt builder prints the state
// string next to its own mergeable verdict, so the string must not claim
// more than the API said: true is "unstable" (mergeable per the API, with
// check state reported separately), false is "dirty" (not mergeable),
// absent is "unknown".
export function mergeableStateFor(mergeable: boolean | null): string {
  if (mergeable === null) return "unknown";
  return mergeable ? "unstable" : "dirty";
}

export function mapForgePullRequest(raw: Record<string, unknown>, owner: string, repo: string, commits: number, files: ForgeReceiptChangedFile[]): ForgeReceiptPullRequest {
  const head = asRecord(raw.head);
  const base = asRecord(raw.base);
  const user = asRecord(raw.user);
  const mergeable = typeof raw.mergeable === "boolean" ? raw.mergeable : null;
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
    mergeable,
    mergeableState: mergeableStateFor(mergeable),
    changedFiles: typeof raw.changed_files === "number" ? raw.changed_files : files.length,
    additions: typeof raw.additions === "number" ? raw.additions : files.reduce((sum, file) => sum + file.additions, 0),
    deletions: typeof raw.deletions === "number" ? raw.deletions : files.reduce((sum, file) => sum + file.deletions, 0),
    commits,
  };
}

export function mapForgeChangedFile(raw: Record<string, unknown>): ForgeReceiptChangedFile {
  return {
    filename: asString(raw.filename),
    status: asString(raw.status, "changed"),
    additions: asNumber(raw.additions),
    deletions: asNumber(raw.deletions),
  };
}

// Gitea/Forgejo review states: APPROVED, COMMENT, PENDING,
// REQUEST_CHANGES, REQUEST_REVIEW. PENDING and REQUEST_REVIEW are not
// submitted reviews and are dropped; REQUEST_CHANGES is the platform's
// spelling of the receipt vocabulary's CHANGES_REQUESTED.
export function mapForgeReview(raw: Record<string, unknown>): ForgeReceiptReview | null {
  const state = asString(raw.state);
  if (state === "PENDING" || state === "REQUEST_REVIEW" || state === "") return null;
  const user = asRecord(raw.user);
  const reviewer = asRecord(raw.reviewer);
  return {
    author: asString(user.login, asString(reviewer.login, "unknown")),
    state: state === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : state,
  };
}

// Gitea/Forgejo commit-status states: success, failure, error, warning,
// pending. The combined-status endpoint returns the latest status per
// context, which is exactly the receipt's check-run list. "error" is a
// failing gate state on both forges and the receipt vocabulary has no
// separate error conclusion, so it maps to "failure"; "warning" maps to
// "neutral"; "pending" is still running, so it carries no conclusion.
export function mapForgeCheckRuns(combined: Record<string, unknown>): ForgeReceiptCheckRun[] {
  const statuses = Array.isArray(combined.statuses) ? combined.statuses : [];
  return statuses.map((entry) => {
    const status = asRecord(entry);
    const state = asString(status.state);
    const name = asString(status.context, "status");
    if (state === "pending") return { name, status: "in_progress", conclusion: null };
    if (state === "success") return { name, status: "completed", conclusion: "success" };
    if (state === "failure" || state === "error") return { name, status: "completed", conclusion: "failure" };
    if (state === "warning") return { name, status: "completed", conclusion: "neutral" };
    return { name, status: "completed", conclusion: state === "" ? null : state };
  });
}

export function mapForgeCompare(aheadBy: number, behindBy: number): ForgeReceiptCompare {
  const status = aheadBy === 0 && behindBy === 0 ? "identical" : behindBy === 0 ? "ahead" : aheadBy === 0 ? "behind" : "diverged";
  return { status, aheadBy, behindBy };
}

// --- PR Gate route embedding ---

export function mapPrGateResult(raw: Record<string, unknown>, provenance: string): ForgePrGateRoute {
  if (raw.schema !== "solvelang.pr-gate.result.v1") {
    return {
      status: "failed",
      error: `PR Gate result file is not a solvelang.pr-gate.result.v1 document (schema: ${asString(raw.schema, "missing")}).`,
      provenance,
    };
  }
  const graph = asRecord(raw.graph);
  const impact = asRecord(raw.impact);
  const policy = asRecord(raw.policy);
  const evaluation = asRecord(policy.evaluation);
  const verdicts = Array.isArray(evaluation.verdicts) ? evaluation.verdicts : [];
  return {
    status: "ran",
    summary: {
      integrityVerified: graph.integrityVerified === true,
      nodes: asNumber(graph.nodes),
      edges: asNumber(graph.edges),
      impactedNodes: asNumber(impact.impactedNodes),
      rootCount: asNumber(impact.rootCount),
      headline: asString(impact.headline),
      policyPassed: evaluation.passed === true,
      policyVerdicts: verdicts.map((entry) => {
        const verdict = asRecord(entry);
        return { rule: asString(verdict.rule), status: asString(verdict.status) };
      }),
    },
    provenance,
  };
}

async function loadPrGateRoute(gateResultPath: string | undefined, readAt: string): Promise<ForgePrGateRoute> {
  if (!gateResultPath) {
    return {
      status: "not-run",
      reason: "No PR Gate result was supplied to the collector. Run the PR Gate on the forge (workflow-template.gitea.yml / workflow-template.forgejo.yml) and pass --gate-result <result.json> to embed it.",
      provenance: `solvelang-forge-receipt collector invocation, ${readAt}.`,
    };
  }
  const provenance = `SolveLang PR Gate CLI (packages/pr-gate, report-only mode) result at ${gateResultPath}, read by solvelang-forge-receipt ${readAt}.`;
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

export async function collectForgeReceiptInput(options: ForgeReceiptOptions, fetchImpl: FetchLike = defaultFetch): Promise<ForgeReceiptInput> {
  const { baseUrl, owner, repo, pr } = options;
  const repoRoute = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const readAt = new Date().toISOString();
  const platformName = options.platform === "forgejo" ? "Forgejo" : "Gitea";
  const source = `${platformName} REST API (/api/v1) at ${baseUrl.replace(/\/+$/, "")} via solvelang-forge-receipt (packages/pr-gate)`;

  const prRaw = asRecord(await forgeApiGet(baseUrl, `${repoRoute}/pulls/${pr}`, options.token, fetchImpl));
  const filesRaw = await forgeApiGetAll(baseUrl, `${repoRoute}/pulls/${pr}/files`, options.token, fetchImpl);
  const files = filesRaw.map(mapForgeChangedFile);
  const reviewsRaw = await forgeApiGetAll(baseUrl, `${repoRoute}/pulls/${pr}/reviews`, options.token, fetchImpl);
  const reviews = reviewsRaw.map(mapForgeReview).filter((review): review is ForgeReceiptReview => review !== null);
  const commitsRaw = await forgeApiGetAll(baseUrl, `${repoRoute}/pulls/${pr}/commits`, options.token, fetchImpl);

  const mappedPr = mapForgePullRequest(prRaw, owner, repo, commitsRaw.length, files);
  if (!mappedPr.headSha) {
    throw new ForgeCollectError(`Forge API PR response for ${owner}/${repo}#${pr} carried no head SHA.`);
  }
  const combined = asRecord(await forgeApiGet(baseUrl, `${repoRoute}/commits/${mappedPr.headSha}/status`, options.token, fetchImpl));
  const checkRuns = mapForgeCheckRuns(combined);

  // Compare is the one section allowed to degrade: the builder labels a
  // null compare "unverified" instead of guessing base drift.
  let compare: ForgeReceiptCompare | null = null;
  try {
    const aheadRaw = asRecord(await forgeApiGet(baseUrl, `${repoRoute}/compare/${encodeURIComponent(mappedPr.baseRef)}...${encodeURIComponent(mappedPr.headRef)}`, options.token, fetchImpl));
    const behindRaw = asRecord(await forgeApiGet(baseUrl, `${repoRoute}/compare/${encodeURIComponent(mappedPr.headRef)}...${encodeURIComponent(mappedPr.baseRef)}`, options.token, fetchImpl));
    compare = mapForgeCompare(asNumber(aheadRaw.total_commits), asNumber(behindRaw.total_commits));
  } catch {
    compare = null;
  }

  const prGate = await loadPrGateRoute(options.gateResultPath, readAt);

  return { pr: mappedPr, files, checkRuns, reviews, compare, prGate, readAt, source };
}

// --- CLI ---

export type ForgeReceiptCliOptions = ForgeReceiptOptions & { outPath?: string };

export function parseForgeReceiptArgs(argv: string[]): ForgeReceiptCliOptions {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new ForgeCollectError(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new ForgeCollectError(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  const platform = parsed.platform ?? "gitea";
  if (platform !== "gitea" && platform !== "forgejo") {
    throw new ForgeCollectError(`--platform must be "gitea" or "forgejo", got "${platform}".`);
  }
  const pr = Number(parsed.pr);
  if (!parsed["base-url"] || !parsed.owner || !parsed.repo || !Number.isInteger(pr) || pr <= 0) {
    throw new ForgeCollectError("Required: --base-url <instance URL> --owner <owner> --repo <repo> --pr <number>.");
  }
  return {
    baseUrl: parsed["base-url"],
    owner: parsed.owner,
    repo: parsed.repo,
    pr,
    platform,
    token: parsed.token ?? process.env.FORGE_TOKEN ?? process.env.GITEA_TOKEN ?? process.env.FORGEJO_TOKEN,
    gateResultPath: parsed["gate-result"],
    outPath: parsed.out,
  };
}

const USAGE = `Usage: solvelang-forge-receipt --base-url <url> --owner <owner> --repo <repo> --pr <number> [options]

Reads one pull request from a Gitea or Forgejo instance and writes a
Change Impact Receipt input JSON object (the shape consumed by
site/app/change-impact-receipt) to --out or stdout.

  --base-url <url>      Instance root, e.g. https://git.example.com (required)
  --owner <owner>       Repository owner (required)
  --repo <repo>         Repository name (required)
  --pr <number>         Pull request number (required)
  --platform <name>     "gitea" (default) or "forgejo" — names the API in
                        the receipt provenance; both forges share /api/v1
  --token <token>       API token. Falls back to FORGE_TOKEN, GITEA_TOKEN,
                        FORGEJO_TOKEN. Never stored or printed.
  --gate-result <path>  A PR Gate result.json (solvelang.pr-gate.result.v1)
                        to embed as the receipt's PR Gate route
  --out <path>          Write the input JSON to this file instead of stdout

Exit codes: 0 = input emitted, 2 = operational error.`;

export async function main(argv: string[]): Promise<number> {
  let options: ForgeReceiptCliOptions;
  try {
    options = parseForgeReceiptArgs(argv);
  } catch (caught) {
    console.error(`forge-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    console.error(USAGE);
    return 2;
  }
  try {
    const input = await collectForgeReceiptInput(options);
    const json = `${JSON.stringify(input, null, 2)}\n`;
    if (options.outPath) {
      await writeFile(options.outPath, json, "utf8");
      console.log(`forge-receipt: receipt input for ${options.owner}/${options.repo}#${options.pr} written to ${options.outPath}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (caught) {
    console.error(`forge-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
