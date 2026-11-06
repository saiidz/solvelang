import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  applyInstallationWebhook,
  buildAuthorizeUrl,
  buildInstallUrl,
  createAppJwt,
  createInstallationToken,
  exchangeOAuthCode,
  fetchGitHubUser,
  linkInstallationFromGitHub,
  verifyWebhookSignature,
} from "../src/github-app.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import { createDynamoGitHubStore } from "../src/github-store.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const AT = Date.parse("2026-11-05T12:00:00Z");

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("app JWT is RS256, verifies against the public key, and carries iss/iat/exp", () => {
  const jwt = createAppJwt({ appId: 424242, privateKey: privatePem, now: AT });
  const [headerSegment, payloadSegment, signatureSegment] = jwt.split(".");
  assert.deepEqual(decodeSegment(headerSegment), { alg: "RS256", typ: "JWT" });
  const payload = decodeSegment(payloadSegment);
  assert.equal(payload.iss, "424242");
  assert.equal(payload.iat, Math.floor(AT / 1_000) - 60);
  assert.equal(payload.exp, Math.floor(AT / 1_000) + 540);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();
  assert.equal(verifier.verify(publicPem, Buffer.from(signatureSegment, "base64url")), true);
});

test("app JWT accepts an env-style escaped private key", () => {
  const escaped = privatePem.replace(/\n/g, "\\n");
  const jwt = createAppJwt({ appId: "424242", privateKey: escaped, now: AT });
  const [headerSegment, payloadSegment, signatureSegment] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();
  assert.equal(verifier.verify(publicPem, Buffer.from(signatureSegment, "base64url")), true);
});

test("webhook signature accepts a good signature and rejects bad or malformed input", () => {
  const secret = "whsec-test-secret";
  const rawBody = JSON.stringify({ action: "created", installation: { id: 7 } });
  const good = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  assert.equal(verifyWebhookSignature({ secret, rawBody, signature: good }), true);
  assert.equal(verifyWebhookSignature({ secret, rawBody: Buffer.from(rawBody), signature: good }), true);
  assert.equal(verifyWebhookSignature({ secret, rawBody: `${rawBody} `, signature: good }), false);
  assert.equal(verifyWebhookSignature({ secret: "other-secret", rawBody, signature: good }), false);
  assert.equal(verifyWebhookSignature({ secret, rawBody, signature: good.replace("sha256=", "") }), false);
  assert.equal(verifyWebhookSignature({ secret, rawBody, signature: "sha256=zzzz" }), false);
  assert.equal(verifyWebhookSignature({ secret, rawBody, signature: `sha256=${"a".repeat(63)}` }), false);
  assert.equal(verifyWebhookSignature({ secret, rawBody, signature: undefined }), false);
  assert.equal(verifyWebhookSignature({ secret, rawBody: 42, signature: good }), false);
  assert.equal(verifyWebhookSignature({ secret: "", rawBody, signature: good }), false);
  assert.equal(verifyWebhookSignature({}), false);
});

test("authorize URL targets GitHub with client id and state", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "Iv1.abc", state: "nonce-123" }));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv1.abc");
  assert.equal(url.searchParams.get("state"), "nonce-123");
  assert.equal(url.searchParams.get("redirect_uri"), null);
});

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test("OAuth code exchange posts to GitHub and returns the token", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push([String(url), options]);
    return jsonResponse({ access_token: "ghu_token", token_type: "bearer", scope: "" });
  };
  const result = await exchangeOAuthCode({ clientId: "cid", clientSecret: "csecret", code: "code-1", fetchImpl });
  assert.equal(result.accessToken, "ghu_token");
  assert.equal(seen[0][0], "https://github.com/login/oauth/access_token");
  assert.equal(seen[0][1].method, "POST");
  assert.deepEqual(JSON.parse(seen[0][1].body), { client_id: "cid", client_secret: "csecret", code: "code-1" });
  await assert.rejects(() => exchangeOAuthCode({
    clientId: "cid", clientSecret: "csecret", code: "bad",
    fetchImpl: async () => jsonResponse({ error: "bad_verification_code" }),
  }), /failed/);
});

test("fetchGitHubUser returns the primary VERIFIED email only", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/user")) return jsonResponse({ id: 99, login: "octocat", email: "public@example.com" });
    if (String(url).endsWith("/user/emails")) {
      return jsonResponse([
        { email: "secondary@example.com", primary: false, verified: true },
        { email: "Primary@Example.com", primary: true, verified: true },
        { email: "unverified@example.com", primary: false, verified: false },
      ]);
    }
    throw new Error("unexpected url");
  };
  const user = await fetchGitHubUser({ token: "ghu_token", fetchImpl });
  assert.deepEqual(user, { id: 99, login: "octocat", primaryVerifiedEmail: "primary@example.com" });

  const noVerified = await fetchGitHubUser({
    token: "ghu_token",
    fetchImpl: async (url) => (String(url).endsWith("/user")
      ? jsonResponse({ id: 99, login: "octocat" })
      : jsonResponse([{ email: "unverified@example.com", primary: true, verified: false }])),
  });
  assert.equal(noVerified.primaryVerifiedEmail, null);
});

test("installation token is minted with the app JWT", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push([String(url), options]);
    return jsonResponse({ token: "ghs_installation", expires_at: "2026-11-05T13:00:00Z" });
  };
  const result = await createInstallationToken({ appJwt: "header.payload.sig", installationId: 7, fetchImpl });
  assert.deepEqual(result, { token: "ghs_installation", expiresAt: "2026-11-05T13:00:00Z" });
  assert.equal(seen[0][0], "https://api.github.com/app/installations/7/access_tokens");
  assert.equal(seen[0][1].headers.authorization, "Bearer header.payload.sig");
});

// In-memory document client over a single recordKey partition key,
// implementing exactly the command shapes github-store.js issues.
function fakeDocumentClient() {
  const items = new Map();
  return {
    items,
    async send(command) {
      const { input } = command;
      const name = command.constructor.name;
      if (name === "GetCommand") return { Item: items.get(input.Key.recordKey) };
      if (name === "PutCommand") { items.set(input.Item.recordKey, structuredClone(input.Item)); return {}; }
      if (name === "DeleteCommand") {
        const existing = items.get(input.Key.recordKey);
        if (input.ConditionExpression && !existing) {
          throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        }
        items.delete(input.Key.recordKey);
        return input.ReturnValues === "ALL_OLD" ? { Attributes: existing } : {};
      }
      if (name === "QueryCommand") {
        const prefix = input.ExpressionAttributeValues[":prefix"];
        return { Items: [...items.values()].filter((item) => item.recordKey.startsWith(prefix)) };
      }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}

test("installation store round-trips, links and lists per account", async () => {
  const client = fakeDocumentClient();
  const store = createDynamoGitHubStore(client, "github-table", { now: () => AT });
  assert.equal(await store.getInstallation(7), undefined);
  await store.putInstallation({
    installationId: 7, accountLogin: "octocat", accountType: "User",
    repositories: [{ id: 1, fullName: "octocat/hello" }], suspended: false,
    updatedAt: new Date(AT).toISOString(),
  });
  const stored = await store.getInstallation(7);
  assert.equal(stored.accountLogin, "octocat");
  assert.deepEqual(stored.repositories, [{ id: 1, fullName: "octocat/hello" }]);
  assert.equal(stored.suspended, false);

  await store.linkAccountInstallation({ accountId: "acct_abc", installationId: 7 });
  assert.equal((await store.getInstallation(7)).accountId, "acct_abc");
  // A later webhook rewrite without an accountId keeps the link stamp.
  await store.putInstallation({ installationId: 7, accountLogin: "octocat", accountType: "User", repositories: [], suspended: true, updatedAt: new Date(AT).toISOString() });
  const relisted = await store.listInstallationsForAccount("acct_abc");
  assert.equal(relisted.length, 1);
  assert.equal(relisted[0].installationId, 7);
  assert.equal(relisted[0].accountId, "acct_abc");
  assert.equal(relisted[0].suspended, true);
  assert.deepEqual(await store.listInstallationsForAccount("acct_someone_else"), []);

  await store.deleteInstallation(7);
  assert.equal(await store.getInstallation(7), undefined);
});

test("OAuth state consume is single-use and expiry-aware", async () => {
  let clock = AT;
  const store = createDynamoGitHubStore(fakeDocumentClient(), "github-table", { now: () => clock });
  await store.putOAuthState({ nonce: "nonce-1", ttlSeconds: 600 });
  assert.equal(await store.consumeOAuthState("nonce-1"), true);
  assert.equal(await store.consumeOAuthState("nonce-1"), false);
  assert.equal(await store.consumeOAuthState("never-issued"), false);
  await store.putOAuthState({ nonce: "nonce-2", ttlSeconds: 60 });
  clock = AT + 61_000;
  assert.equal(await store.consumeOAuthState("nonce-2"), false);
});

test("webhook payloads drive installation store transitions", async () => {
  const store = createDynamoGitHubStore(fakeDocumentClient(), "github-table", { now: () => AT });
  const created = await applyInstallationWebhook({
    store, now: AT,
    payload: {
      action: "created",
      installation: { id: 7, account: { login: "octocat", type: "User" }, suspended_at: null },
      repositories: [{ id: 1, full_name: "octocat/hello" }, { id: 2, full_name: "octocat/world" }],
    },
  });
  assert.deepEqual(created, { handled: true, installationId: 7 });
  assert.deepEqual((await store.getInstallation(7)).repositories, [
    { id: 1, fullName: "octocat/hello" }, { id: 2, fullName: "octocat/world" },
  ]);

  await applyInstallationWebhook({
    store, now: AT,
    payload: {
      action: "added",
      installation: { id: 7, account: { login: "octocat", type: "User" } },
      repositories_added: [{ id: 3, full_name: "octocat/new" }],
      repositories_removed: [{ id: 1, full_name: "octocat/hello" }],
    },
  });
  assert.deepEqual((await store.getInstallation(7)).repositories.map((repo) => repo.id), [2, 3]);

  await applyInstallationWebhook({ store, now: AT, payload: { action: "suspend", installation: { id: 7, account: { login: "octocat", type: "User" } } } });
  assert.equal((await store.getInstallation(7)).suspended, true);
  await applyInstallationWebhook({ store, now: AT, payload: { action: "unsuspend", installation: { id: 7, account: { login: "octocat", type: "User" } } } });
  assert.equal((await store.getInstallation(7)).suspended, false);

  assert.deepEqual(
    await applyInstallationWebhook({ store, now: AT, payload: { action: "something_else", installation: { id: 7 } } }),
    { handled: false },
  );
  await applyInstallationWebhook({ store, now: AT, payload: { action: "deleted", installation: { id: 7, account: { login: "octocat", type: "User" } } } });
  assert.equal(await store.getInstallation(7), undefined);
});

test("githubApp config stays dark unless every credential is present", () => {
  const base = {
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCESS_ADMIN_SECRET: "a".repeat(32),
    API_ACCOUNTS_TABLE: "accounts", API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage", API_USAGE_IDEMPOTENCY_TABLE: "idem",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    SITE_ORIGIN: "https://www.solve-lang.com",
  };
  assert.equal(parseApiAccessEnvironment(base).githubApp.enabled, false);
  const partial = parseApiAccessEnvironment({ ...base, API_GITHUB_APP_ID: "1", API_GITHUB_APP_CLIENT_ID: "cid" }).githubApp;
  assert.equal(partial.enabled, false);
  const full = parseApiAccessEnvironment({
    ...base,
    API_GITHUB_APP_ID: "1", API_GITHUB_APP_CLIENT_ID: "cid", API_GITHUB_APP_CLIENT_SECRET: "cs",
    API_GITHUB_APP_PRIVATE_KEY: "pk", API_GITHUB_APP_WEBHOOK_SECRET: "ws",
  }).githubApp;
  assert.equal(full.enabled, true);
  assert.equal(full.appId, "1");
  assert.equal(full.webhookSecret, "ws");
});

test("install URL targets the app's GitHub install screen with the state", () => {
  assert.equal(
    buildInstallUrl({ slug: "solvelang", state: "nonce-9" }),
    "https://github.com/apps/solvelang/installations/new?state=nonce-9",
  );
});

test("purpose-bound OAuth states record their binding and never validate as sign-in states", async () => {
  const store = createDynamoGitHubStore(fakeDocumentClient(), "github-table", { now: () => AT });
  await store.putOAuthState({ nonce: "install-1", purpose: "install", accountId: "acct_abc" });
  // The sign-in consume refuses a purpose-bound state (and burns it).
  assert.equal(await store.consumeOAuthState("install-1"), false);
  assert.equal(await store.consumeOAuthStateRecord("install-1"), null);

  await store.putOAuthState({ nonce: "install-2", purpose: "install", accountId: "acct_abc" });
  assert.deepEqual(await store.consumeOAuthStateRecord("install-2"), { purpose: "install", accountId: "acct_abc" });
  assert.equal(await store.consumeOAuthStateRecord("install-2"), null);

  await store.putOAuthState({ nonce: "signin-1" });
  assert.deepEqual(await store.consumeOAuthStateRecord("signin-1"), { purpose: undefined, accountId: undefined });
});

function linkFetch({ installation, installationStatus = 200, repositories = [] }) {
  const calls = [];
  const impl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target === "https://api.github.com/app/installations/42") {
      return jsonResponse(installation, { ok: installationStatus === 200, status: installationStatus });
    }
    if (target === "https://api.github.com/app/installations/42/access_tokens") {
      return jsonResponse({ token: "ghs_test_token", expires_at: "2026-11-05T13:00:00Z" });
    }
    if (target.startsWith("https://api.github.com/installation/repositories")) {
      return jsonResponse({ total_count: repositories.length, repositories });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  impl.calls = calls;
  return impl;
}

const LIVE_INSTALLATION = {
  id: 42,
  app_id: 123,
  account: { login: "octocat", type: "User" },
  suspended_at: null,
};

async function linkReadyStore() {
  const store = createDynamoGitHubStore(fakeDocumentClient(), "github-table", { now: () => AT });
  await store.putOAuthState({ nonce: "install-state", purpose: "install", accountId: "acct_abc" });
  return store;
}

test("link happy path verifies the installation live, then writes the record and the link", async () => {
  const store = await linkReadyStore();
  const fetchImpl = linkFetch({
    installation: LIVE_INSTALLATION,
    repositories: [
      { id: 1, full_name: "octocat/hello" },
      { id: 2, full_name: "octocat/world" },
    ],
  });
  const summary = await linkInstallationFromGitHub({
    store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
    installationId: 42, state: "install-state", fetchImpl, now: () => AT,
  });
  assert.equal(summary.linked, true);
  assert.equal(summary.accountLogin, "octocat");
  assert.deepEqual(summary.repositories, [
    { id: 1, fullName: "octocat/hello" },
    { id: 2, fullName: "octocat/world" },
  ]);
  const stored = await store.getInstallation(42);
  assert.equal(stored.accountId, "acct_abc");
  assert.equal(stored.suspended, false);
  assert.equal((await store.listInstallationsForAccount("acct_abc")).length, 1);
  // The state is single-use: a replay is rejected without any GitHub call.
  const callsBefore = fetchImpl.calls.length;
  await assert.rejects(
    () => linkInstallationFromGitHub({
      store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
      installationId: 42, state: "install-state", fetchImpl, now: () => AT,
    }),
    (error) => error.code === "github_link_state_invalid" && error.statusCode === 400,
  );
  assert.equal(fetchImpl.calls.length, callsBefore);
});

test("link rejects a state bound to a different account and writes nothing", async () => {
  const store = await linkReadyStore();
  const fetchImpl = linkFetch({ installation: LIVE_INSTALLATION });
  await assert.rejects(
    () => linkInstallationFromGitHub({
      store, appId: "123", privateKey: privatePem, accountId: "acct_someone_else",
      installationId: 42, state: "install-state", fetchImpl, now: () => AT,
    }),
    (error) => error.code === "github_link_state_invalid" && error.statusCode === 400,
  );
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(await store.getInstallation(42), undefined);
  assert.deepEqual(await store.listInstallationsForAccount("acct_someone_else"), []);
});

test("link rejects a suspended installation and writes nothing", async () => {
  const store = await linkReadyStore();
  const fetchImpl = linkFetch({
    installation: { ...LIVE_INSTALLATION, suspended_at: "2026-11-01T00:00:00Z" },
  });
  await assert.rejects(
    () => linkInstallationFromGitHub({
      store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
      installationId: 42, state: "install-state", fetchImpl, now: () => AT,
    }),
    (error) => error.code === "github_installation_suspended" && error.statusCode === 403,
  );
  assert.equal(await store.getInstallation(42), undefined);
  assert.deepEqual(await store.listInstallationsForAccount("acct_abc"), []);
});

test("link maps a GitHub 404 to a not-found error and writes nothing", async () => {
  const store = await linkReadyStore();
  const fetchImpl = linkFetch({ installation: { message: "Not Found" }, installationStatus: 404 });
  await assert.rejects(
    () => linkInstallationFromGitHub({
      store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
      installationId: 42, state: "install-state", fetchImpl, now: () => AT,
    }),
    (error) => error.code === "github_installation_not_found" && error.statusCode === 404,
  );
  assert.equal(await store.getInstallation(42), undefined);
});

test("githubApp slug defaults to solvelang and can be overridden", () => {
  const base = {
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCESS_ADMIN_SECRET: "a".repeat(32),
    API_ACCOUNTS_TABLE: "accounts", API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage", API_USAGE_IDEMPOTENCY_TABLE: "idem",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    SITE_ORIGIN: "https://www.solve-lang.com",
  };
  assert.equal(parseApiAccessEnvironment(base).githubApp.slug, "solvelang");
  assert.equal(parseApiAccessEnvironment({ ...base, API_GITHUB_APP_SLUG: "solvelang-dev" }).githubApp.slug, "solvelang-dev");
});
