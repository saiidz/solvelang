import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../src/handler.js";
import { buildQueueSnapshot, mapPullRequest, readRepoQueue } from "../src/queue-reader.js";
import { createMemoryStore } from "../src/state-store.js";

const PULLS = [
  {
    number: 12,
    title: "Add widget",
    head: { sha: "aaa111" },
    base: { ref: "main" },
    draft: false,
    mergeable_state: "clean",
    updated_at: "2026-11-06T10:00:00Z",
  },
  {
    number: 13,
    title: "WIP experiment",
    head: { sha: "bbb222" },
    base: { ref: "main" },
    draft: true,
    mergeable_state: null,
    updated_at: "2026-11-06T11:00:00Z",
  },
  {
    number: 14,
    title: "Fix flake",
    head: { sha: "ccc333" },
    base: { ref: "feat/base" },
    draft: false,
    mergeable_state: "unstable",
    updated_at: "2026-11-06T12:00:00Z",
  },
];

function stubFetch({ pulls = PULLS } = {}) {
  return async (url) => {
    if (url.endsWith("/pulls?state=open&per_page=100")) {
      return { ok: true, status: 200, json: async () => pulls };
    }
    if (url.includes("/repos/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          full_name: "saiidz/solvelang",
          default_branch: "main",
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test("readRepoQueue maps pulls to the queue shape", async () => {
  const { repo, prs } = await readRepoQueue({
    owner: "saiidz",
    repo: "solvelang",
    token: "test-token",
    fetchImpl: stubFetch(),
  });
  assert.equal(repo.fullName, "saiidz/solvelang");
  assert.equal(repo.defaultBranch, "main");
  assert.equal(prs.length, 3);
  assert.deepEqual(prs[0], {
    number: 12,
    title: "Add widget",
    headSha: "aaa111",
    baseRef: "main",
    draft: false,
    mergeableState: "clean",
    updatedAt: "2026-11-06T10:00:00Z",
  });
  assert.equal(prs[2].baseRef, "feat/base");
});

test("buildQueueSnapshot produces state-model records + summary counts", () => {
  const prs = PULLS.map(mapPullRequest);
  const snapshot = buildQueueSnapshot(
    "saiidz-pilot",
    "saiidz",
    "solvelang",
    prs,
    new Date("2026-11-06T15:00:00Z")
  );
  assert.equal(snapshot.tenantId, "saiidz-pilot");
  assert.equal(snapshot.repo, "saiidz/solvelang");
  assert.equal(snapshot.generatedAt, "2026-11-06T15:00:00.000Z");
  assert.deepEqual(snapshot.summary, { openPrs: 3, drafts: 1, paused: false });
  assert.equal(snapshot.records.length, 3);
  assert.equal(snapshot.records[0].state, "queued");
  assert.equal(snapshot.records[1].state, "draft");
  assert.equal(snapshot.records[1].headSha, "bbb222");
});

test("summary counts drafts correctly when all are drafts", () => {
  const prs = [
    { number: 1, title: "a", headSha: "x", baseRef: "main", draft: true, mergeableState: null, updatedAt: "t" },
    { number: 2, title: "b", headSha: "y", baseRef: "main", draft: true, mergeableState: null, updatedAt: "t" },
  ];
  const snapshot = buildQueueSnapshot("t", "o", "r", prs, new Date());
  assert.deepEqual(snapshot.summary, { openPrs: 2, drafts: 2, paused: false });
});

function httpEvent(headers = {}) {
  return {
    rawPath: "/tenants/saiidz-pilot/queue",
    requestContext: { http: { method: "GET", path: "/tenants/saiidz-pilot/queue" } },
    pathParameters: { tenantId: "saiidz-pilot" },
    queryStringParameters: { owner: "saiidz", repo: "solvelang" },
    headers,
  };
}

const BASE_CONFIG = {
  tableName: "t",
  githubToken: "gh",
  adminToken: "admin-secret",
  pilotTenantId: "",
  pilotRepos: [],
  rulesVersion: "pilot-0",
};

test("handler fails closed with 503 when admin token is not configured", async () => {
  const handler = createHandler({
    store: createMemoryStore(),
    config: { ...BASE_CONFIG, adminToken: "" },
    fetchImpl: stubFetch(),
  });
  const res = await handler(httpEvent());
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "admin_auth_not_configured");
});

test("handler fails closed with 503 when GitHub token is not configured", async () => {
  const handler = createHandler({
    store: createMemoryStore(),
    config: { ...BASE_CONFIG, githubToken: "" },
    fetchImpl: stubFetch(),
  });
  const res = await handler(httpEvent({ "x-admin-token": "admin-secret" }));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "github_not_configured");
});

test("handler rejects a wrong admin token with 401", async () => {
  const handler = createHandler({
    store: createMemoryStore(),
    config: BASE_CONFIG,
    fetchImpl: stubFetch(),
  });
  const res = await handler(httpEvent({ "x-admin-token": "nope" }));
  assert.equal(res.statusCode, 401);
});

test("handler happy path writes snapshot, decision, and usage", async () => {
  const store = createMemoryStore();
  const handler = createHandler({
    store,
    config: BASE_CONFIG,
    fetchImpl: stubFetch(),
  });
  const res = await handler(httpEvent({ "x-admin-token": "admin-secret" }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.tenantId, "saiidz-pilot");
  assert.equal(body.repo, "saiidz/solvelang");
  assert.deepEqual(body.summary, { openPrs: 3, drafts: 1, paused: false });
  assert.equal(body.prs.length, 3);

  const entries = await store.listQueueEntries("saiidz-pilot", "saiidz/solvelang");
  assert.equal(entries.length, 3);
  const usage = await store.readUsage("saiidz-pilot", new Date());
  assert.equal(usage.queueReads, 1);
  assert.equal(usage.prsObserved, 3);
});

test("reconcile is a no-op success when the pilot is not configured", async () => {
  const handler = createHandler({
    store: createMemoryStore(),
    config: BASE_CONFIG,
    fetchImpl: stubFetch(),
  });
  const res = await handler({ action: "reconcile" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.paused, []);
});

test("reconcile auto-pauses a repo when a merging head moved (Shield guard)", async () => {
  const store = createMemoryStore();
  await store.upsertQueueEntry("saiidz-pilot", "saiidz/solvelang", 12, {
    headSha: "STALE_SHA",
    state: "merging",
  });
  const handler = createHandler({
    store,
    config: {
      ...BASE_CONFIG,
      pilotTenantId: "saiidz-pilot",
      pilotRepos: [
        { owner: "saiidz", repo: "solvelang", fullName: "saiidz/solvelang" },
      ],
    },
    fetchImpl: stubFetch(),
  });
  const res = await handler({ action: "reconcile" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.paused, [{ repo: "saiidz/solvelang", pr: 12 }]);
  const repoRecord = await store.getRepoRecord("saiidz-pilot", "saiidz/solvelang");
  assert.equal(repoRecord.paused, true);
});
