import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeLiveCenterBoard, summarizeChecks } from "./live-center";

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

test("normalizeLiveCenterBoard shapes the pilot board for rendering", () => {
  const view = normalizeLiveCenterBoard({
    repo: "saiidz/upcomingsounds-private",
    queue: [
      { number: 42, title: "Fix the thing", position: 1, state: "QUEUED" },
      { number: 43, title: "Next in line", state: "AWAITING_CHECKS" },
    ],
    pullRequests: [
      {
        number: 42,
        title: "Fix the thing",
        checks: [
          { name: "Rust runtime", conclusion: "success" },
          { name: "Static site", conclusion: "failure" },
        ],
      },
    ],
    jobs: [{ name: "Laravel shard 4", runner_name: "UCS-EC2-CI-1", status: "in_progress" }],
    ownerActions: [{ number: 42, title: "Fix the thing", waitingOn: "Waiting on your approval of the deployment." }],
  });
  assert.equal(view.repoLabel, "saiidz/upcomingsounds-private");
  assert.deepEqual(view.queue, [
    { number: 42, title: "Fix the thing", position: 1, state: "QUEUED" },
    { number: 43, title: "Next in line", position: 2, state: "AWAITING_CHECKS" },
  ]);
  assert.deepEqual(view.pullRequests, [
    { number: 42, title: "Fix the thing", passed: 1, failed: 1, pending: 0, failing: ["Static site"] },
  ]);
  assert.deepEqual(view.jobs, [
    { name: "Laravel shard 4", runnerName: "UCS-EC2-CI-1", status: "in_progress" },
  ]);
  assert.deepEqual(view.ownerActions, [
    { label: "#42 Fix the thing", waitingOn: "Waiting on your approval of the deployment." },
  ]);
});

test("normalizeLiveCenterBoard degrades a missing or empty board to empty sections", () => {
  const empty = { repoLabel: "", queue: [], pullRequests: [], jobs: [], ownerActions: [] };
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
