import assert from "node:assert/strict";
import test from "node:test";
import * as liveCenter from "../src/live-center.js";

const { createLiveCenterService } = liveCenter;
const { DEFAULT_BOARD_CACHE_TTL_MS } = liveCenter;
import { ApiAccessError } from "../src/service.js";

// QA pins for the board cache + stale-on-error cure. The board behind
// the Live Center fans out to ~2,000 GitHub calls per uncached build
// on a shared installation token; when that token's hourly limit is
// exhausted the pilot 502s and every signed-in customer got an error
// page. These pins lock the cure's contract:
//   - a fresh cache hit carries NO stale marker;
//   - at exactly the TTL the entry is expired (upstream is retried);
//   - on upstream failure the last good board is served with
//     stale: true and its generatedAt byte-identical;
//   - with nothing ever cached, the failure still surfaces as 502;
//   - the default TTL is the site's one-minute refresh cadence.

const PILOT_CONFIG = {
  enabled: true,
  baseUrl: "https://pilot.example.com",
  adminToken: "pilot-admin-token",
  tenant: "saiidz-pilot",
  owner: "saiidz",
  repo: "upcomingsounds-private",
  installationId: "179351888",
};

const BOARD = {
  repo: "saiidz/upcomingsounds-private",
  generatedAt: "2026-11-23T18:04:00.000Z",
  queue: [{ number: 42, title: "Fix the thing" }],
  stageCounts: { ready: 0, failing: 1, checking: 0, queue: 514 },
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

test("pin: the default board cache TTL is 60s (the page refresh cadence)", () => {
  assert.equal(DEFAULT_BOARD_CACHE_TTL_MS, 60_000);
});

test("pin: at exactly the TTL the cached board is expired and upstream is retried", async () => {
  let t = 5_000_000;
  let fetches = 0;
  const service = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => { fetches += 1; return jsonResponse(BOARD); },
    now: () => t,
    boardCacheTtlMs: 60_000,
  });
  await service.getBoard();
  t += 59_999;
  await service.getBoard();
  assert.equal(fetches, 1);
  t += 1;
  await service.getBoard();
  assert.equal(fetches, 2);
});

test("pin: stale serve stamps stale:true and keeps generatedAt byte-identical", async () => {
  let t = 5_000_000;
  let fail = false;
  const service = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => {
      if (fail) return jsonResponse({ error: "upstream_unavailable" }, { ok: false, status: 502 });
      return jsonResponse(BOARD);
    },
    now: () => t,
    boardCacheTtlMs: 60_000,
  });
  const fresh = await service.getBoard();
  assert.equal("stale" in fresh, false);
  t += 7_200_000;
  fail = true;
  const stale = await service.getBoard();
  assert.equal(stale.stale, true);
  assert.equal(stale.generatedAt, BOARD.generatedAt);
  assert.deepEqual(stale.queue, BOARD.queue);
  assert.deepEqual(stale.stageCounts, BOARD.stageCounts);
});

test("pin: with nothing ever cached an upstream failure still surfaces as 502", async () => {
  const service = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => jsonResponse({ error: "upstream_unavailable" }, { ok: false, status: 502 }),
    now: () => 5_000_000,
    boardCacheTtlMs: 60_000,
  });
  await assert.rejects(
    service.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 502 && error.code === "upstream_unavailable",
  );
});

test("pin: a cold service never inherits another instance's cache", async () => {
  const warm = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => jsonResponse(BOARD),
    now: () => 5_000_000,
    boardCacheTtlMs: 60_000,
  });
  await warm.getBoard();
  const cold = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => { throw new Error("connection refused"); },
    now: () => 5_000_000,
    boardCacheTtlMs: 60_000,
  });
  await assert.rejects(
    cold.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 502,
  );
});
