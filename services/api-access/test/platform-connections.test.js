import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ApiAccessError } from "../src/service.js";
import {
  PLATFORM_AUDIT_AWAITING_CONFIGURATION,
  PLATFORM_AUDIT_AWAITING_MESSAGE,
  PLATFORM_CONNECTION_PLATFORMS,
  cleanPlatformConnectionInput,
  createPlatformConnectionsService,
  platformConnectionView,
  tokenFingerprint,
} from "../src/platform-connections.js";
import { createPlatformTokenProtector } from "../src/platform-token-protector.js";

const ACCOUNT = `acct_${"a".repeat(32)}`;
const OTHER_ACCOUNT = `acct_${"b".repeat(32)}`;
const KEY_ARN = "arn:aws:kms:us-east-2:817198673108:key/1234abcd-12ab-34cd-56ef-1234567890ab";

function fakeStore() {
  const records = new Map();
  return {
    records,
    async addConnection(accountId, record) {
      records.set(`${accountId}#${record.connectionId}`, { accountId, ...record });
      return record;
    },
    async listConnections(accountId) {
      return [...records.values()].filter((record) => record.accountId === accountId);
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
