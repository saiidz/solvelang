#!/usr/bin/env node
// SolveLang Change Impact Receipt collector for GitLab.
//
// Reads one merge request from a GitLab instance's REST API (v4 —
// gitlab.com or any self-hosted base URL) and emits a Change Impact
// Receipt INPUT object: the exact JSON shape the Change Impact Receipts
// page (site/app/change-impact-receipt) consumes and turns into a
// receipt with buildChangeImpactReceipt. It is the GitLab sibling of
// solvelang-forge-receipt (src/forge-receipt.ts); the field contract is
// the same ChangeImpactReceiptInput in
// site/app/change-impact-receipt/core/receipt.ts, and the QA pins in
// test/gitlab-receipt-qa.test.ts assert the two stay in lock-step.
//
// Every wire shape below was verified against GitLab's own API
// documentation (doc/api/*.md in gitlab-org/gitlab) and against live
// reads of public merge requests on gitlab.com on 2026-11-24 — field
// names and status codes are not assumed:
//   - the MR object's `changes_count` is a STRING ("3", capped at
//     "1000+"), so counts come from the /diffs list actually read,
//     never from that field;
//   - `detailed_merge_status` carries the mergeability vocabulary
//     (merge_status is deprecated since GitLab 15.6); a merged MR still
//     reports merge_status "can_be_merged" with detailed status
//     "not_open", so mergeability is only ever claimed for open MRs;
//   - a fork MR's head pipeline runs in the FORK project: the jobs are
//     read from head_pipeline.project_id, not the target project
//     (reading them from the target project 404s — observed live);
//   - the approvals read (GET .../merge_requests/:iid/approvals) is
//     available on all tiers; Community Edition returns a reduced
//     field set that still includes `approved_by`.
//
// Provenance discipline (the receipt builder's rules, applied at the
// collection step):
//   - The token is supplied by the operator at runtime (--token or the
//     GITLAB_TOKEN environment variable) and is never stored, logged,
//     or written to the output. Public projects read without one.
//   - A section that cannot be read (MR, diffs, commits, approvals,
//     head-pipeline jobs) is an operational error (exit 2): emitting a
//     partial input would let the builder print "verified" findings
//     the records do not support.
//   - The compare section is the one honest exception: when the
//     compare endpoint cannot answer (or reports compare_timeout),
//     compare is null and the builder labels base drift unverified
//     rather than guessing.
//   - The current base-branch head is read from the branches endpoint;
//     if that read fails (for example the target branch was deleted
//     after a merge), baseSha falls back to the MR's diff_refs.base_sha
//     — the base the diff was computed against — and compare is null,
//     because drift against the CURRENT base is then not established.
//   - Platform vocabulary is mapped, never invented: the mapping
//     functions below translate GitLab's detailed_merge_status values,
//     pipeline job statuses, and approval records into the receipt
//     builder's vocabulary, and the mappings are pinned by tests.
//   - Additions/deletions are counted from the diff text GitLab
//     returns (the API carries no per-file line counts): lines starting
//     "+" count as additions, "-" as deletions, excluding the +++/---
//     file headers. A file whose diff GitLab withholds (too_large or
//     collapsed) therefore contributes 0/0 — the CLI prints a warning
//     naming the count of such files to stderr; the numbers in the
//     receipt are the counts of the diffs actually read.
//
// Exit codes mirror the PR Gate CLI: 0 = input emitted, 2 = operational
// error (bad arguments, unreachable instance, unreadable gate result).

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

// The GitLab collector emits the same receipt input contract as the
// forge collector; the types are aliases so the two cannot drift.
export type GitLabReceiptPullRequest = ForgeReceiptPullRequest;
export type GitLabReceiptChangedFile = ForgeReceiptChangedFile;
export type GitLabReceiptCheckRun = ForgeReceiptCheckRun;
export type GitLabReceiptReview = ForgeReceiptReview;
export type GitLabReceiptCompare = ForgeReceiptCompare;
export type GitLabPrGateRoute = ForgePrGateRoute;
export type GitLabReceiptInput = ForgeReceiptInput;

export type GitLabReceiptOptions = {
  baseUrl: string;
  project: string;
  mr: number;
  token?: string;
  gateResultPath?: string;
};

export class GitLabCollectError extends Error {}

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

const defaultFetch: FetchLike = (url, init) => (globalThis as { fetch: FetchLike }).fetch(url, init);

function apiRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v4`;
}

async function gitlabApiGet(baseUrl: string, route: string, token: string | undefined, fetchImpl: FetchLike): Promise<unknown> {
  const url = `${apiRoot(baseUrl)}${route}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers["PRIVATE-TOKEN"] = token;
  let response: FetchResponse;
  try {
    response = await fetchImpl(url, { headers });
  } catch (caught) {
    throw new GitLabCollectError(`GitLab API request failed for ${route}: ${caught instanceof Error ? caught.message : String(caught)}`);
  }
  if (!response.ok) {
    throw new GitLabCollectError(`GitLab API request failed for ${route}: HTTP ${response.status}.`);
  }
  return response.json();
}

async function gitlabApiGetAll(baseUrl: string, route: string, token: string | undefined, fetchImpl: FetchLike): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const separator = route.includes("?") ? "&" : "?";
    const batch = (await gitlabApiGet(baseUrl, `${route}${separator}per_page=${perPage}&page=${page}`, token, fetchImpl)) as Record<string, unknown>[];
    if (!Array.isArray(batch)) {
      throw new GitLabCollectError(`GitLab API request for ${route} did not return a list.`);
    }
    items.push(...batch);
    if (batch.length < perPage) return items;
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

// GitLab's detailed_merge_status vocabulary (GitLab API docs, "Merge
// status" in doc/api/merge_requests.md). The receipt builder prints the
// state string next to its own mergeable verdict, so the mapping must
// not claim more than GitLab said:
//   - a conflict (has_conflicts, or detailed "conflict") is "dirty";
//   - "mergeable" means GitLab established the branches merge — the
//     receipt word is "unstable" (mergeable per the API, with CI and
//     review state reported separately), mirroring the forge mapping;
//   - the still-checking values mean GitLab itself has not established
//     mergeability yet: mergeable null, state "unknown";
//   - the named-gate values mean GitLab established the branches can
//     merge but a gate blocks the merge (CI must pass, approvals
//     missing, discussions open, rebase required, ...): mergeable
//     true, and the state string is GitLab's own word for the gate;
//   - anything unrecognized is "unknown", never a guess.
// Mergeability is only claimed for OPEN merge requests at all: a
// merged MR still reports merge_status "can_be_merged" (observed live
// on gitlab.com), so for closed/merged/locked MRs the honest record is
// null / "unknown" — no merge was attempted for this read-only receipt.
const DETAILED_STILL_CHECKING = ["checking", "unchecked", "preparing", "approvals_syncing", "commits_status"];
const DETAILED_NAMED_GATE = [
  "ci_must_pass",
  "ci_still_running",
  "discussions_not_resolved",
  "draft_status",
  "jira_association_missing",
  "locked_lfs_files",
  "locked_paths",
  "merge_request_blocked",
  "merge_time",
  "need_rebase",
  "not_approved",
  "requested_changes",
  "security_policy_pipeline_check",
  "security_policy_violations",
  "status_checks_must_pass",
  "title_regex",
];

export function mergeableForGitLab(raw: Record<string, unknown>): { mergeable: boolean | null; mergeableState: string } {
  if (asString(raw.state) !== "opened") return { mergeable: null, mergeableState: "unknown" };
  const detailed = asString(raw.detailed_merge_status);
  if (raw.has_conflicts === true || detailed === "conflict") return { mergeable: false, mergeableState: "dirty" };
  if (detailed === "mergeable") return { mergeable: true, mergeableState: "unstable" };
  if (DETAILED_STILL_CHECKING.includes(detailed)) return { mergeable: null, mergeableState: "unknown" };
  if (DETAILED_NAMED_GATE.includes(detailed)) return { mergeable: true, mergeableState: detailed };
  if (detailed === "" || detailed === "not_open") {
    // Fall back to the deprecated merge_status field.
    const legacy = asString(raw.merge_status);
    if (legacy === "can_be_merged") return { mergeable: true, mergeableState: "unstable" };
    if (legacy === "cannot_be_merged" || legacy === "cannot_be_merged_recheck") return { mergeable: false, mergeableState: "dirty" };
  }
  return { mergeable: null, mergeableState: "unknown" };
}

export function mapGitLabPullRequest(
  raw: Record<string, unknown>,
  owner: string,
  repo: string,
  baseSha: string,
  commits: number,
  files: GitLabReceiptChangedFile[],
): GitLabReceiptPullRequest {
  const author = asRecord(raw.author);
  const diffRefs = asRecord(raw.diff_refs);
  const { mergeable, mergeableState } = mergeableForGitLab(raw);
  const state = asString(raw.state);
  return {
    owner,
    repo,
    number: asNumber(raw.iid),
    title: asString(raw.title),
    url: asString(raw.web_url),
    state: state === "opened" ? "open" : state,
    draft: raw.draft === true || raw.work_in_progress === true,
    author: asString(author.username, "unknown"),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
    headSha: asString(raw.sha, asString(diffRefs.head_sha)),
    headRef: asString(raw.source_branch),
    baseRef: asString(raw.target_branch),
    baseSha,
    mergeable,
    mergeableState,
    changedFiles: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    commits,
  };
}

// The GitLab API carries no per-file line counts, so additions and
// deletions are counted from the diff text it returns: "+" lines are
// additions, "-" lines are deletions, and the +++/--- file headers are
// not content. A withheld diff (too_large / collapsed) is empty text
// and counts 0/0 — see the header comment for the disclosure rule.
export function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export function mapGitLabChangedFile(raw: Record<string, unknown>): GitLabReceiptChangedFile {
  const counts = countDiffLines(asString(raw.diff));
  const status = raw.new_file === true ? "added" : raw.deleted_file === true ? "deleted" : raw.renamed_file === true ? "renamed" : "modified";
  return {
    filename: asString(raw.new_path, asString(raw.old_path)),
    status,
    additions: counts.additions,
    deletions: counts.deletions,
  };
}

// GitLab pipeline job statuses (GitLab API docs, doc/api/jobs.md):
// created, waiting_for_resource, preparing, pending, running,
// waiting_for_callback, success, failed, canceled, skipped, manual,
// scheduled. The receipt vocabulary is check runs: a job that produced
// a result is "completed" with that conclusion; a job still waiting or
// running carries no conclusion. "manual" jobs have not run — a human
// must start them — so they are recorded as queued with no conclusion,
// never as a result. An unrecognized status falls back the way the
// forge mapping does: completed, with the raw status as the conclusion.
export function mapGitLabJob(raw: Record<string, unknown>): GitLabReceiptCheckRun {
  const name = asString(raw.name, "job");
  const status = asString(raw.status);
  if (status === "success") return { name, status: "completed", conclusion: "success" };
  if (status === "failed") return { name, status: "completed", conclusion: "failure" };
  if (status === "canceled") return { name, status: "completed", conclusion: "cancelled" };
  if (status === "skipped") return { name, status: "completed", conclusion: "skipped" };
  if (status === "running" || status === "canceling" || status === "waiting_for_callback") return { name, status: "in_progress", conclusion: null };
  if (status === "created" || status === "waiting_for_resource" || status === "preparing" || status === "pending" || status === "scheduled" || status === "manual") {
    return { name, status: "queued", conclusion: null };
  }
  return { name, status: "completed", conclusion: status === "" ? null : status };
}

// GitLab's submitted-review record is the approval list: the approvals
// endpoint's approved_by entries are the users who approved, in order.
// GitLab has no per-reviewer "changes requested" review object in this
// API (a requested-changes state exists only as the MR-level
// detailed_merge_status), so nothing else is mapped into reviews —
// inventing a reviewer record would fabricate evidence.
export function mapGitLabReviews(approvalsRaw: Record<string, unknown>): GitLabReceiptReview[] {
  const approvedBy = Array.isArray(approvalsRaw.approved_by) ? approvalsRaw.approved_by : [];
  return approvedBy.map((entry) => {
    const user = asRecord(asRecord(entry).user);
    return { author: asString(user.username, "unknown"), state: "APPROVED" };
  });
}

// --- PR Gate route embedding ---

async function loadPrGateRoute(gateResultPath: string | undefined, readAt: string): Promise<GitLabPrGateRoute> {
  if (!gateResultPath) {
    return {
      status: "not-run",
      reason: "No PR Gate result was supplied to the collector. Run the PR Gate on GitLab (workflow-template.gitlab-ci.yml) and pass --gate-result <result.json> to embed it.",
      provenance: `solvelang-gitlab-receipt collector invocation, ${readAt}.`,
    };
  }
  const provenance = `SolveLang PR Gate CLI (packages/pr-gate, report-only mode) result at ${gateResultPath}, read by solvelang-gitlab-receipt ${readAt}.`;
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

export async function collectGitLabReceiptInput(options: GitLabReceiptOptions, fetchImpl: FetchLike = defaultFetch): Promise<GitLabReceiptInput> {
  const { baseUrl, project, mr } = options;
  const projectRoute = `/projects/${encodeURIComponent(project)}`;
  const readAt = new Date().toISOString();
  const source = `GitLab REST API (v4) at ${baseUrl.replace(/\/+$/, "")} via solvelang-gitlab-receipt (packages/pr-gate)`;

  // Owner/repo for the receipt identity: derived from the project's
  // full path (the last segment is the repo; everything before it,
  // including nested groups, is the owner). A numeric project id needs
  // one project read to learn the path.
  let projectPath = project;
  if (/^\d+$/.test(project)) {
    const projectRaw = asRecord(await gitlabApiGet(baseUrl, projectRoute, options.token, fetchImpl));
    projectPath = asString(projectRaw.path_with_namespace);
    if (!projectPath) {
      throw new GitLabCollectError(`GitLab API project response for id ${project} carried no path_with_namespace.`);
    }
  }
  const segments = projectPath.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new GitLabCollectError(`--project must be a namespaced project path (group/repo) or a numeric project id, got "${project}".`);
  }
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join("/");

  const mrRaw = asRecord(await gitlabApiGet(baseUrl, `${projectRoute}/merge_requests/${mr}`, options.token, fetchImpl));
  const diffsRaw = await gitlabApiGetAll(baseUrl, `${projectRoute}/merge_requests/${mr}/diffs`, options.token, fetchImpl);
  const files = diffsRaw.map(mapGitLabChangedFile);
  const commitsRaw = await gitlabApiGetAll(baseUrl, `${projectRoute}/merge_requests/${mr}/commits`, options.token, fetchImpl);
  const approvalsRaw = asRecord(await gitlabApiGet(baseUrl, `${projectRoute}/merge_requests/${mr}/approvals`, options.token, fetchImpl));
  const reviews = mapGitLabReviews(approvalsRaw);

  // Current base head: the branches endpoint names the target branch's
  // head as of this read. If it cannot be read, fall back to the base
  // the MR's diff was computed against (diff_refs.base_sha) and skip
  // the compare — drift against the current base is not established.
  const diffRefs = asRecord(mrRaw.diff_refs);
  let baseSha = asString(diffRefs.base_sha);
  let baseIsCurrent = false;
  try {
    const branchRaw = asRecord(
      await gitlabApiGet(baseUrl, `${projectRoute}/repository/branches/${encodeURIComponent(asString(mrRaw.target_branch))}`, options.token, fetchImpl),
    );
    const branchHead = asString(asRecord(branchRaw.commit).id);
    if (branchHead) {
      baseSha = branchHead;
      baseIsCurrent = true;
    }
  } catch {
    baseIsCurrent = false;
  }

  const mappedPr = mapGitLabPullRequest(mrRaw, owner, repo, baseSha, commitsRaw.length, files);
  if (!mappedPr.headSha) {
    throw new GitLabCollectError(`GitLab API MR response for ${project}!${mr} carried no head SHA.`);
  }

  // CI evidence: the jobs of the head pipeline. A fork MR's pipeline
  // runs in the fork project (head_pipeline.project_id), so the jobs
  // are read from that project — reading them from the target project
  // 404s. Bridge (downstream pipeline) jobs are not part of the head
  // pipeline's job list and are not claimed. No head pipeline means no
  // CI evidence exists for the head, which the builder reports as read.
  let checkRuns: GitLabReceiptCheckRun[] = [];
  const headPipeline = asRecord(mrRaw.head_pipeline ?? mrRaw.pipeline);
  if (typeof headPipeline.id === "number") {
    const pipelineProject = typeof headPipeline.project_id === "number" ? String(headPipeline.project_id) : project;
    const jobsRaw = await gitlabApiGetAll(
      baseUrl,
      `/projects/${encodeURIComponent(pipelineProject)}/pipelines/${headPipeline.id}/jobs`,
      options.token,
      fetchImpl,
    );
    checkRuns = jobsRaw.map(mapGitLabJob);
  }

  // Compare is the one section allowed to degrade: the builder labels
  // a null compare "unverified" instead of guessing base drift. The
  // comparison runs on SHAs (current base head vs the MR head), which
  // is what makes it work for fork MRs too.
  let compare: GitLabReceiptCompare | null = null;
  if (baseIsCurrent && baseSha) {
    try {
      const aheadRaw = asRecord(
        await gitlabApiGet(baseUrl, `${projectRoute}/repository/compare?from=${encodeURIComponent(baseSha)}&to=${encodeURIComponent(mappedPr.headSha)}`, options.token, fetchImpl),
      );
      const behindRaw = asRecord(
        await gitlabApiGet(baseUrl, `${projectRoute}/repository/compare?from=${encodeURIComponent(mappedPr.headSha)}&to=${encodeURIComponent(baseSha)}`, options.token, fetchImpl),
      );
      if (aheadRaw.compare_timeout === true || behindRaw.compare_timeout === true) {
        compare = null;
      } else {
        const aheadBy = Array.isArray(aheadRaw.commits) ? aheadRaw.commits.length : 0;
        const behindBy = Array.isArray(behindRaw.commits) ? behindRaw.commits.length : 0;
        compare = mapForgeCompare(aheadBy, behindBy);
      }
    } catch {
      compare = null;
    }
  }

  const prGate = await loadPrGateRoute(options.gateResultPath, readAt);

  return { pr: mappedPr, files, checkRuns, reviews, compare, prGate, readAt, source };
}

// --- CLI ---

export type GitLabReceiptCliOptions = GitLabReceiptOptions & { outPath?: string };

export function parseGitLabReceiptArgs(argv: string[]): GitLabReceiptCliOptions {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new GitLabCollectError(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new GitLabCollectError(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  const mr = Number(parsed.mr);
  if (!parsed.project || !Number.isInteger(mr) || mr <= 0) {
    throw new GitLabCollectError("Required: --project <group/repo or numeric id> --mr <iid>.");
  }
  return {
    baseUrl: parsed["base-url"] ?? "https://gitlab.com",
    project: parsed.project,
    mr,
    token: parsed.token ?? process.env.GITLAB_TOKEN,
    gateResultPath: parsed["gate-result"],
    outPath: parsed.out,
  };
}

const USAGE = `Usage: solvelang-gitlab-receipt --project <group/repo> --mr <iid> [options]

Reads one merge request from a GitLab instance and writes a Change
Impact Receipt input JSON object (the shape consumed by
site/app/change-impact-receipt) to --out or stdout.

  --project <path|id>   Project path with namespace (group/repo,
                        nested groups allowed) or numeric project id
                        (required)
  --mr <iid>            Merge request IID (the number in the MR URL)
                        (required)
  --base-url <url>      Instance root, default https://gitlab.com —
                        set it for self-hosted GitLab
  --token <token>       API token (PRIVATE-TOKEN header). Falls back to
                        GITLAB_TOKEN. Never stored or printed. Public
                        projects read without one.
  --gate-result <path>  A PR Gate result.json (solvelang.pr-gate.result.v1)
                        to embed as the receipt's PR Gate route
  --out <path>          Write the input JSON to this file instead of stdout

Exit codes: 0 = input emitted, 2 = operational error.`;

export async function main(argv: string[]): Promise<number> {
  let options: GitLabReceiptCliOptions;
  try {
    options = parseGitLabReceiptArgs(argv);
  } catch (caught) {
    console.error(`gitlab-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    console.error(USAGE);
    return 2;
  }
  try {
    const input = await collectGitLabReceiptInput(options);
    const json = `${JSON.stringify(input, null, 2)}\n`;
    if (options.outPath) {
      await writeFile(options.outPath, json, "utf8");
      console.log(`gitlab-receipt: receipt input for ${options.project}!${options.mr} written to ${options.outPath}`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  } catch (caught) {
    console.error(`gitlab-receipt: ${caught instanceof Error ? caught.message : String(caught)}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
