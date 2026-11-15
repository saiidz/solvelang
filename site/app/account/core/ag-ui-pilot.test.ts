import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_CENTER_STAGE_LABELS } from "./live-center";
import {
  AG_UI_PILOT_QUEUE_LIMIT,
  agUiPilotViewFromSnapshot,
  classifyAgUiFailure,
} from "./ag-ui-pilot";

// A miniature of the real pilot payload (same keys, same shapes) as
// served by GET /customer/live-center/board and carried, unchanged,
// by the AG-UI stream's STATE_SNAPSHOT event. The stats expectations
// below are the board normalizer's own proven outputs for this
// fixture family (see live-center.test.ts) — the pilot must render
// the server's board, not a reinterpretation of it.
const SNAPSHOT = {
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
    "102": { total: 25, passed: 13, failed: 3, pending: 9, failing: ["Hosted CI - required gate"] },
    "103": { total: 10, passed: 6, failed: 0, pending: 4, failing: [] },
    "104": { total: 8, passed: 8, failed: 0, pending: 0, failing: [] },
    "105": { total: 8, passed: 8, failed: 0, pending: 0, failing: [] },
  },
  ownerActions: [
    { type: "blocked", pr: 101, waitingOn: "Draft pull request — waiting on the author to mark it ready for review" },
    { type: "blocked", pr: 105, waitingOn: "Draft pull request — waiting on the author to mark it ready for review" },
    { type: "blocked", pr: 102, waitingOn: "Failing checks: Hosted CI - required gate" },
    { type: "blocked", pr: 102, waitingOn: "Merge conflicts with the base branch — waiting on the author to resolve them" },
  ],
  fleet: {
    available: true,
    total: 3,
    online: 2,
    busy: 1,
    runners: [
      { name: "SOLVELANG-ORACLE-CI-1", status: "online", busy: true },
      { name: "SOLVELANG-MAC-CI-1", status: "online", busy: false },
      { name: "SOLVELANG-WIN-CI-1", status: "offline", busy: false },
    ],
  },
};

test("the pilot view derives counts, queue and runners from the snapshot via the board normalizer", () => {
  const view = agUiPilotViewFromSnapshot(SNAPSHOT);
  assert.equal(view.repoLabel, "saiidz/upcomingsounds-private");
  assert.equal(view.generatedAt, "2026-11-10T03:45:14.266Z");
  assert.equal(view.counts.openPrs, 5);
  assert.equal(view.counts.inQueue, 1);
  assert.equal(view.counts.checking, 2);
  assert.equal(view.counts.failing, 1);
  assert.equal(view.counts.ready, 1);
  assert.equal(view.counts.waitingOnOwner, 4);
  assert.equal(view.counts.runnersOnline, 2);
  assert.equal(view.counts.runnersTotal, 3);
  assert.equal(view.counts.runnersBusy, 1);
  assert.equal(view.queueTotal, 5);
  assert.deepEqual(
    view.queue.map((entry) => entry.number),
    [101, 102, 103, 104, 105],
  );
  assert.equal(view.queue[0].title, "Drafty work");
  assert.equal(view.queue[0].position, 1);
  assert.equal(view.queue[0].stageLabel, LIVE_CENTER_STAGE_LABELS.checking);
  assert.deepEqual(
    view.runners.map((runner) => runner.name),
    ["SOLVELANG-ORACLE-CI-1", "SOLVELANG-MAC-CI-1", "SOLVELANG-WIN-CI-1"],
  );
  assert.equal(view.runners[2].status, "offline");
  assert.equal(view.runners[0].busy, true);
});

test("the pilot view caps the listed queue at the page limit and keeps the true total", () => {
  const bigQueue = Array.from({ length: AG_UI_PILOT_QUEUE_LIMIT + 5 }, (_, index) => ({
    number: 200 + index,
    title: `Queued work ${index}`,
    author: "saiidz",
    draft: false,
    mergeableState: "blocked",
    baseRef: "master",
  }));
  const view = agUiPilotViewFromSnapshot({ ...SNAPSHOT, queue: bigQueue, checks: {}, ownerActions: [] });
  assert.equal(view.queue.length, AG_UI_PILOT_QUEUE_LIMIT);
  assert.equal(view.queueTotal, AG_UI_PILOT_QUEUE_LIMIT + 5);
});

test("an empty or malformed snapshot degrades to an empty view, never a throw", () => {
  const view = agUiPilotViewFromSnapshot(null);
  assert.equal(view.counts.openPrs, 0);
  assert.equal(view.queueTotal, 0);
  assert.deepEqual(view.runners, []);
  const view2 = agUiPilotViewFromSnapshot({ queue: "nope" });
  assert.equal(view2.queueTotal, 0);
});

test("failure classification: 401 is the session gate, the two 503 codes are the disabled state", () => {
  assert.equal(classifyAgUiFailure(401, "invalid_session"), "unauthenticated");
  assert.equal(classifyAgUiFailure(503, "ag_ui_pilot_disabled"), "disabled");
  assert.equal(classifyAgUiFailure(503, "mgov_not_configured"), "disabled");
  assert.equal(classifyAgUiFailure(503, "upstream_unavailable"), "failed");
  assert.equal(classifyAgUiFailure(500, undefined), "failed");
});
