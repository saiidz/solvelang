#!/usr/bin/env node
// SolveLang Change Impact Receipt collector for Azure DevOps.
//
// Reads one pull request from an Azure DevOps organization's REST API
// (api-version 7.1, Azure Repos Git) and emits a Change Impact Receipt
// INPUT object: the exact JSON shape the Change Impact Receipts page
// (site/app/change-impact-receipt) consumes and turns into a receipt
// with buildChangeImpactReceipt. It is the Azure DevOps sibling of
// solvelang-forge-receipt (src/forge-receipt.ts) and
// solvelang-gitlab-receipt (src/gitlab-receipt.ts); the field contract
// is the same ChangeImpactReceiptInput in
// site/app/change-impact-receipt/core/receipt.ts, and the QA pins in
// test/azure-receipt-qa.test.ts assert the three stay in lock-step.
//
// Every wire shape below was verified against Microsoft's own REST API
// documentation (learn.microsoft.com/en-us/rest/api/azure/devops/git,
// api-version 7.1) on 2026-11-24 — field names, enums, and status
// codes are not assumed. The Azure facts that shape this collector:
//
//   - A PR's change list is its ITERATIONS. Each push creates an
//     iteration; the latest iteration's changes endpoint, read with
//     the default $compareTo of 0, returns the PR's full change list
//     "made against the common commit between the source and target
//     branches" (Microsoft's wording). The changed-file list below is
//     that list, walked page by page via nextSkip/nextTop — it is the
//     per-file record Azure itself computed for the PR, not a diff
//     this tool reconstructs.
//   - The merge-base equivalent is the latest iteration's
//     commonRefCommit: "the first common Git commit of the source and
//     target refs" (Microsoft's wording). Azure has no general
//     merge-base endpoint and NO combined-tree preview equivalent to
//     GitHub's: nothing here claims what a merge WOULD produce, only
//     what the iteration records show. (When the PR carries
//     hasMultipleMergeBases, Azure itself warns the common commit is
//     not unique; the iteration's commonRefCommit is still the base
//     Azure used for its own diff, and it is the one recorded.)
//   - The PR object carries no per-file line counts and the iteration
//     changes carry no diff text, so additions/deletions are 0/0 for
//     every file: the API does not carry the numbers, and they are
//     recorded as zero, never estimated. (GitLab's collector counts
//     diff text because GitLab returns it; Azure does not.)
//   - The PR object's `url` is its REST URL (Microsoft's schema marks
//     it "used internally"), so the human URL is built from the
//     documented web route {org}/{project}/_git/{repo}/pullrequest/{id}.
//   - The PR object has no updated-date field; updatedAt is the
//     latest iteration's updatedDate — the last recorded change to
//     the PR's source side — falling back to the creation date.
//   - Review evidence is the PR's reviewers list: each reviewer's
//     current vote (10 approved, 5 approved with suggestions, 0 no
//     vote, -5 waiting for author, -10 rejected — Microsoft's
//     enumeration). There is no separate reviews endpoint to read.
//   - CI evidence is the PR status list (the PR Status API): the
//     statuses services and extensions post to the PR. Only statuses
//     attached to the LATEST iteration (plus any carrying no
//     iteration id) are current evidence; older iterations' statuses
//     are history. Per context (genre/name) the newest status wins.
//
// Provenance discipline (the receipt builder's rules, applied at the
// collection step):
//   - The credential is supplied by the operator at runtime (--token
//     for a personal access token, sent as HTTP Basic with an empty
//     user name — Microsoft's PAT route; --bearer-token for an
//     Entra/OAuth token, sent as Bearer) and is never stored, logged,
//     or written to the output. Public projects read without one
//     where the organization allows anonymous access.
//   - A section that cannot be read (PR, iterations, iteration
//     changes, commits, statuses) is an operational error (exit 2):
//     emitting a partial input would let the builder print "verified"
//     findings the records do not support.
//   - The compare section is the one honest exception: when the
//     diffs endpoint cannot answer, compare is null and the builder
//     labels base drift unverified rather than guessing.
//   - The current target-branch head is read from the refs endpoint;
//     if that read fails (for example the target branch was deleted
//     after completion), baseSha falls back to the latest iteration's
//     targetRefCommit — the target head the PR's own diff was
//     computed against — and compare is null, because drift against
//     the CURRENT base is then not established.
//   - Platform vocabulary is mapped, never invented: the mapping
//     functions below translate Azure's mergeStatus, reviewer votes,
//     change types, and status states into the receipt builder's
//     vocabulary, and the mappings are pinned by tests.
//
// Exit codes mirror the PR Gate CLI: 0 = input emitted, 2 = operational
// error (bad arguments, unreachable organization, unreadable section).

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

// The Azure collector emits the same receipt input contract as the
// forge and GitLab collectors; the types are aliases so they cannot
// drift.
export type AzureReceiptPullRequest = ForgeReceiptPullRequest;
export type AzureReceiptChangedFile = ForgeReceiptChangedFile;
export type AzureReceiptCheckRun = ForgeReceiptCheckRun;
export type AzureReceiptReview = ForgeReceiptReview;
export type AzureReceiptCompare = ForgeReceiptCompare;
export type AzurePrGateRoute = ForgePrGateRoute;
export type AzureReceiptInput = ForgeReceiptInput;

export type AzureReceiptOptions = {
  orgUrl: string;
  project: string;
  repository: string;
  pr: number;
  token?: string;
  bearerToken?: string;
  gateResultPath?: string;
};

export class AzureCollectError extends Error {}

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

const API_VERSION = "7.1";

function authHeaders(options: AzureReceiptOptions): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.bearerToken) {
    headers.authorization = `Bearer ${options.bearerToken}`;
  } else if (options.token) {
    // A personal access token is presented as HTTP Basic with an
    // empty user name and the token as the password (Microsoft's
    // documented PAT route).
    headers.authorization = `Basic ${Buffer.from(`:${options.token}`, "utf8").toString("base64")}`;
  }
  return headers;
}

function apiRoot(options: AzureReceiptOptions): string {
  const org = options.orgUrl.replace(/\/+$/, "");
  return `${org}/${encodeURIComponent(options.project)}/_apis/git/repositories/${encodeURIComponent(options.repository)}`;
}

async function azureApiGet(options: AzureReceiptOptions, route: string, fetchImpl: FetchLike): Promise<unknown> {
  const separator = route.includes("?") ? "&" : "?";
  const url = `${apiRoot(options)}${route}${separator}api-version=${API_VERSION}`;
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { headers: authHeaders(options) });
  } catch (caught) {
    throw new AzureCollectError(`Azure DevOps API request failed for ${route}: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  if (!response.ok) {
    throw new AzureCollectError(`Azure DevOps API request failed for ${route}: HTTP ${response.status}.`);
  }
  return response.json();
}

// Azure list endpoints answer with the { count, value } envelope.
async function azureApiGetList(options: AzureReceiptOptions, route: string, fetchImpl: FetchLike): Promise<Record<string, unknown>[]> {
  const body = asRecord(await azureApiGet(options, route, fetchImpl));
  if (!Array.isArray(body.value)) {
    throw new AzureCollectError(`Azure DevOps API request for ${route} did not return a value list.`);
  }
  return body.value as Record<string, unknown>[];
}

// Paged list read ($top/$skip), for the endpoints that can outgrow one
// page (PR commits). Stops on a short page or when the envelope's
// count is reached.
async function azureApiGetAll(options: AzureReceiptOptions, route: string, fetchImpl: FetchLike): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const top = 100;
  for (let skip = 0; ; skip += top) {
    const separator = route.includes("?") ? "&" : "?";
    const batch = await azureApiGetList(options, `${route}${separator}$top=${top}&$skip=${skip}`, fetchImpl);
    items.push(...batch);
    if (batch.length < top) return items;
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

// Azure's mergeStatus (PullRequestAsyncStatus in Microsoft's schema):
// notSet, queued, conflicts, succeeded, rejectedByPolicy, failure. It
// describes the server-side merge Azure computed for the PR's current
// iteration (lastMergeCommit). The receipt builder prints the state
// string next to its own mergeable verdict, so the mapping must not
// claim more than Azure said:
//   - "conflicts" is "dirty": Azure computed the merge and it failed
//     on conflicts;
//   - "succeeded" means Azure produced the merge commit — the
//     branches merge — recorded as "unstable" (mergeable per the API,
//     with CI and review state reported separately), mirroring the
//     forge and GitLab mappings;
//   - "rejectedByPolicy" means a branch policy rejected the
//     completion: the branches merge but a named gate blocks, so
//     mergeable is true and the state string is Azure's own word,
//     mirroring the GitLab named-gate mapping;
//   - "failure" is a merge job failure Azure does not further
//     classify in this field (mergeFailureType/mergeFailureMessage
//     carry what detail exists): no mergeability claim, Azure's word
//     kept as the state;
//   - "queued" / "notSet" mean Azure has not finished computing:
//     mergeable null, state "unknown".
// Mergeability is only claimed for ACTIVE pull requests at all: a
// completed PR's mergeStatus describes the merge that happened, not
// mergeability now, so completed/abandoned PRs record null /
// "unknown" — no merge was attempted for this read-only receipt.
export function mergeableForAzure(raw: Record<string, unknown>): { mergeable: boolean | null; mergeableState: string } {
  if (asString(raw.status) !== "active") return { mergeable: null, mergeableState: "unknown" };
  const mergeStatus = asString(raw.mergeStatus);
  if (mergeStatus === "conflicts") return { mergeable: false, mergeableState: "dirty" };
  if (mergeStatus === "succeeded") return { mergeable: true, mergeableState: "unstable" };
  if (mergeStatus === "rejectedByPolicy") return { mergeable: true, mergeableState: "rejectedByPolicy" };
  if (mergeStatus === "failure") return { mergeable: null, mergeableState: "failure" };
  return { mergeable: null, mergeableState: "unknown" };
}

// Azure PR status (PullRequestStatus): active, abandoned, completed,
// notSet. The receipt vocabulary is GitHub-shaped: active is "open",
// abandoned is "closed", completed is "merged" (an Azure PR completes
// by merging; there is no close-without-merge state to confuse it
// with — abandoning is that state, mapped above).
export function mapAzurePrState(status: string): string {
  if (status === "active") return "open";
  if (status === "abandoned") return "closed";
  if (status === "completed") return "merged";
  return status;
}

function stripRefPrefix(refName: string): string {
  return refName.replace(/^refs\/heads\//, "");
}

export function mapAzurePullRequest(
  raw: Record<string, unknown>,
  owner: string,
  repo: string,
  webUrl: string,
  baseSha: string,
  headSha: string,
  updatedAt: string,
  commits: number,
  files: AzureReceiptChangedFile[],
): AzureReceiptPullRequest {
  const createdBy = asRecord(raw.createdBy);
  const { mergeable, mergeableState } = mergeableForAzure(raw);
  return {
    owner,
    repo,
    number: asNumber(raw.pullRequestId),
    title: asString(raw.title),
    url: webUrl,
    state: mapAzurePrState(asString(raw.status)),
    draft: raw.isDraft === true,
    author: asString(createdBy.uniqueName, asString(createdBy.displayName, "unknown")),
    createdAt: asString(raw.creationDate),
    updatedAt,
    headSha,
    headRef: stripRefPrefix(asString(raw.sourceRefName)),
    baseRef: stripRefPrefix(asString(raw.targetRefName)),
    baseSha,
    mergeable,
    mergeableState,
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    commits,
  };
}

// Azure change types (VersionControlChangeType): add, edit, encoding,
// rename, delete, undelete, branch, merge, lock, rollback,
// sourceRename, targetRename, property, none — serialized as a single
// word or a comma-joined flag list ("edit, rename"). The receipt
// vocabulary is the forge/GitLab one: added / deleted / renamed /
// modified. A rename in any flag position is a rename; the remaining
// Azure words describe edits of one kind or another and map to
// "modified" — nothing is upgraded to a claim Azure did not make.
export function mapAzureChangeType(changeType: string): string {
  const flags = changeType.split(",").map((flag) => flag.trim().toLowerCase()).filter(Boolean);
  if (flags.includes("add")) return "added";
  if (flags.includes("delete")) return "deleted";
  if (flags.includes("rename") || flags.includes("sourcerename") || flags.includes("targetrename")) return "renamed";
  return "modified";
}

// One change entry from the latest iteration's change list. The path
// is the item's server path ("/src/a.ts") with the leading slash the
// API puts on it removed; a deleted item has no current version, so
// its path comes from sourceServerItem (the path on the server before
// the change). Folder entries (tree items) are structure, not changed
// files, and are dropped. Line counts are 0/0 — see the header: the
// API carries none for iteration changes.
export function mapAzureChangedFile(raw: Record<string, unknown>): AzureReceiptChangedFile | null {
  const item = asRecord(raw.item);
  if (item.isFolder === true || asString(item.gitObjectType) === "tree") return null;
  const path = asString(item.path, asString(raw.sourceServerItem, asString(raw.originalPath)));
  if (!path) return null;
  return {
    filename: path.replace(/^\/+/, ""),
    status: mapAzureChangeType(asString(raw.changeType)),
    additions: 0,
    deletions: 0,
  };
}

// Azure reviewer votes (IdentityRefWithVote.vote, Microsoft's
// enumeration): 10 approved, 5 approved with suggestions, 0 no vote,
// -5 waiting for author, -10 rejected. The receipt vocabulary is
// GitHub's review states:
//   - 10 and 5 are approvals (an approval with suggestions still
//     counts as an approval in Azure's own policy evaluation);
//   - -10 (rejected) and -5 (waiting for author) are the reviewer's
//     recorded refusal to approve — Azure's two negative votes — and
//     map to CHANGES_REQUESTED, mirroring how the forge mapping
//     translates REQUEST_CHANGES; the exact Azure words are stated
//     here so the translation is never mistaken for a quote;
//   - 0 is no vote at all — not a review — and is dropped, mirroring
//     the forge mapping's drop of PENDING / REQUEST_REVIEW.
// Reviewer containers (groups) do not vote themselves; their members
// appear as individual reviewers, so containers are dropped rather
// than double-counted.
export function mapAzureReview(raw: Record<string, unknown>): AzureReceiptReview | null {
  if (raw.isContainer === true) return null;
  const vote = asNumber(raw.vote);
  let state: string;
  if (vote === 10 || vote === 5) state = "APPROVED";
  else if (vote === -10 || vote === -5) state = "CHANGES_REQUESTED";
  else return null;
  return { author: asString(raw.uniqueName, asString(raw.displayName, "unknown")), state };
}

// Azure PR status states (GitStatusState): notSet, pending,
// succeeded, failed, error, notApplicable. The receipt vocabulary is
// check runs: a status that produced a result is "completed" with
// that conclusion; a pending one is still running. "error" is a
// failing gate state and the receipt vocabulary has no separate
// error conclusion, so it maps to "failure" (the forge mapping does
// the same for Gitea's error state); "notApplicable" maps to
// "neutral" (the check does not apply — neither a pass nor a fail);
// "notSet" is a required status nobody has posted yet: queued, no
// conclusion. An unrecognized state falls back the way the forge
// mapping does: completed, with the raw state as the conclusion.
export function mapAzureStatus(raw: Record<string, unknown>): AzureReceiptCheckRun {
  const context = asRecord(raw.context);
  const name = asString(context.name, "status");
  const genre = asString(context.genre);
  const label = genre ? `${genre}/${name}` : name;
  const state = asString(raw.state);
  if (state === "succeeded") return { name: label, status: "completed", conclusion: "success" };
  if (state === "failed" || state === "error") return { name: label, status: "completed", conclusion: "failure" };
  if (state === "notApplicable") return { name: label, status: "completed", conclusion: "neutral" };
  if (state === "pending") return { name: label, status: "in_progress", conclusion: null };
  if (state === "notSet") return { name: label, status: "queued", conclusion: null };
  return { name: label, status: "completed", conclusion: state === "" ? null : state };
}

// The status list is the PR's whole posting history across
// iterations. Current evidence is: statuses attached to the latest
// iteration, plus any carrying no iteration id (PR-level postings),
// reduced to the newest status per context (genre/name) — status ids
// increase with each post, so the highest id is the latest word.
// Older iterations' statuses are history, not evidence about the
// current head, and are not claimed.
export function currentAzureCheckRuns(statuses: Record<string, unknown>[], latestIterationId: number): AzureReceiptCheckRun[] {
  const byContext = new Map<string, Record<string, unknown>>();
  for (const raw of statuses) {
    const iterationId = raw.iterationId;
    if (typeof iterationId === "number" && iterationId !== latestIterationId) continue;
    const context = asRecord(raw.context);
    const key = `${asString(context.genre)}/${asString(context.name)}`;
    const existing = byContext.get(key);
    if (!existing || asNumber(raw.id) >= asNumber(existing.id)) byContext.set(key, raw);
  }
  return [...byContext.values()].map(mapAzureStatus);
}

// --- PR Gate route embedding ---

async function loadPrGateRoute(gateResultPath: string | undefined, readAt: string): Promise<AzurePrGateRoute> {
  if (!gateResultPath) {
    return {
      status: "not-run",
      reason: "No PR Gate result was supplied to the collector. Run the PR Gate on Azure DevOps (workflow-template.azure-pipelines.yml) and pass --gate-result <result.json> to embed it.",
      provenance: `solvelang-azure-receipt collector invocation, ${readAt}.`,
    };
  }
  const provenance = `SolveLang PR Gate CLI (packages/pr-gate, report-only mode) result at ${gateResultPath}, read by solvelang-azure-receipt ${readAt}.`;
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

export async function collectAzureReceiptInput(options: AzureReceiptOptions, fetchImpl: FetchLike = defaultFetch): Promise<AzureReceiptInput> {
  const { project, repository, pr } = options;
  const readAt = new Date().toISOString();
  const orgRoot = options.orgUrl.replace(/\/+$/, "");
  const source = `Azure DevOps REST API (api-version ${API_VERSION}) at ${orgRoot} via solvelang-azure-receipt (packages/pr-gate)`;

  const prRaw = asRecord(await azureApiGet(options, `/pullRequests/${pr}`, fetchImpl));
  const repoRaw = asRecord(prRaw.repository);
  const projectRaw = asRecord(repoRaw.project);
  const owner = asString(projectRaw.name, project);
  const repo = asString(repoRaw.name, repository);
  const webUrl = `${orgRoot}/${encodeURIComponent(owner)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr}`;

  // Iterations ground the whole receipt: the file list, the head, and
  // the base all come from the PR's own iteration records.
  const iterations = await azureApiGetList(options, `/pullRequests/${pr}/iterations`, fetchImpl);
  if (iterations.length === 0) {
    throw new AzureCollectError(`Azure DevOps API returned no iterations for PR ${pr}; the change list cannot be grounded in iteration data.`);
  }
  const latest = iterations.reduce((a, b) => (asNumber(b.id) > asNumber(a.id) ? b : a));
  const latestIterationId = asNumber(latest.id);
  const sourceRefCommit = asRecord(latest.sourceRefCommit);
  const targetRefCommit = asRecord(latest.targetRefCommit);
  const headSha = asString(sourceRefCommit.commitId, asString(asRecord(prRaw.lastMergeSourceCommit).commitId));
  if (!headSha) {
    throw new AzureCollectError(`Azure DevOps API responses for PR ${pr} carried no head SHA (latest iteration sourceRefCommit and lastMergeSourceCommit both empty).`);
  }
  const updatedAt = asString(latest.updatedDate, asString(prRaw.creationDate));

  // The changed-file list: the latest iteration's changes against the
  // common commit (the endpoint's default comparison), walked page by
  // page until Azure reports no next page.
  const files: AzureReceiptChangedFile[] = [];
  for (let skip = 0, top = 200; ; ) {
    const changesRaw = asRecord(
      await azureApiGet(options, `/pullRequests/${pr}/iterations/${latestIterationId}/changes?$top=${top}&$skip=${skip}`, fetchImpl),
    );
    const entries = Array.isArray(changesRaw.changeEntries) ? (changesRaw.changeEntries as Record<string, unknown>[]) : null;
    if (!entries) {
      throw new AzureCollectError(`Azure DevOps API iteration-changes response for PR ${pr} carried no changeEntries list.`);
    }
    for (const entry of entries) {
      const file = mapAzureChangedFile(entry);
      if (file) files.push(file);
    }
    const nextSkip = asNumber(changesRaw.nextSkip);
    if (nextSkip <= skip || entries.length === 0) break;
    skip = nextSkip;
    const nextTop = asNumber(changesRaw.nextTop);
    if (nextTop > 0) top = nextTop;
  }

  const commitsRaw = await azureApiGetAll(options, `/pullRequests/${pr}/commits`, fetchImpl);

  const reviewersRaw = Array.isArray(prRaw.reviewers) ? (prRaw.reviewers as Record<string, unknown>[]) : [];
  const reviews = reviewersRaw.map(mapAzureReview).filter((review): review is AzureReceiptReview => review !== null);

  const statusesRaw = await azureApiGetList(options, `/pullRequests/${pr}/statuses`, fetchImpl);
  const checkRuns = currentAzureCheckRuns(statusesRaw, latestIterationId);

  // Current base head: the refs endpoint names the target branch's
  // head as of this read. If it cannot be read, fall back to the
  // target head the latest iteration was computed against
  // (targetRefCommit) and skip the compare — drift against the
  // current base is not established.
  const baseRef = stripRefPrefix(asString(prRaw.targetRefName));
  let baseSha = asString(targetRefCommit.commitId);
  let baseIsCurrent = false;
  try {
    const refs = await azureApiGetList(options, `/refs?filter=${encodeURIComponent(`heads/${baseRef}`)}`, fetchImpl);
    const head = refs.find((ref) => asString(ref.name) === `refs/heads/${baseRef}`) ?? refs[0];
    const objectId = head ? asString(head.objectId) : "";
    if (objectId) {
      baseSha = objectId;
      baseIsCurrent = true;
    }
  } catch {
    baseIsCurrent = false;
  }

  const mappedPr = mapAzurePullRequest(prRaw, owner, repo, webUrl, baseSha, headSha, updatedAt, commitsRaw.length, files);

  // Compare is the one section allowed to degrade: the builder labels
  // a null compare "unverified" instead of guessing base drift. The
  // diffs endpoint answers with the counts directly (aheadCount =
  // head commits the current base lacks, behindCount = base commits
  // the head lacks) plus the commonCommit it computed.
  let compare: AzureReceiptCompare | null = null;
  if (baseIsCurrent && baseSha) {
    try {
      const diffRaw = asRecord(
        await azureApiGet(
          options,
          `/diffs/commits?baseVersion=${encodeURIComponent(baseSha)}&baseVersionType=commit&targetVersion=${encodeURIComponent(headSha)}&targetVersionType=commit`,
          fetchImpl,
        ),
      );
      if (typeof diffRaw.aheadCount === "number" && typeof diffRaw.behindCount === "number") {
        compare = mapForgeCompare(diffRaw.aheadCount, diffRaw.behindCount);
      }
    } catch {
      compare = null;
    }
  }

  const prGate = await loadPrGateRoute(options.gateResultPath, readAt);

  return { pr: mappedPr, files, checkRuns, reviews, compare, prGate, readAt, source };
}

// --- CLI ---

export type AzureReceiptCliOptions = AzureReceiptOptions & { outPath?: string };

export function parseAzureReceiptArgs(argv: string[]): AzureReceiptCliOptions {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new AzureCollectError(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new AzureCollectError(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  const pr = Number(parsed.pr);
  if (!parsed["org-url"] || !parsed.project || !parsed.repository || !Number.isInteger(pr) || pr <= 0) {
    throw new AzureCollectError("Required: --org-url <organization URL> --project <project> --repository <repository> --pr <id>.");
  }
  return {
    orgUrl: parsed["org-url"],
    project: parsed.project,
    repository: parsed.repository,
    pr,
    token: parsed.token ?? process.env.AZURE_DEVOPS_PAT,
    bearerToken: parsed["bearer-token"] ?? process.env.AZURE_DEVOPS_BEARER_TOKEN,
    gateResultPath: parsed["gate-result"],
    outPath: parsed.out,
  };
}

const USAGE = `Usage: solvelang-azure-receipt --org-url <url> --project <project> --repository <repo> --pr <id> [options]

Reads one pull request from an Azure DevOps organization and writes a
Change Impact Receipt input JSON object (the shape consumed by
site/app/change-impact-receipt) to --out or stdout.

  --org-url <url>       Organization root, e.g.
                        https://dev.azure.com/myorg — for Azure DevOps
                        Server, the collection URL (required)
  --project <name|id>   Team project containing the repository
                        (required)
  --repository <name|id>
                        Repository containing the pull request
                        (required)
  --pr <id>             Pull request id (the number in the PR URL)
                        (required)
  --token <PAT>         Personal access token, sent as HTTP Basic.
                        Falls back to AZURE_DEVOPS_PAT. Never stored
                        or printed. Public projects read without one
                        where anonymous access is allowed.
  --bearer-token <token>
                        Entra / OAuth bearer token. Falls back to
                        AZURE_DEVOPS_BEARER_TOKEN. Takes precedence
                        over --token when both are supplied.
  --gate-result <path>  A PR Gate result.json (solvelang.pr-gate.result.v1)
                        to embed as the receipt's PR Gate route
  --out <path>          Write the input JSON to this file instead of stdout

Exit codes: 0 = input emitted, 2 = operational error.`;

export async function main(argv: string[]): Promise<number> {
  let options: AzureReceiptCliOptions;
  try {
    options = parseAzureReceiptArgs(argv);
  } catch (caught) {
    console.error(`azure-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    console.error(USAGE);
    return 2;
  }
  try {
    const input = await collectAzureReceiptInput(options);
    const json = `${JSON.stringify(input, null, 2)}\n`;
    if (options.outPath) {
      await writeFile(options.outPath, json, "utf8");
      console.log(`azure-receipt: receipt input for ${options.project}/${options.repository} PR ${options.pr} written to ${options.outPath}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (caught) {
    console.error(`azure-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
