import assert from "node:assert/strict";
import test from "node:test";
import {
  agUiBoardErrorEvents,
  agUiBoardEvents,
  agUiRunIds,
  encodeAgUiSse,
} from "../src/ag-ui.js";

const BOARD = {
  repo: "saiidz/upcomingsounds-private",
  queue: [{ number: 42, title: "Fix the thing", position: 1, state: "QUEUED" }],
  pullRequests: [],
  runners: [],
  ownerActions: [],
};

test("run ids echo usable client ids and mint the rest", () => {
  assert.deepEqual(agUiRunIds({ threadId: "thread-1", runId: "run-1" }), { threadId: "thread-1", runId: "run-1" });
  const minted = agUiRunIds({});
  assert.equal(typeof minted.threadId, "string");
  assert.ok(minted.threadId.length > 0);
  assert.equal(typeof minted.runId, "string");
  assert.ok(minted.runId.length > 0);
  assert.notEqual(minted.threadId, minted.runId);
  // Non-string and oversized ids are not trusted.
  const untrusted = agUiRunIds({ threadId: 42, runId: "x".repeat(500) });
  assert.notEqual(untrusted.threadId, 42);
  assert.ok(untrusted.runId.length <= 128);
});

test("board events are the AG-UI run sequence around the untouched board", () => {
  const ids = { threadId: "thread-1", runId: "run-1" };
  const events = agUiBoardEvents(ids, BOARD);
  assert.deepEqual(events.map((event) => event.type), ["RUN_STARTED", "STATE_SNAPSHOT", "RUN_FINISHED"]);
  assert.equal(events[0].threadId, "thread-1");
  assert.equal(events[0].runId, "run-1");
  // The snapshot is the board object itself — the same payload the
  // board route serves, never a reshaped copy.
  assert.equal(events[1].snapshot, BOARD);
  assert.equal(events[2].threadId, "thread-1");
});

test("a failed board read becomes RUN_STARTED then RUN_ERROR", () => {
  const ids = { threadId: "thread-1", runId: "run-1" };
  const events = agUiBoardErrorEvents(ids, { code: "upstream_unavailable" });
  assert.deepEqual(events.map((event) => event.type), ["RUN_STARTED", "RUN_ERROR"]);
  assert.equal(events[1].code, "upstream_unavailable");
  assert.equal(typeof events[1].message, "string");
  // An error without a code still produces a well-formed event.
  const fallback = agUiBoardErrorEvents(ids, new Error("boom"));
  assert.equal(fallback[1].code, "upstream_unavailable");
});

test("SSE encoding is one data line per event, blank-line separated, JSON round-trippable", () => {
  const ids = { threadId: "thread-1", runId: "run-1" };
  const events = agUiBoardEvents(ids, BOARD);
  const encoded = encodeAgUiSse(events);
  const frames = encoded.split("\n\n").filter((frame) => frame.length > 0);
  assert.equal(frames.length, events.length);
  const parsed = frames.map((frame) => {
    assert.ok(frame.startsWith("data: "), "each frame is a data line");
    return JSON.parse(frame.slice("data: ".length));
  });
  assert.deepEqual(parsed, events);
});
