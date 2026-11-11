import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  activityStatusLabel,
  deriveRunnerView,
  filterLiveCenterPullRequests,
  formatDurationMs,
  formatRelativeTime,
  gateStateLabel,
  groupPullRequestsByStage,
  normalizeLiveCenterBoard,
  normalizeLiveCenterMinutes,
  paginateList,
  parseOwnerActionWaitingOn,
  reviewStateLabel,
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
    inQueuePrs: 1,
    waitingOnOwner: 4,
    waitingOnYou: 3,
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
    stage: "checking",
    baseRef: "master",
    headRef: "",
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
    defaultBranch: "",
    stats: {
      openPrs: 0, drafts: 0, failingPrs: 0, checkingPrs: 0, readyPrs: 0,
      inQueuePrs: 0, waitingOnOwner: 0, waitingOnYou: 0,
    },
    queue: [],
    pullRequests: [],
    activity: [],
    runs: [],
    runners: { busy: [], runningUnassigned: 0, queuedJobs: [], busyCount: 0, waitingCount: 0 },
    ownerActions: [],
    ownerActionGroups: [],
    inboxGroups: [],
    history: { merged: [], removed: [], daily: [], period: { days: 0, entered: 0, merged: 0, removed: 0 } },
    pagination: { total: 0, page: 1, perPage: 25, pages: 1 },
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

// A miniature of the payload v2 the pilot now serves: server stages
// from the corrected Ready definition, per-check detail, review and
// gate state, history, and the pagination block.
const pilotBoardV2 = {
  repo: "saiidz/upcomingsounds-private",
  generatedAt: "2026-11-11T05:00:00.000Z",
  queue: [
    {
      number: 201, title: "Gate missing work", author: "saiidz", draft: false,
      mergeable: true, mergeableState: "clean", headSha: "abc1234567", headRef: "feat/gate",
      baseRef: "master", createdAt: "2026-11-11T01:00:00Z", updatedAt: "2026-11-11T04:00:00Z",
      labels: ["ci"], comments: 3, requestedReviewers: [],
      review: { state: "none", approvals: [], changesRequestedBy: [], requestedReviewers: [] },
      gate: { state: "missing", checks: ["Hosted CI - required gate"] },
      stage: "queue",
    },
    {
      number: 202, title: "Stack child work", author: "octocat", draft: false,
      mergeable: true, mergeableState: "clean", headSha: "def7654321", headRef: "feat/child",
      baseRef: "feat/gate", createdAt: "2026-11-11T02:00:00Z", updatedAt: "2026-11-11T04:30:00Z",
      labels: [], comments: 0, requestedReviewers: ["amy"],
      review: { state: "review_required", approvals: [], changesRequestedBy: [], requestedReviewers: ["amy"] },
      gate: { state: "passed", checks: ["Hosted CI - required gate"] },
      stage: "queue",
    },
    {
      number: 203, title: "Ready work", author: "octocat", draft: false,
      mergeable: true, mergeableState: "clean", headSha: "9998887776", headRef: "feat/ready",
      baseRef: "master", createdAt: "2026-11-11T03:00:00Z", updatedAt: "2026-11-11T04:45:00Z",
      labels: [], comments: 1, requestedReviewers: [],
      review: { state: "approved", approvals: ["amy"], changesRequestedBy: [], requestedReviewers: [] },
      gate: { state: "passed", checks: ["Hosted CI - required gate"] },
      stage: "ready",
    },
  ],
  checks: {
    "201": { total: 2, passed: 2, failed: 0, pending: 0, failing: [] },
    "202": { total: 2, passed: 2, failed: 0, pending: 0, failing: [] },
    "203": { total: 2, passed: 2, failed: 0, pending: 0, failing: [] },
  },
  checkDetails: {
    "201": {
      runs: [
        { name: "Hosted CI - required gate", kind: "check", status: "completed", conclusion: "success", required: true, durationMs: 240000, startedAt: "2026-11-11T03:00:00Z", completedAt: "2026-11-11T03:04:00Z" },
        { name: "docs", kind: "check", status: "completed", conclusion: "success", required: false, durationMs: 30000, startedAt: "2026-11-11T03:00:00Z", completedAt: "2026-11-11T03:00:30Z" },
      ],
    },
    "202": { runs: [] },
    "203": { runs: [] },
  },
  activity: [
    {
      runId: 7001, workflowName: "Hosted CI", status: "in_progress", conclusion: null,
      headSha: "abc1234567", headBranch: "feat/gate", event: "pull_request",
      createdAt: "2026-11-11T04:50:00Z", updatedAt: "2026-11-11T04:55:00Z",
      pullRequestNumbers: [201],
      jobs: [
        { id: 1, name: "shard 1", status: "in_progress", conclusion: null, runnerName: "UCS-WIN-3", labels: ["self-hosted"], startedAt: "2026-11-11T04:51:00Z", completedAt: null },
        { id: 2, name: "shard 2", status: "queued", conclusion: null, runnerName: null, labels: [], startedAt: null, completedAt: null },
      ],
    },
  ],
  ownerActions: [],
  batches: { repo: "saiidz/upcomingsounds-private", baseRef: "master", batchSize: 3, size: 0, prNumbers: [], stoppedReason: "blocked", blockedBy: 201 },
  history: {
    merged: [{ pr: 190, title: "Landed earlier", at: "2026-11-10T20:00:00Z", queueTimeMs: 5400000 }],
    removed: [{ pr: 188, title: "Abandoned spike", at: "2026-11-10T18:00:00Z", reason: "Pull request was closed without merging" }],
    daily: [
      { day: "2026-11-10", entered: 4, merged: 2, removed: 1, mergedRatePct: 50, queueTimeMedianMs: 5400000, openPrs: 100, failingPrs: 45, checksPassed: 900, checksFailed: 120, checksPending: 40, runtimeMedianMs: 210000 },
    ],
    period: { days: 14, entered: 30, merged: 12, removed: 3 },
  },
  pagination: { total: 3, page: 1, perPage: 25, pages: 1 },
};

test("normalizeLiveCenterBoard trusts the server stage over the local derivation", () => {
  const view = normalizeLiveCenterBoard(pilotBoardV2);
  // PR 201's checks all pass locally — the old derivation would call
  // it ready — but the server stage says queue (gate never reported).
  assert.deepEqual(view.pullRequests.map((pr) => pr.stage), ["queue", "queue", "ready"]);
  assert.equal(view.defaultBranch, "master");
  assert.equal(view.pullRequests[1].isStackChild, true);
  assert.equal(view.pullRequests[0].isStackChild, false);
  assert.equal(view.stats.readyPrs, 1);
  assert.equal(view.stats.inQueuePrs, 2);
  assert.deepEqual(view.pagination, { total: 3, page: 1, perPage: 25, pages: 1 });
});

test("normalizeLiveCenterBoard carries check detail, review, and gate state per PR", () => {
  const view = normalizeLiveCenterBoard(pilotBoardV2);
  const pr = view.pullRequests[0];
  assert.equal(pr.checkRuns.length, 2);
  assert.equal(pr.checkRuns[0].required, true);
  assert.equal(pr.checkRuns[0].durationMs, 240000);
  assert.equal(pr.gate.state, "missing");
  assert.deepEqual(pr.gate.checks, ["Hosted CI - required gate"]);
  assert.equal(view.pullRequests[2].review.state, "approved");
  assert.deepEqual(view.pullRequests[2].review.approvals, ["amy"]);
  assert.equal(view.pullRequests[1].review.state, "review_required");
  assert.equal(pr.headRef, "feat/gate");
  assert.deepEqual(pr.labels, ["ci"]);
  assert.equal(pr.comments, 3);
});

test("normalizeLiveCenterBoard builds runs, the runner view, and the history", () => {
  const view = normalizeLiveCenterBoard(pilotBoardV2);
  assert.equal(view.runs.length, 1);
  assert.equal(view.runs[0].headBranch, "feat/gate");
  assert.deepEqual(view.runs[0].pullRequestNumbers, [201]);
  assert.equal(view.runners.busyCount, 1);
  assert.equal(view.runners.busy[0].name, "UCS-WIN-3");
  assert.equal(view.runners.waitingCount, 1);
  assert.equal(view.history.merged[0].number, 190);
  assert.equal(view.history.merged[0].queueTimeMs, 5400000);
  assert.equal(view.history.removed[0].reason, "Pull request was closed without merging");
  assert.equal(view.history.daily[0].mergedRatePct, 50);
  assert.deepEqual(view.history.period, { days: 14, entered: 30, merged: 12, removed: 3 });
});

test("deriveRunnerView counts only what the run data proves", () => {
  const view = normalizeLiveCenterBoard(pilotBoardV2);
  const runners = deriveRunnerView(view.runs);
  assert.equal(runners.runningUnassigned, 0);
  assert.deepEqual(runners.queuedJobs.map((job) => job.name), ["shard 2"]);
});

test("inbox groups name the draft, review, and gate waits in plain words", () => {
  const view = normalizeLiveCenterBoard(pilotBoardV2);
  assert.deepEqual(view.inboxGroups.map((group) => group.key), ["review", "gate"]);
  const gate = view.inboxGroups.find((group) => group.key === "gate");
  assert.ok(gate);
  assert.match(gate.items[0].blocker, /Hosted CI - required gate/);
  assert.match(gate.description, /never counted as ready/);

  const withDeployment = normalizeLiveCenterBoard({
    ...pilotBoardV2,
    ownerActions: [
      { type: "deployment_approval", pr: null, runId: 4242, waitingOn: "Deployment to production is waiting for approval" },
    ],
  });
  const deployment = withDeployment.inboxGroups.find((group) => group.key === "deployment");
  assert.ok(deployment);
  assert.equal(deployment.items[0].runId, 4242);
  assert.match(deployment.items[0].blocker, /waiting for approval/);
});

test("state labels and formatters speak plainly", () => {
  assert.equal(reviewStateLabel("approved"), "Approved");
  assert.equal(reviewStateLabel("review_required"), "Review requested");
  assert.equal(gateStateLabel("missing"), "Required gate has not reported yet");
  assert.equal(gateStateLabel("unknown"), "Required gate not reported");
  const now = new Date("2026-11-11T05:00:00Z");
  assert.equal(formatRelativeTime("2026-11-11T04:59:30Z", now), "just now");
  assert.equal(formatRelativeTime("2026-11-11T02:00:00Z", now), "3h ago");
  assert.equal(formatRelativeTime("2026-11-09T05:00:00Z", now), "2d ago");
  assert.equal(formatRelativeTime("not-a-date", now), "");
  assert.equal(formatDurationMs(45000), "45s");
  assert.equal(formatDurationMs(200000), "3m 20s");
  assert.equal(formatDurationMs(5400000), "1h 30m");
  assert.equal(formatDurationMs(null), "—");
});

test("paginateList slices GitHub-style pages and clamps the page", () => {
  const items = Array.from({ length: 60 }, (_, i) => i + 1);
  const page2 = paginateList(items, 2);
  assert.equal(page2.items.length, 25);
  assert.equal(page2.items[0], 26);
  assert.deepEqual(
    { page: page2.page, pages: page2.pages, total: page2.total },
    { page: 2, pages: 3, total: 60 },
  );
  const clamped = paginateList(items, 99);
  assert.equal(clamped.page, 3);
  assert.equal(clamped.items.length, 10);
});

test("the minutes seam is honestly unconfigured until the runners service answers", () => {
  const empty = normalizeLiveCenterMinutes({ configured: false });
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.balances, []);
  assert.equal(empty.cache, null);
  assert.equal(empty.lanes, null);
  assert.equal(empty.buyPath, "/account/runner-minutes-checkout/");
  assert.equal(normalizeLiveCenterMinutes(null).configured, false);
  assert.equal(normalizeLiveCenterMinutes({}).configured, false);

  const live = normalizeLiveCenterMinutes({
    configured: true,
    balances: [
      { kind: "standard", label: "Standard minutes", minutesLeft: 812, packMinutes: 1000, rateText: "Draws at 1×", lowBalance: false, note: "" },
    ],
    cache: { gbStored: 4.2, monthCostText: "$0.10", note: "Cache is kept for 7 days." },
    lanes: { windowLabel: "Last 24 hours", spotMinutes: 300, onDemandMinutes: 40, creditsDrawn: 12 },
    byRepository: [{ repo: "saiidz/solvelang", minutes: 340, jobs: 51 }],
    recentJobs: [
      { name: "tests", repo: "saiidz/solvelang", machine: "Windows · 4 vCPU", lane: "spot", durationText: "6m 10s", creditsDrawn: 6 },
    ],
    recommendation: { text: "Your standard balance covers about 3 days at this pace.", actionLabel: "Buy a pack" },
  });
  assert.equal(live.configured, true);
  assert.equal(live.balances[0].minutesLeft, 812);
  assert.equal(live.cache?.gbStored, 4.2);
  assert.equal(live.lanes?.spotMinutes, 300);
  assert.equal(live.byRepository[0].jobs, 51);
  assert.equal(live.recentJobs[0].lane, "spot");
  assert.equal(live.recommendation?.actionLabel, "Buy a pack");
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
