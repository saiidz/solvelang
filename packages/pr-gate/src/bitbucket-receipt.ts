#!/usr/bin/env node
// SolveLang Change Impact Receipt collector for Bitbucket Cloud.
//
// Reads one pull request from Bitbucket Cloud's REST API (2.0) and
// emits a Change Impact Receipt INPUT object: the exact JSON shape
// the Change Impact Receipts page (site/app/change-impact-receipt)
// consumes and turns into a receipt with buildChangeImpactReceipt.
// It is the Bitbucket Cloud sibling of solvelang-forge-receipt
// (src/forge-receipt.ts), solvelang-gitlab-receipt
// (src/gitlab-receipt.ts), and solvelang-azure-receipt
// (src/azure-receipt.ts); the field contract is the same
// ChangeImpactReceiptInput in
// site/app/change-impact-receipt/core/receipt.ts, and the QA pins in
// test/bitbucket-receipt-qa.test.ts assert the four stay in lock-step.
//
// Bitbucket Data Center is a different product with a different API
// (the /rest/api family); this collector is Cloud-only, and nothing
// here claims Data Center behavior.
//
// Every wire shape below was verified on 2026-11-25 against
// Atlassian's REST API documentation
// (developer.atlassian.com/cloud/bitbucket/rest) and first-hand
// against the public atlassian/aui repository read anonymously. The
// Bitbucket facts that shape this collector:
//
//   - A PR's change list is its DIFFSTAT. The PR diffstat endpoint
//     answers with per-file entries carrying status (added /
//     modified / removed / renamed) and lines_added / lines_removed —
//     the counts Bitbucket itself computed for the PR. (Unlike Azure,
//     whose iteration changes carry no line counts at all, Bitbucket
//     returns them, so they are recorded as returned — never
//     estimated.) The endpoint redirects to the repository diffstat;
//     fetch follows the redirect. Entries are paged with the standard
//     { values, next } envelope.
//   - Bitbucket Cloud computes NO combined-tree (merge-result)
//     preview for a pull request: there is no merge queue in Cloud
//     and no endpoint that shows the tree a merge would produce.
//     The diffstat is the source branch read against the destination
//     as Bitbucket tracks it — nothing here claims what a merge
//     WOULD produce, only what the PR's records show.
//   - There is NO mergeability verdict to read. The PR object
//     carries no mergeable/conflict field, and GET on the merge
//     endpoint is 405 — merging is POST-only (verified first-hand).
//     Merge checks (approvals, changes requested, tasks, successful
//     builds) are branch-restriction settings evaluated by
//     Bitbucket's UI; they are not data on the PR record, and the
//     branch-restrictions surface that holds them is a settings API,
//     not a PR read. So mergeable is null and the state is "unknown"
//     for every PR: no mergeability claim is made, ever.
//   - Review evidence is the PR's PARTICIPANTS list: each
//     participant carries a role (REVIEWER or PARTICIPANT), an
//     approved flag, and a state (null, "approved", or
//     "changes_requested"). The separate reviewers list names who
//     was asked; it carries no verdicts. Verdicts are mapped from
//     participants of both roles, because Bitbucket records
//     approvals on the participant list and its own approvals merge
//     check counts participant approvals (its check excludes the
//     author's own approval; the receipt records verdicts as
//     recorded and evaluates no check itself).
//   - CI evidence is the PR's build-status list
//     (GET /pullrequests/{id}/statuses): the build statuses
//     Bitbucket attaches to the pull request — the statuses of its
//     latest commit. Statuses are keyed: posting a status with an
//     existing key overwrites it, so the list is already the newest
//     word per key and needs no currency reduction (unlike Azure's
//     per-iteration status history).
//   - The PR object abbreviates commit hashes (12 characters) in
//     source.commit / destination.commit. The full head SHA is the
//     first entry of the PR's commits list (newest first); the full
//     current destination head is read from the refs endpoint
//     (GET /refs/branches/{branch} → target.hash). destination.commit
//     is that same head, abbreviated — verified first-hand.
//   - The PR object has both created_on and updated_on (Azure's has
//     neither an updated date nor a full hash), and a draft flag,
//     and links.html.href is the human URL — all used as returned.
//   - There is no compare endpoint with ahead/behind counts. The
//     counts are the lengths of the commit listings read with
//     include/exclude (GET /commits?include=<sha>&exclude=<sha>),
//     paged in full — the only counts the API exposes.
//   - The PR object also carries task_count and comment_count; the
//     receipt contract has no field for them, so they are not
//     carried. (task_count is the number the "No unresolved pull
//     request tasks" merge check reads — named here so the omission
//     is a decision, not an oversight.)
//
// Provenance discipline (the receipt builder's rules, applied at the
// collection step):
//   - The credential is supplied by the operator at runtime (--token
//     for an access token — a repository, workspace, or project
//     access token, or an OAuth token — sent as Bearer; or
//     --username with --api-token for an Atlassian API token, sent as
//     HTTP Basic with the account email) and is never stored, logged,
//     or written to the output. Public repositories read without one.
//   - A section that cannot be read (PR, diffstat, commits,
//     statuses) is an operational error (exit 2): emitting a partial
//     input would let the builder print "verified" findings the
//     records do not support.
//   - The compare section is the one honest exception: when either
//     include/exclude listing cannot answer, compare is null and the
//     builder labels base drift unverified rather than guessing.
//   - The current destination head is read from the refs endpoint;
//     if that read fails (for example the destination branch was
//     deleted after the PR closed), baseSha falls back to the PR's
//     destination.commit as returned (abbreviated) and compare is
//     null, because drift against the CURRENT base is then not
//     established.
//   - Platform vocabulary is mapped, never invented: the mapping
//     functions below translate Bitbucket's PR states, diffstat
//     statuses, participant verdicts, and build-status states into
//     the receipt builder's vocabulary, and the mappings are pinned
//     by tests.
//
// Exit codes mirror the PR Gate CLI: 0 = input emitted, 2 =
// operational error (bad arguments, unreachable API, unreadable
// section).

import { readFile, writeFile } from "node:fs/promises";

import {
  mapForgeCompare,
  mapPrGateResult,
  type ForgePrGateRoute,
  type ForgeReceiptChangedFile,
  type ForgeReceiptCheckRun,
  type ForgeReceiptCompare,
  type ForgeReceiptInput,
  type ForgeReceiptPullRequest,
  type ForgeReceiptReview,
} from "./forge-receipt";

// The Bitbucket collector emits the same receipt input contract as
// the forge, GitLab, and Azure collectors; the types are aliases so
// they cannot drift.
export type BitbucketReceiptPullRequest = ForgeReceiptPullRequest;
export type BitbucketReceiptChangedFile = ForgeReceiptChangedFile;
export type BitbucketReceiptCheckRun = ForgeReceiptCheckRun;
export type BitbucketReceiptReview = ForgeReceiptReview;
export type BitbucketReceiptCompare = ForgeReceiptCompare;
export type BitbucketPrGateRoute = ForgePrGateRoute;
export type BitbucketReceiptInput = ForgeReceiptInput;

export type BitbucketReceiptOptions = {
  baseUrl?: string;
  workspace: string;
  repository: string;
  pr: number;
  token?: string;
  username?: string;
  apiToken?: string;
  gateResultPath?: string;
};

export class BitbucketCollectError extends Error {}

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponse>;

const defaultFetch: FetchLike = (url, init) => (globalThis as { fetch: FetchLike }).fetch(url, init);

export const DEFAULT_BITBUCKET_BASE_URL = "https://api.bitbucket.org/2.0";

function authHeaders(options: BitbucketReceiptOptions): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.token) {
    // An access token (repository / workspace / project) or an OAuth
    // token is presented as a bearer token.
    headers.authorization = `Bearer ${options.token}`;
  } else if (options.username && options.apiToken) {
    // An Atlassian API token is presented as HTTP Basic with the
    // account email as the user name (Atlassian's documented route).
    headers.authorization = `Basic ${Buffer.from(`${options.username}:${options.apiToken}`, "utf8").toString("base64")}`;
  }
  return headers;
}

function apiRoot(options: BitbucketReceiptOptions): string {
  const base = (options.baseUrl ?? DEFAULT_BITBUCKET_BASE_URL).replace(/\/+$/, "");
  return `${base}/repositories/${encodeURIComponent(options.workspace)}/${encodeURIComponent(options.repository)}`;
}

async function bitbucketApiGet(options: BitbucketReceiptOptions, url: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { headers: authHeaders(options) });
  } catch (caught) {
    throw new BitbucketCollectError(`Bitbucket API request failed for ${url}: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  if (!response.ok) {
    throw new BitbucketCollectError(`Bitbucket API request failed for ${url}: HTTP ${response.status}.`);
  }
  return response.json();
}

// Paged list read: Bitbucket list endpoints answer with the
// { values, next } envelope; `next` is an absolute URL for the
// following page and is absent on the last page. A page that does not
// carry a values list is a malformed answer, not an empty page.
async function bitbucketApiGetAll(
  options: BitbucketReceiptOptions,
  route: string,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let url: string | null = `${apiRoot(options)}${route}${route.includes("?") ? "&" : "?"}pagelen=100`;
  while (url !== null) {
    const body = asRecord(await bitbucketApiGet(options, url, fetchImpl));
    if (!Array.isArray(body.values)) {
      throw new BitbucketCollectError(`Bitbucket API request for ${route} did not return a values list.`);
    }
    items.push(...(body.values as Record<string, unknown>[]));
    url = typeof body.next === "string" && body.next !== "" ? body.next : null;
  }
  return items;
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

// Bitbucket exposes no mergeability verdict (see the header: the
// merge endpoint is POST-only and the PR object carries no
// mergeable/conflict field; merge checks are branch-restriction
// settings, not PR data). The receipt builder prints the state
// string next to its own verdict, so the only honest record is no
// claim: mergeable null, state "unknown", for every PR state —
// including merged ones, whose record describes the merge that
// happened, not a mergeability read.
export function mergeableForBitbucket(): { mergeable: boolean | null; mergeableState: string } {
  return { mergeable: null, mergeableState: "unknown" };
}

// Bitbucket PR states: OPEN, MERGED, DECLINED, SUPERSEDED (a PR
// whose source was superseded by a rewrite). The receipt vocabulary
// is GitHub-shaped: OPEN is "open", MERGED is "merged", DECLINED is
// "closed" (Bitbucket's decline is its close-without-merge), and
// SUPERSEDED is "closed" (the PR is finished and will never merge).
// An unrecognized state passes through unchanged rather than being
// renamed into a claim Bitbucket did not make.
export function mapBitbucketPrState(state: string): string {
  if (state === "OPEN") return "open";
  if (state === "MERGED") return "merged";
  if (state === "DECLINED") return "closed";
  if (state === "SUPERSEDED") return "closed";
  return state;
}

// A Bitbucket user's display identity for the receipt: the display
// name the PR pages show, falling back to the nickname (the username
// equivalent), then the account id, then "unknown".
export function bitbucketUserName(user: Record<string, unknown>): string {
  return asString(user.display_name, asString(user.nickname, asString(user.account_id, "unknown")));
}

export function mapBitbucketPullRequest(
  raw: Record<string, unknown>,
  owner: string,
  repo: string,
  webUrl: string,
  baseSha: string,
  headSha: string,
  commits: number,
  files: BitbucketReceiptChangedFile[],
): BitbucketReceiptPullRequest {
  const source = asRecord(raw.source);
  const destination = asRecord(raw.destination);
  const { mergeable, mergeableState } = mergeableForBitbucket();
  return {
    owner,
    repo,
    number: asNumber(raw.id),
    title: asString(raw.title),
    url: webUrl,
    state: mapBitbucketPrState(asString(raw.state)),
    draft: raw.draft === true,
    author: bitbucketUserName(asRecord(raw.author)),
    createdAt: asString(raw.created_on),
    updatedAt: asString(raw.updated_on),
    headSha,
    headRef: asString(asRecord(source.branch).name),
    baseRef: asString(asRecord(destination.branch).name),
    baseSha,
    mergeable,
    mergeableState,
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    commits,
  };
}

// Bitbucket diffstat statuses: added, modified, removed, renamed.
// The receipt vocabulary is the forge/GitLab one: added / deleted /
// renamed / modified. "removed" is Bitbucket's word for a deletion.
// An unrecognized status maps to "modified" — the entry records a
// change to the file, and nothing is upgraded to a claim Bitbucket
// did not make (the Azure mapping does the same for its change
// types).
export function mapBitbucketDiffstatStatus(status: string): string {
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

// One diffstat entry. The path is the new path; a removed file has
// no new side, so its path comes from the old side. Line counts are
// Bitbucket's own lines_added / lines_removed for the file,
// recorded as returned — never estimated. An entry with no path on
// either side names no file and is dropped.
export function mapBitbucketChangedFile(raw: Record<string, unknown>): BitbucketReceiptChangedFile | null {
  const newPath = asString(asRecord(raw.new).path);
  const oldPath = asString(asRecord(raw.old).path);
  const path = newPath || oldPath;
  if (!path) return null;
  return {
    filename: path,
    status: mapBitbucketDiffstatStatus(asString(raw.status)),
    additions: asNumber(raw.lines_added),
    deletions: asNumber(raw.lines_removed),
  };
}

// Participant verdicts. A participant's state is "changes_requested"
// when they have requested changes — Bitbucket's recorded refusal to
// approve — and maps to CHANGES_REQUESTED, mirroring how the forge
// mapping translates REQUEST_CHANGES. The approved flag (with state
// "approved") is an approval and maps to APPROVED. Anything else —
// no verdict recorded — is not a review and is dropped, mirroring
// the forge mapping's drop of PENDING / REQUEST_REVIEW. Both roles
// are mapped (see the header: verdicts live on the participant list,
// and Bitbucket counts participant approvals).
export function mapBitbucketParticipant(raw: Record<string, unknown>): BitbucketReceiptReview | null {
  const state = asString(raw.state);
  if (state === "changes_requested") {
    return { author: bitbucketUserName(asRecord(raw.user)), state: "CHANGES_REQUESTED" };
  }
  if (raw.approved === true || state === "approved") {
    return { author: bitbucketUserName(asRecord(raw.user)), state: "APPROVED" };
  }
  return null;
}

// Bitbucket build-status states: SUCCESSFUL, FAILED, INPROGRESS,
// STOPPED. The receipt vocabulary is check runs: SUCCESSFUL is a
// completed success; FAILED is a completed failure; INPROGRESS is
// still running; STOPPED — a build halted before it could pass —
// maps to the "cancelled" conclusion (neither a pass nor a test
// failure). An unrecognized state falls back the way the forge
// mapping does: completed, with the raw state as the conclusion.
// The name is the status's display name, falling back to its key
// (the key is the status's stable identity — the wrapper posts
// under a fixed key).
export function mapBitbucketStatus(raw: Record<string, unknown>): BitbucketReceiptCheckRun {
  const name = asString(raw.name, asString(raw.key, "build"));
  const state = asString(raw.state);
  if (state === "SUCCESSFUL") return { name, status: "completed", conclusion: "success" };
  if (state === "FAILED") return { name, status: "completed", conclusion: "failure" };
  if (state === "INPROGRESS") return { name, status: "in_progress", conclusion: null };
  if (state === "STOPPED") return { name, status: "completed", conclusion: "cancelled" };
  return { name, status: "completed", conclusion: state === "" ? null : state };
}

// --- PR Gate route embedding ---

async function loadPrGateRoute(gateResultPath: string | undefined, readAt: string): Promise<BitbucketPrGateRoute> {
  if (!gateResultPath) {
    return {
      status: "not-run",
      reason: "No PR Gate result was supplied to the collector. Run the PR Gate on Bitbucket Pipelines (workflow-template.bitbucket-pipelines.yml) and pass --gate-result <result.json> to embed it.",
      provenance: `solvelang-bitbucket-receipt collector invocation, ${readAt}.`,
    };
  }
  const provenance = `SolveLang PR Gate CLI (packages/pr-gate, report-only mode) result at ${gateResultPath}, read by solvelang-bitbucket-receipt ${readAt}.`;
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

export async function collectBitbucketReceiptInput(options: BitbucketReceiptOptions, fetchImpl: FetchLike = defaultFetch): Promise<BitbucketReceiptInput> {
  const { workspace, pr } = options;
  const readAt = new Date().toISOString();
  const baseUrl = (options.baseUrl ?? DEFAULT_BITBUCKET_BASE_URL).replace(/\/+$/, "");
  const source = `Bitbucket Cloud REST API (2.0) at ${baseUrl} via solvelang-bitbucket-receipt (packages/pr-gate)`;
  const root = apiRoot(options);

  const prRaw = asRecord(await bitbucketApiGet(options, `${root}/pullrequests/${pr}`, fetchImpl));
  if (Object.keys(prRaw).length === 0) {
    throw new BitbucketCollectError(`Bitbucket API returned an empty pull request object for PR ${pr}.`);
  }
  // The PR belongs to its destination repository (for a fork PR the
  // source lives elsewhere); its full_name names the receipt's repo.
  const destination = asRecord(prRaw.destination);
  const destinationRepo = asRecord(destination.repository);
  const fullName = asString(destinationRepo.full_name);
  const [ownerFromApi, repoFromApi] = fullName.split("/");
  const owner = ownerFromApi || workspace;
  const repo = repoFromApi || options.repository;
  const links = asRecord(prRaw.links);
  const webUrl = asString(asRecord(links.html).href, `https://bitbucket.org/${owner}/${repo}/pull-requests/${pr}`);

  const sourceBranch = asRecord(asRecord(prRaw.source).branch);
  const destinationBranch = asRecord(destination.branch);
  const baseRef = asString(destinationBranch.name);
  const sourceCommit = asRecord(asRecord(prRaw.source).commit);
  const destinationCommit = asRecord(destination.commit);

  // The changed-file list: the PR's diffstat, paged in full (the
  // endpoint redirects to the repository diffstat; fetch follows).
  const diffstatRaw = await bitbucketApiGetAll(options, `/pullrequests/${pr}/diffstat`, fetchImpl);
  const files = diffstatRaw.map(mapBitbucketChangedFile).filter((file): file is BitbucketReceiptChangedFile => file !== null);

  // The PR's commits, newest first: the count is the receipt's
  // commit count, and the first entry's full hash is the head SHA
  // (the PR object abbreviates it). With no commits readable the
  // head falls back to source.commit as returned.
  const commitsRaw = await bitbucketApiGetAll(options, `/pullrequests/${pr}/commits`, fetchImpl);
  const headSha = commitsRaw.length > 0 ? asString(asRecord(commitsRaw[0]).hash, asString(sourceCommit.hash)) : asString(sourceCommit.hash);
  if (!headSha) {
    throw new BitbucketCollectError(`Bitbucket API responses for PR ${pr} carried no head SHA (PR commits list empty and source.commit empty).`);
  }

  const participantsRaw = Array.isArray(prRaw.participants) ? (prRaw.participants as Record<string, unknown>[]) : [];
  const reviews = participantsRaw.map(mapBitbucketParticipant).filter((review): review is BitbucketReceiptReview => review !== null);

  // CI evidence: the build statuses Bitbucket attaches to the PR.
  const statusesRaw = await bitbucketApiGetAll(options, `/pullrequests/${pr}/statuses`, fetchImpl);
  const checkRuns = statusesRaw.map(mapBitbucketStatus);

  // Current destination head: the refs endpoint names the branch's
  // head in full as of this read. If it cannot be read, fall back to
  // the PR's destination.commit as returned (abbreviated) and skip
  // the compare — drift against the current base is not established.
  let baseSha = asString(destinationCommit.hash);
  let baseIsCurrent = false;
  if (baseRef) {
    try {
      const branchRaw = asRecord(await bitbucketApiGet(options, `${root}/refs/branches/${encodeURIComponent(baseRef)}`, fetchImpl));
      const targetHash = asString(asRecord(branchRaw.target).hash);
      if (targetHash) {
        baseSha = targetHash;
        baseIsCurrent = true;
      }
    } catch {
      baseIsCurrent = false;
    }
  }

  const mappedPr = mapBitbucketPullRequest(prRaw, owner, repo, webUrl, baseSha, headSha, commitsRaw.length, files);

  // Compare is the one section allowed to degrade: the builder
  // labels a null compare "unverified" instead of guessing base
  // drift. Bitbucket exposes no compare counts, so ahead/behind are
  // the lengths of the two include/exclude commit listings, each
  // paged in full: ahead = commits the head has that the current
  // base lacks; behind = the reverse.
  let compare: BitbucketReceiptCompare | null = null;
  if (baseIsCurrent && baseSha) {
    try {
      const ahead = await bitbucketApiGetAll(options, `/commits?include=${encodeURIComponent(headSha)}&exclude=${encodeURIComponent(baseSha)}`, fetchImpl);
      const behind = await bitbucketApiGetAll(options, `/commits?include=${encodeURIComponent(baseSha)}&exclude=${encodeURIComponent(headSha)}`, fetchImpl);
      compare = mapForgeCompare(ahead.length, behind.length);
    } catch {
      compare = null;
    }
  }

  const prGate = await loadPrGateRoute(options.gateResultPath, readAt);

  return { pr: mappedPr, files, checkRuns, reviews, compare, prGate, readAt, source };
}

// --- CLI ---

export type BitbucketReceiptCliOptions = BitbucketReceiptOptions & { outPath?: string };

export function parseBitbucketReceiptArgs(argv: string[]): BitbucketReceiptCliOptions {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new BitbucketCollectError(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new BitbucketCollectError(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  const pr = Number(parsed.pr);
  if (!parsed.workspace || !parsed.repository || !Number.isInteger(pr) || pr <= 0) {
    throw new BitbucketCollectError("Required: --workspace <workspace> --repository <repo slug> --pr <id>.");
  }
  return {
    baseUrl: parsed["base-url"] ?? process.env.BITBUCKET_API_BASE_URL,
    workspace: parsed.workspace,
    repository: parsed.repository,
    pr,
    token: parsed.token ?? process.env.BITBUCKET_TOKEN,
    username: parsed.username ?? process.env.BITBUCKET_USERNAME,
    apiToken: parsed["api-token"] ?? process.env.BITBUCKET_API_TOKEN,
    gateResultPath: parsed["gate-result"],
    outPath: parsed.out,
  };
}

const USAGE = `Usage: solvelang-bitbucket-receipt --workspace <workspace> --repository <repo slug> --pr <id> [options]

Reads one pull request from Bitbucket Cloud and writes a Change
Impact Receipt input JSON object (the shape consumed by
site/app/change-impact-receipt) to --out or stdout.

  --workspace <slug>    Workspace that owns the repository (required)
  --repository <slug>   Repository slug containing the pull request
                        (required)
  --pr <id>             Pull request id (the number in the PR URL)
                        (required)
  --base-url <url>      API root (default
                        https://api.bitbucket.org/2.0). Falls back to
                        BITBUCKET_API_BASE_URL.
  --token <token>       Access token (repository / workspace /
                        project) or OAuth token, sent as Bearer.
                        Falls back to BITBUCKET_TOKEN. Never stored
                        or printed. Public repositories read without
                        one.
  --username <email>    Atlassian account email for API-token Basic
                        auth; falls back to BITBUCKET_USERNAME. Used
                        with --api-token when no --token is given.
  --api-token <token>   Atlassian API token, sent as HTTP Basic with
                        --username. Falls back to BITBUCKET_API_TOKEN.
  --gate-result <path>  A PR Gate result.json (solvelang.pr-gate.result.v1)
                        to embed as the receipt's PR Gate route
  --out <path>          Write the input JSON to this file instead of stdout

Exit codes: 0 = input emitted, 2 = operational error.`;

export async function main(argv: string[]): Promise<number> {
  let options: BitbucketReceiptCliOptions;
  try {
    options = parseBitbucketReceiptArgs(argv);
  } catch (caught) {
    console.error(`bitbucket-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    console.error(USAGE);
    return 2;
  }
  try {
    const input = await collectBitbucketReceiptInput(options);
    const json = `${JSON.stringify(input, null, 2)}\n`;
    if (options.outPath) {
      await writeFile(options.outPath, json, "utf8");
      console.log(`bitbucket-receipt: receipt input for ${options.workspace}/${options.repository} PR ${options.pr} written to ${options.outPath}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (caught) {
    console.error(`bitbucket-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
