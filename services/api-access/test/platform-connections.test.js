import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import {
  PLATFORM_AUDIT_AWAITING_CONFIGURATION,
  PLATFORM_AUDIT_AWAITING_MESSAGE,
  PLATFORM_AUDIT_LIVE_PLATFORMS,
  PLATFORM_AUDIT_READ_COMPLETE,
  PLATFORM_AUDIT_READ_PARTIAL,
  PLATFORM_CONNECTION_PLATFORMS,
  cleanPlatformConnectionInput,
  createPlatformConnectionsService,
  latestAuditState,
  platformConnectionView,
  tokenFingerprint,
} from "../src/platform-connections.js";
import { createPlatformTokenProtector } from "../src/platform-token-protector.js";

const ACCOUNT = `acct_${"a".repeat(32)}`;
const OTHER_ACCOUNT = `acct_${"b".repeat(32)}`;
const KEY_ARN = "arn:aws:kms:us-east-2:817198673108:key/1234abcd-12ab-34cd-56ef-1234567890ab";

function fakeStore() {
  const records = new Map();
  const runs = new Map();
  return {
    records,
    runs,
    async addConnection(accountId, record) {
      records.set(`${accountId}#${record.connectionId}`, { accountId, ...record });
      return record;
    },
    async listConnections(accountId) {
      return [...records.values()].filter((record) => record.accountId === accountId);
    },
    async putAuditRun(accountId, run) {
      runs.set(`${accountId}#${run.runId}`, { accountId, ...run });
      return run;
    },
    async listAuditRuns(accountId) {
      return [...runs.values()]
        .filter((run) => run.accountId === accountId)
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    },
  };
}

function fakeProtector() {
  const calls = [];
  return {
    calls,
    async encrypt(accountId, token) {
      calls.push(["encrypt", accountId, token]);
      return `sealed:${createHash("sha256").update(token).digest("hex")}`;
    },
    async decrypt() {
      throw new Error("decrypt is not used by the service");
    },
  };
}

function serviceWith(overrides = {}) {
  return createPlatformConnectionsService({
    store: fakeStore(),
    protector: fakeProtector(),
    now: () => new Date("2026-11-26T20:00:00.000Z"),
    createId: () => "conn-1",
    ...overrides,
  });
}

test("the platform set is exactly the four hand-typed doors — GitHub keeps its own flow", () => {
  assert.deepEqual(PLATFORM_CONNECTION_PLATFORMS, ["gitlab", "azure", "bitbucket", "forge"]);
});

test("input cleaning accepts each platform's own identifier shape", () => {
  const gitlab = cleanPlatformConnectionInput({
    platform: "gitlab",
    baseUrl: "https://gitlab.example.com/",
    repositories: ["group/project", "group/sub/project"],
  });
  assert.equal(gitlab.baseUrl, "https://gitlab.example.com");
  assert.deepEqual(gitlab.repositories, ["group/project", "group/sub/project"]);

  const forge = cleanPlatformConnectionInput({
    platform: "forge",
    baseUrl: "https://git.example.com",
    repositories: ["acme/alpha"],
  });
  assert.deepEqual(forge.repositories, ["acme/alpha"]);

  const azure = cleanPlatformConnectionInput({
    platform: "azure",
    organization: "Acme Org",
    project: "Platform Team",
    repositories: ["api service"],
  });
  assert.equal(azure.organization, "Acme Org");
  assert.deepEqual(azure.repositories, ["api service"]);

  const bitbucket = cleanPlatformConnectionInput({
    platform: "bitbucket",
    workspace: "acme",
    repositories: ["alpha", "beta"],
  });
  assert.equal(bitbucket.workspace, "acme");
  assert.deepEqual(bitbucket.repositories, ["alpha", "beta"]);
});

test("input cleaning rejects cross-platform and malformed shapes instead of guessing", () => {
  const bad = [
    { platform: "github", repositories: ["acme/alpha"] },
    { platform: "gitlab", baseUrl: "http://gitlab.example.com", repositories: ["g/p"] },
    { platform: "gitlab", baseUrl: "https://user:pass@gitlab.example.com", repositories: ["g/p"] },
    { platform: "gitlab", baseUrl: "https://gitlab.example.com", repositories: ["baregroup"] },
    { platform: "forge", baseUrl: "https://git.example.com", repositories: ["a/b/c"] },
    { platform: "azure", organization: "acme", project: "p", repositories: ["has/slash"] },
    { platform: "bitbucket", workspace: "ac me", repositories: ["alpha"] },
    { platform: "bitbucket", workspace: "acme", repositories: [] },
    { platform: "gitlab", baseUrl: "https://gitlab.example.com", repositories: ["g/p"], token: "short" },
  ];
  for (const input of bad) {
    assert.throws(() => cleanPlatformConnectionInput(input), (error) => error instanceof ApiAccessError && error.statusCode === 400);
  }
});

test("register seals a supplied token and the view carries only its fingerprint", async () => {
  const store = fakeStore();
  const protector = fakeProtector();
  const service = serviceWith({ store, protector });
  const token = "glpat-test-token-123456";
  const view = await service.register(ACCOUNT, {
    platform: "gitlab",
    baseUrl: "https://gitlab.example.com",
    repositories: ["group/project"],
    token,
  });
  assert.equal(view.connectionId, "conn-1");
  assert.equal(view.tokenStored, true);
  assert.equal(view.tokenFingerprint, createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12));
  assert.equal(view.auditState, PLATFORM_AUDIT_AWAITING_CONFIGURATION);
  assert.ok(!("tokenCiphertext" in view), "the sealed ciphertext never appears in a view");
  assert.ok(!JSON.stringify(view).includes(token), "the plaintext token never appears in a view");
  const stored = store.records.get(`${ACCOUNT}#conn-1`);
  assert.ok(stored.tokenCiphertext.startsWith("sealed:"));
  assert.ok(!stored.tokenCiphertext.includes(token));
  assert.deepEqual(protector.calls, [["encrypt", ACCOUNT, token]]);
});

test("register without a token needs no protector and says no token is stored", async () => {
  const service = serviceWith({ protector: undefined });
  const view = await service.register(ACCOUNT, {
    platform: "bitbucket",
    workspace: "acme",
    repositories: ["alpha"],
  });
  assert.equal(view.tokenStored, false);
  assert.equal(view.tokenFingerprint, null);
});

test("register with a token but no protector refuses with the not-configured 503", async () => {
  const service = serviceWith({ protector: undefined });
  await assert.rejects(
    service.register(ACCOUNT, {
      platform: "bitbucket",
      workspace: "acme",
      repositories: ["alpha"],
      token: "xoxb-test-token-123456",
    }),
    (error) => error instanceof ApiAccessError && error.statusCode === 503 && error.code === "platform_connections_not_configured",
  );
});

test("list returns views only, scoped to the account", async () => {
  const store = fakeStore();
  const service = serviceWith({ store });
  await service.register(ACCOUNT, { platform: "forge", baseUrl: "https://git.example.com", repositories: ["acme/alpha"] });
  const { connections } = await service.list(ACCOUNT);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].platform, "forge");
  const other = await service.list(OTHER_ACCOUNT);
  assert.equal(other.connections.length, 0);
});

test("audit answers the honest awaiting-configuration status and never fabricates a run", async () => {
  const service = serviceWith();
  await service.register(ACCOUNT, { platform: "azure", organization: "acme", project: "core", repositories: ["api"] });
  const result = await service.audit(ACCOUNT, "conn-1");
  assert.equal(result.auditState, "awaiting_configuration");
  assert.equal(result.message, PLATFORM_AUDIT_AWAITING_MESSAGE);
  assert.match(result.message, /Nothing has been run against your repository yet/);
  await assert.rejects(
    service.audit(ACCOUNT, "missing"),
    (error) => error instanceof ApiAccessError && error.statusCode === 404 && error.code === "connection_not_found",
  );
});

test("the view of a bare record exposes identifiers and token facts only", () => {
  const view = platformConnectionView({
    connectionId: "c1",
    platform: "gitlab",
    baseUrl: "https://gitlab.example.com",
    repositories: ["g/p"],
    tokenCiphertext: "sealed:abc",
    tokenFingerprint: "0123456789ab",
    createdAt: "2026-11-26T20:00:00.000Z",
    updatedAt: "2026-11-26T20:00:00.000Z",
  });
  assert.deepEqual(Object.keys(view).sort(), [
    "auditState", "baseUrl", "connectionId", "createdAt", "platform",
    "repositories", "tokenFingerprint", "tokenStored", "updatedAt",
  ]);
  assert.equal(tokenFingerprint("glpat-test-token-123456"), createHash("sha256").update("glpat-test-token-123456", "utf8").digest("hex").slice(0, 12));
});

test("the token protector seals under the platform purpose bound to the account", async () => {
  const sent = [];
  const kms = {
    async send(command) {
      sent.push(command);
      if (command.input.Plaintext) return { CiphertextBlob: Buffer.from("sealed-bytes") };
      return { Plaintext: Buffer.from("the-token-value") };
    },
  };
  const protector = createPlatformTokenProtector(kms, KEY_ARN);
  const sealed = await protector.encrypt(ACCOUNT, "glpat-test-token-123456");
  assert.equal(sealed, Buffer.from("sealed-bytes").toString("base64"));
  assert.deepEqual(sent[0].input.EncryptionContext, { purpose: "solvelang-platform-connection", accountId: ACCOUNT });
  assert.equal(sent[0].input.KeyId, KEY_ARN);
  const opened = await protector.decrypt(ACCOUNT, sealed);
  assert.equal(opened, "the-token-value");
  assert.deepEqual(sent[1].input.EncryptionContext, { purpose: "solvelang-platform-connection", accountId: ACCOUNT });
  await assert.rejects(protector.encrypt("not-an-account", "glpat-test-token-123456"));
  assert.throws(() => createPlatformTokenProtector(kms, "not-an-arn"));
  assert.throws(() => createPlatformTokenProtector(null, KEY_ARN));
});

// --- Live audit legs -------------------------------------------------

function reversibleProtector() {
  const calls = [];
  return {
    calls,
    async encrypt(accountId, token) {
      calls.push(["encrypt", accountId, token]);
      return `sealed:${Buffer.from(token, "utf8").toString("base64")}`;
    },
    async decrypt(accountId, ciphertext) {
      calls.push(["decrypt", accountId, ciphertext]);
      return Buffer.from(ciphertext.replace(/^sealed:/, ""), "base64").toString("utf8");
    },
  };
}

function stubManifest(repository) {
  return {
    repoFullName: repository,
    defaultBranch: "main",
    commitSha: "abc123",
    files: [],
    skipped: [],
    totals: { files: 2, bytes: 27, skipped: 0 },
  };
}

function liveServiceWith(overrides = {}) {
  let runCounter = 0;
  return serviceWith({
    protector: reversibleProtector(),
    createRunId: () => `run-${(runCounter += 1)}`,
    ...overrides,
  });
}

test("the live platform set names only the platform proven end-to-end", () => {
  assert.deepEqual(PLATFORM_AUDIT_LIVE_PLATFORMS, ["forge"]);
});

test("audit runs the live leg for a forge connection with a token and stores run records", async () => {
  const store = fakeStore();
  const protector = reversibleProtector();
  const readCalls = [];
  const service = liveServiceWith({
    store,
    protector,
    readers: {
      forge: async (repository) => {
        readCalls.push(repository);
        return stubManifest(repository);
      },
    },
  });
  await service.register(ACCOUNT, {
    platform: "forge",
    baseUrl: "https://git.example.com",
    repositories: ["acme/alpha", "acme/beta"],
    token: "forge-token-value-123",
  });
  const result = await service.audit(ACCOUNT, "conn-1");
  assert.equal(result.auditState, PLATFORM_AUDIT_READ_COMPLETE);
  assert.deepEqual(readCalls, ["acme/alpha", "acme/beta"]);
  assert.equal(result.runs.length, 2);
  assert.deepEqual(result.runs[0], {
    repository: "acme/alpha",
    runId: "run-1",
    status: "read_complete",
    defaultBranch: "main",
    commitSha: "abc123",
    totals: { files: 2, bytes: 27, skipped: 0 },
  });
  assert.equal(store.runs.size, 2);
  const stored = [...store.runs.values()].find((run) => run.repository === "acme/beta");
  assert.equal(stored.status, "read_complete");
  assert.equal(stored.connectionId, "conn-1");
  assert.deepEqual(stored.manifest, { defaultBranch: "main", commitSha: "abc123", totals: { files: 2, bytes: 27, skipped: 0 } });
  assert.equal(protector.calls.filter(([kind]) => kind === "decrypt").length, 1);
  const { connections } = await service.list(ACCOUNT);
  assert.equal(connections[0].auditState, PLATFORM_AUDIT_READ_COMPLETE);
});

test("audit reports read_partial when one repository fails and stores the failure as failed", async () => {
  const store = fakeStore();
  const service = liveServiceWith({
    store,
    readers: {
      forge: async (repository) => {
        if (repository === "acme/beta") throw new Error("platform refused");
        return stubManifest(repository);
      },
    },
  });
  await service.register(ACCOUNT, {
    platform: "forge",
    baseUrl: "https://git.example.com",
    repositories: ["acme/alpha", "acme/beta"],
    token: "forge-token-value-123",
  });
  const result = await service.audit(ACCOUNT, "conn-1");
  assert.equal(result.auditState, PLATFORM_AUDIT_READ_PARTIAL);
  assert.deepEqual(result.runs.map((run) => run.status), ["read_complete", "read_failed"]);
  const stored = [...store.runs.values()];
  assert.equal(stored.filter((run) => run.status === "read_failed").length, 1);
  const { connections } = await service.list(ACCOUNT);
  assert.equal(connections[0].auditState, PLATFORM_AUDIT_READ_PARTIAL);
});

test("audit refuses with 502 when every repository read fails, and the runs stay failed", async () => {
  const store = fakeStore();
  const service = liveServiceWith({
    store,
    readers: { forge: async () => { throw new Error("platform refused"); } },
  });
  await service.register(ACCOUNT, {
    platform: "forge",
    baseUrl: "https://git.example.com",
    repositories: ["acme/alpha"],
    token: "forge-token-value-123",
  });
  await assert.rejects(
    service.audit(ACCOUNT, "conn-1"),
    (error) => error instanceof ApiAccessError && error.statusCode === 502 && error.code === "platform_repo_read_failed",
  );
  assert.deepEqual([...store.runs.values()].map((run) => run.status), ["read_failed"]);
  const { connections } = await service.list(ACCOUNT);
  assert.equal(connections[0].auditState, "read_failed");
});

test("audit keeps the awaiting answer for a platform that is not live-proven, even with a token", async () => {
  const store = fakeStore();
  let readerCalled = false;
  const service = liveServiceWith({
    store,
    readers: {
      gitlab: async () => {
        readerCalled = true;
        return stubManifest("group/project");
      },
    },
  });
  await service.register(ACCOUNT, {
    platform: "gitlab",
    baseUrl: "https://gitlab.example.com",
    repositories: ["group/project"],
    token: "glpat-test-token-123456",
  });
  const result = await service.audit(ACCOUNT, "conn-1");
  assert.equal(result.auditState, PLATFORM_AUDIT_AWAITING_CONFIGURATION);
  assert.equal(result.message, PLATFORM_AUDIT_AWAITING_MESSAGE);
  assert.equal(readerCalled, false);
  assert.equal(store.runs.size, 0);
});

test("audit keeps the awaiting answer for a live platform connection that has no token", async () => {
  const store = fakeStore();
  let readerCalled = false;
  const service = liveServiceWith({
    store,
    readers: {
      forge: async () => {
        readerCalled = true;
        return stubManifest("acme/alpha");
      },
    },
  });
  await service.register(ACCOUNT, {
    platform: "forge",
    baseUrl: "https://git.example.com",
    repositories: ["acme/alpha"],
  });
  const result = await service.audit(ACCOUNT, "conn-1");
  assert.equal(result.auditState, PLATFORM_AUDIT_AWAITING_CONFIGURATION);
  assert.equal(result.message, PLATFORM_AUDIT_AWAITING_MESSAGE);
  assert.equal(readerCalled, false);
  assert.equal(store.runs.size, 0);
});

test("latestAuditState derives state from the latest run per repository", () => {
  const run = (repository, status, createdAt) => ({ connectionId: "c1", repository, status, createdAt });
  assert.equal(latestAuditState([], "c1"), PLATFORM_AUDIT_AWAITING_CONFIGURATION);
  assert.equal(latestAuditState([run("a/x", "read_complete", "2026-11-28T00:00:00.000Z")], "c1"), "read_complete");
  assert.equal(latestAuditState([
    run("a/x", "read_complete", "2026-11-28T00:00:00.000Z"),
    run("a/y", "read_failed", "2026-11-28T00:00:00.000Z"),
  ], "c1"), "read_partial");
  assert.equal(latestAuditState([run("a/x", "read_failed", "2026-11-28T00:00:00.000Z")], "c1"), "read_failed");
  // A newer complete run supersedes an older failure for the same repository.
  assert.equal(latestAuditState([
    run("a/x", "read_failed", "2026-11-28T00:00:00.000Z"),
    run("a/x", "read_complete", "2026-11-28T01:00:00.000Z"),
  ], "c1"), "read_complete");
  // Runs of another connection never leak into this one's state.
  assert.equal(latestAuditState([
    { connectionId: "other", repository: "a/x", status: "read_complete", createdAt: "2026-11-28T00:00:00.000Z" },
  ], "c1"), PLATFORM_AUDIT_AWAITING_CONFIGURATION);
});
