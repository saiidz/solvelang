import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  activityStatusLabel,
  filterLiveCenterPullRequests,
  groupPullRequestsByStage,
  normalizeLiveCenterBoard,
  parseOwnerActionWaitingOn,
  stageForPullRequest,
  summarizeChecks,
} from "./live-center";

test("summarizeChecks counts array checks by verdict and names the failing ones", () => {
  const summary = summarizeChecks([
    { name: "Rust runtime", status: "completed", conclusion: "success" },
    { name: "Static site", status: "completed", conclusion: "failure" },
    { name: "WASM artifact security", status: "in_progress", conclusion: null },
    { name: "SolveLang Rust security and tests", status: "queued", conclusion: null },
  ]);
  assert.deepEqual(summary, {
    passed: 1,
    failed: 1,
    pending: 2,
    failing: ["Static site"],
  });
});

test("summarizeChecks reads a pre-counted summary object", () => {
  assert.deepEqual(
    summarizeChecks({ passed: 3, failed: 1, pending: 2, failing: ["Static site"] }),
    { passed: 3, failed: 1, pending: 2, failing: ["Static site"] },
  );
  assert.deepEqual(summarizeChecks(undefined), { passed: 0, failed: 0, pending: 0, failing: [] });
  assert.deepEqual(summarizeChecks(null), { passed: 0, failed: 0, pending: 0, failing: [] });
});

test("stageForPullRequest derives the pipeline stage from checks and the draft flag", () => {
  assert.equal(stageForPullRequest({ draft: false, total: 25, passed: 13, failed: 3, pending: 9 }), "failing");
  assert.equal(stageForPullRequest({ draft: true, total: 25, passed: 13, failed: 3, pending: 9 }), "failing");
  assert.equal(stageForPullRequest({ draft: false, total: 10, passed: 6, failed: 0, pending: 4 }), "checking");
  assert.equal(stageForPullRequest({ draft: false, total: 8, passed: 8, failed: 0, pending: 0 }), "ready");
  // A draft with every check green is still waiting on its author.
  assert.equal(stageForPullRequest({ draft: true, total: 8, passed: 8, failed: 0, pending: 0 }), "queue");
  assert.equal(stageForPullRequest({ draft: false, total: 0, passed: 0, failed: 0, pending: 0 }), "queue");
});

test("activityStatusLabel names running, queued, and finished jobs honestly", () => {
  assert.equal(activityStatusLabel("in_progress", null), "Running");
  assert.equal(activityStatusLabel("queued", null), "Queued");
  assert.equal(activityStatusLabel("completed", "success"), "Passed");
  assert.equal(activityStatusLabel("completed", "failure"), "Failed");
  assert.equal(activityStatusLabel("completed", "cancelled"), "Cancelled");
  assert.equal(activityStatusLabel("completed", null), "Completed");
});

test("parseOwnerActionWaitingOn splits the pilot's comma-joined failing checks back into names", () => {
  assert.deepEqual(
    parseOwnerActionWaitingOn("Failing checks: Hosted CI - required gate, Laravel suite - shard 5 of 6"),
    { label: "Failing checks", failing: ["Hosted CI - required gate", "Laravel suite - shard 5 of 6"] },
  );
  assert.deepEqual(
    parseOwnerActionWaitingOn("Draft pull request — waiting on the author to mark it ready for review"),
    { label: "Draft pull request — waiting on the author to mark it ready for review", failing: [] },
  );
});

// A miniature of the real pilot payload (same keys, same shapes) as
// served by GET /customer/live-center/board.
const pilotBoard = {
  repo: "saiidz/upcomingsounds-private",
  generatedAt: "2026-11-10T03:45:14.266Z",
  queue: [
    { number: 101, title: "Drafty work", author: "saiidz", draft: true, mergeableState: "blocked", baseRef: "master" },
    { number: 102, title: "Failing work", author: "saiidz", draft: false, mergeableState: "blocked", baseRef: "master" },
    { number: 103, title: "Checking work", author: "octocat", draft: false, mergeableState: "unstable", baseRef: "master" },
    { number: 104, title: "Ready work", author: "octocat", draft: false, mergeableState: "clean", baseRef: "master" },
    { number: 105, title: "Passed but draft", author: "saiidz", draft: true, mergeableState: "blocked", baseRef: "master" },
  ],
  checks: {
    "101": { total: 4, passed: 1, failed: 0, pending: 3, failing: [] },
    "102": {
      total: 25,
      passed: 13,
      failed: 3,
      pending: 9,
      failing: ["Hosted CI - required gate", "Laravel suite - shard 5 of 6", "Fixture-only browser matrix"],
    },
    "103": { total: 10, passed: 6, failed: 0, pending: 4, failing: [] },
    "104": { total: 8, passed: 8, failed: 0, pending: 0, failing: [] },
    "105": { total: 8, passed: 8, failed: 0, pending: 0, failing: [] },
  },
  activity: [
    {
      runId: 9001,
      workflowName: "Hosted CI Required Checks",
      status: "in_progress",
      conclusion: null,
      jobs: [
        { name: "Validation selection", status: "queued", conclusion: null, runnerName: "" },
        { name: "Repository policy", status: "completed", conclusion: "success", runnerName: "UCS-ORACLE-CI-3" },
      ],
    },
    { runId: 9002, workflowName: "Deploy", status: "completed", conclusion: "failure", jobs: [] },
  ],
  ownerActions: [
    { type: "blocked", pr: 101, waitingOn: "Draft pull request — waiting on the author to mark it ready for review" },
    { type: "blocked", pr: 105, waitingOn: "Draft pull request — waiting on the author to mark it ready for review" },
    {
      type: "blocked",
      pr: 102,
      waitingOn: "Failing checks: Hosted CI - required gate, Laravel suite - shard 5 of 6, Fixture-only browser matrix",
    },
    { type: "blocked", pr: 102, waitingOn: "Merge conflicts with the base branch — waiting on the author to resolve them" },
  ],
  batches: {
    repo: "saiidz/upcomingsounds-private",
    baseRef: "master",
    batchSize: 3,
    size: 0,
    prNumbers: [],
    stoppedReason: "unknown",
    blockedBy: 101,
  },
};

test("normalizeLiveCenterBoard joins the pilot payload into PRs with stages and stats", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  assert.equal(view.repoLabel, "saiidz/upcomingsounds-private");
  assert.equal(view.generatedAt, "2026-11-10T03:45:14.266Z");
  assert.deepEqual(view.stats, {
    openPrs: 5,
    drafts: 2,
    failingPrs: 1,
    checkingPrs: 2,
    readyPrs: 1,
    waitingOnOwner: 4,
  });
  assert.deepEqual(
    view.pullRequests.map((pr) => [pr.number, pr.stage, pr.needsOwner]),
    [
      [101, "checking", true],
      [102, "failing", true],
      [103, "checking", false],
      [104, "ready", false],
      [105, "queue", true],
    ],
  );
  const failing = view.pullRequests[1];
  assert.equal(failing.total, 25);
  assert.equal(failing.passed, 13);
  assert.equal(failing.failed, 3);
  assert.equal(failing.pending, 9);
  assert.deepEqual(failing.failing, [
    "Hosted CI - required gate",
    "Laravel suite - shard 5 of 6",
    "Fixture-only browser matrix",
  ]);
  assert.deepEqual(view.queue[0], {
    number: 101,
    title: "Drafty work",
    position: 1,
    state: "blocked",
    author: "saiidz",
    draft: true,
  });
});

test("normalizeLiveCenterBoard groups owner actions and names the PR on every row", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  assert.deepEqual(
    view.ownerActions.map((action) => action.label),
    ["#101 Drafty work", "#105 Passed but draft", "#102 Failing work", "#102 Failing work"],
  );
  assert.deepEqual(
    view.ownerActionGroups.map((group) => [group.label, group.items.map((item) => item.number)]),
    [
      ["Draft pull request — waiting on the author to mark it ready for review", [101, 105]],
      ["Failing checks", [102]],
      ["Merge conflicts with the base branch — waiting on the author to resolve them", [102]],
    ],
  );
  assert.deepEqual(view.ownerActionGroups[1].items[0].failing, [
    "Hosted CI - required gate",
    "Laravel suite - shard 5 of 6",
    "Fixture-only browser matrix",
  ]);
  assert.equal(view.ownerActionGroups[1].items[0].title, "Failing work");
});

test("normalizeLiveCenterBoard flattens activity runs into job rows with runner names", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  assert.deepEqual(view.activity, [
    {
      runId: 9001,
      workflowName: "Hosted CI Required Checks",
      name: "Validation selection",
      runnerName: "",
      status: "Queued",
    },
    {
      runId: 9001,
      workflowName: "Hosted CI Required Checks",
      name: "Repository policy",
      runnerName: "UCS-ORACLE-CI-3",
      status: "Passed",
    },
    { runId: 9002, workflowName: "Deploy", name: "Deploy", runnerName: "", status: "Failed" },
  ]);});

test("normalizeLiveCenterBoard reads a blocked batch planner state", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  assert.deepEqual(view.batch, {
    proposed: false,
    size: 0,
    batchSize: 3,
    baseRef: "master",
    members: [],
    blockedBy: { number: 101, title: "Drafty work" },
    stoppedReason: "unknown",
  });
});

test("normalizeLiveCenterBoard reads a proposed batch with member titles", () => {
  const view = normalizeLiveCenterBoard({
    ...pilotBoard,
    batches: { baseRef: "master", batchSize: 3, size: 2, prNumbers: [103, 104], blockedBy: null, stoppedReason: "" },
  });
  assert.equal(view.batch.proposed, true);
  assert.equal(view.batch.size, 2);
  assert.deepEqual(view.batch.members, [
    { number: 103, title: "Checking work" },
    { number: 104, title: "Ready work" },
  ]);
  assert.equal(view.batch.blockedBy, null);
});

test("groupPullRequestsByStage buckets PRs in pipeline order", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  assert.deepEqual(
    groupPullRequestsByStage(view.pullRequests).map((group) => [group.label, group.pullRequests.map((pr) => pr.number)]),
    [
      ["In queue", [105]],
      ["Checking", [101, 103]],
      ["Failing", [102]],
      ["Ready", [104]],
    ],
  );
});

test("filterLiveCenterPullRequests applies quick filters and search together", () => {
  const view = normalizeLiveCenterBoard(pilotBoard);
  const numbers = (list: typeof view.pullRequests) => list.map((pr) => pr.number);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "", "all")), [101, 102, 103, 104, 105]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "", "failing")), [102]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "", "drafts")), [101, 105]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "", "waiting")), [101, 102, 105]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "ready", "all")), [104]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "#102", "all")), [102]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "octocat", "all")), [103, 104]);
  assert.deepEqual(numbers(filterLiveCenterPullRequests(view.pullRequests, "work", "drafts")), [101]);
});

test("normalizeLiveCenterBoard degrades a missing or empty board to empty sections", () => {
  const empty = {
    repoLabel: "",
    generatedAt: "",
    stats: { openPrs: 0, drafts: 0, failingPrs: 0, checkingPrs: 0, readyPrs: 0, waitingOnOwner: 0 },
    queue: [],
    pullRequests: [],
    activity: [],
    ownerActions: [],
    ownerActionGroups: [],
    batch: { proposed: false, size: 0, batchSize: 0, baseRef: "", members: [], blockedBy: null, stoppedReason: "" },
  };
  assert.deepEqual(normalizeLiveCenterBoard(null), empty);
  assert.deepEqual(normalizeLiveCenterBoard({}), empty);
  assert.deepEqual(normalizeLiveCenterBoard("nope"), empty);
});

test("the Live Center is linked from the account menu and the account dashboard", () => {
  const menu = readFileSync("app/components/SiteAccountMenu.tsx", "utf8");
  const menuLink = menu.indexOf('href="/account/live-center/"');
  const manageAccount = menu.indexOf("Manage account");
  assert.ok(menuLink >= 0 && manageAccount >= 0 && menuLink > manageAccount, "the account menu links Live Center after Manage account");
  assert.ok(menu.includes(">Live Center<"), "the menu label is plain Live Center");
  const dashboard = readFileSync("app/(english)/account/api-keys/page.tsx", "utf8");
  assert.ok(dashboard.includes('href="/account/live-center/"'), "the account dashboard links to the Live Center");
});

test("the board page proves the session before fetching the board and handles the not-configured state", () => {
  const board = readFileSync("app/account/live-center/LiveCenterBoard.tsx", "utf8");
  const accountCheck = board.indexOf('"/customer/account"');
  const boardFetch = board.indexOf('"/customer/live-center/board"');
  assert.ok(accountCheck >= 0 && boardFetch > accountCheck, "check the signed-in account before fetching the board");
  assert.ok(board.includes("mgov_not_configured"), "the 503 not-configured code is handled");
  assert.ok(board.includes("not switched on yet"), "the not-configured state is friendly");
  for (const heading of ["Merge queue", "Pull requests", "Runners at work", "Needed from you"]) {
    assert.ok(board.includes(heading), `section rendered: ${heading}`);
  }
});
