import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createAppAuth,
  GitHubAppAuthError,
} from "../src/github-app-auth.js";
import { createHandler, parseRepoList } from "../src/handler.js";
import { resolveRepoToken } from "../src/queue-reader.js";
import { createMemoryStore, repoSk, tenantPk } from "../src/state-store.js";

// Throwaway RSA keypair, generated for this test run only — never a real
// app key. Minting against it proves the JWT signing + PEM handling end
// to end with a stubbed fetch standing in for GitHub.
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });

const APP_ID = "5633227";
const INSTALLATION_ID = 179351888;
const FIXED_NOW_MS = Date.parse("2026-11-06T15:00:00Z");

// Stub for POST /app/installations/{id}/access_tokens. Records every call
// (url, method, authorization) and returns incrementing token values with
// an expires_at relative to the injected clock.
function stubTokenFetch(nowRef) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, authorization: options.headers?.authorization });
    return {
      ok: true,
      status: 201,
      json: async () => ({
        token: `ghs_stub_${calls.length}`,
        expires_at: new Date(nowRef() + 3_600_000).toISOString(),
      }),
    };
  };
  return { calls, fetchImpl };
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("getInstallationToken mints with a well-formed RS256 app JWT", async () => {
  const { calls, fetchImpl } = stubTokenFetch(() => FIXED_NOW_MS);
  const appAuth = createAppAuth({
    appId: APP_ID,
    privateKeyPem: PRIVATE_PEM,
    fetchImpl,
    now: () => FIXED_NOW_MS,
  });

  const token = await appAuth.getInstallationToken(INSTALLATION_ID);
  assert.equal(token, "ghs_stub_1");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`
  );
  assert.equal(calls[0].method, "POST");

  const jwt = calls[0].authorization.replace(/^Bearer /, "");
  const [headerSeg, payloadSeg, signatureSeg] = jwt.split(".");
  assert.ok(headerSeg && payloadSeg && signatureSeg, "JWT has three segments");
  assert.deepEqual(decodeSegment(headerSeg), { alg: "RS256", typ: "JWT" });
  const payload = decodeSegment(payloadSeg);
  assert.equal(payload.iss, APP_ID);
  assert.equal(payload.iat, FIXED_NOW_MS / 1000 - 60);
  assert.equal(payload.exp, FIXED_NOW_MS / 1000 + 540);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerSeg}.${payloadSeg}`);
  verifier.end();
  assert.equal(
    verifier.verify(PUBLIC_PEM, Buffer.from(signatureSeg, "base64url")),
    true
  );
});

test("getInstallationToken accepts a \\n-escaped PEM private key", async () => {
  const escapedPem = PRIVATE_PEM.replace(/\n/g, "\\n");
  assert.ok(!escapedPem.includes("\n"));
  const { calls, fetchImpl } = stubTokenFetch(() => FIXED_NOW_MS);
  const appAuth = createAppAuth({
    appId: APP_ID,
    privateKeyPem: escapedPem,
    fetchImpl,
    now: () => FIXED_NOW_MS,
  });
  // Signing with the still-escaped key would throw inside the mint and
  // surface as GitHubAppAuthError; a token back proves unescaping ran.
  const token = await appAuth.getInstallationToken(INSTALLATION_ID);
  assert.equal(token, "ghs_stub_1");
  assert.equal(calls.length, 1);
});

test("getInstallationToken caches per installation until near expiry", async () => {
  let nowValue = FIXED_NOW_MS;
  const { calls, fetchImpl } = stubTokenFetch(() => nowValue);
  const appAuth = createAppAuth({
    appId: APP_ID,
    privateKeyPem: PRIVATE_PEM,
    fetchImpl,
    now: () => nowValue,
  });

  assert.equal(await appAuth.getInstallationToken(INSTALLATION_ID), "ghs_stub_1");
  assert.equal(await appAuth.getInstallationToken(INSTALLATION_ID), "ghs_stub_1");
  assert.equal(calls.length, 1, "second call within expiry must not refetch");

  // A different installation mints separately.
  assert.equal(await appAuth.getInstallationToken(222), "ghs_stub_2");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith("/app/installations/222/access_tokens"));

  // Advancing the clock to inside the 60s safety margin forces a refetch.
  nowValue = FIXED_NOW_MS + 3_600_000 - 30_000;
  assert.equal(await appAuth.getInstallationToken(INSTALLATION_ID), "ghs_stub_3");
  assert.equal(calls.length, 3);
});

test("getInstallationToken throws a typed error and never leaks GitHub detail", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ message: "SECRET_DETAIL_FROM_GITHUB" }),
  });
  const appAuth = createAppAuth({
    appId: APP_ID,
    privateKeyPem: PRIVATE_PEM,
    fetchImpl,
    now: () => FIXED_NOW_MS,
  });
  await assert.rejects(
    () => appAuth.getInstallationToken(INSTALLATION_ID),
    (err) => {
      assert.ok(err instanceof GitHubAppAuthError);
      assert.equal(err.status, 404);
      assert.ok(!err.message.includes("SECRET_DETAIL_FROM_GITHUB"));
      return true;
    }
  );
});

test("resolveRepoToken prefers the installation token when bound + configured", async () => {
  const appAuth = {
    getInstallationToken: async (id) => `installation-${id}`,
  };
  assert.equal(
    await resolveRepoToken({
      installationId: INSTALLATION_ID,
      staticToken: "gh",
      appAuth,
    }),
    `installation-${INSTALLATION_ID}`
  );
  // Numeric-string ids (env / spec strings) coerce the same way.
  assert.equal(
    await resolveRepoToken({
      installationId: String(INSTALLATION_ID),
      staticToken: "gh",
      appAuth,
    }),
    `installation-${INSTALLATION_ID}`
  );
});

test("resolveRepoToken falls back to the static token, then to null", async () => {
  const appAuth = { getInstallationToken: async (id) => `installation-${id}` };
  assert.equal(
    await resolveRepoToken({ installationId: null, staticToken: "gh", appAuth }),
    "gh"
  );
  assert.equal(
    await resolveRepoToken({
      installationId: INSTALLATION_ID,
      staticToken: "gh",
      appAuth: null,
    }),
    "gh"
  );
  assert.equal(
    await resolveRepoToken({ installationId: null, staticToken: "", appAuth: null }),
    null
  );
  assert.equal(await resolveRepoToken({}), null);
});

test("parseRepoList parses the owner/repo@installationId spec shape", () => {
  assert.deepEqual(
    parseRepoList("saiidz/upcomingsounds-private@179351888, saiidz/solvelang"),
    [
      {
        owner: "saiidz",
        repo: "upcomingsounds-private",
        fullName: "saiidz/upcomingsounds-private",
        installationId: 179351888,
      },
      {
        owner: "saiidz",
        repo: "solvelang",
        fullName: "saiidz/solvelang",
        installationId: null,
      },
    ]
  );
  assert.deepEqual(parseRepoList(""), []);
});

test("queue read for an installation-bound repo uses the installation token", async () => {
  const store = createMemoryStore();
  await store.putItem({
    PK: tenantPk("saiidz-pilot"),
    SK: repoSk("saiidz/upcomingsounds-private"),
    tenantId: "saiidz-pilot",
    repo: "saiidz/upcomingsounds-private",
    installationId: INSTALLATION_ID,
    paused: false,
    killSwitch: false,
    rulesVersion: "pilot-0",
  });

  const seen = { mint: 0, pullsAuth: null };
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("/app/installations/")) {
      seen.mint += 1;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: "ghs_installation_token",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      };
    }
    if (url.endsWith("/pulls?state=open&per_page=100")) {
      seen.pullsAuth = options.headers?.authorization;
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes("/repos/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          full_name: "saiidz/upcomingsounds-private",
          default_branch: "main",
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const handler = createHandler({
    store,
    config: {
      tableName: "t",
      githubToken: "",
      githubAppId: APP_ID,
      githubAppPrivateKey: PRIVATE_PEM,
      adminToken: "admin-secret",
      webhookSecret: "",
      webhookQueueUrl: "",
      pilotTenantId: "",
      pilotRepos: [],
      rulesVersion: "pilot-0",
    },
    fetchImpl,
  });

  const res = await handler({
    rawPath: "/tenants/saiidz-pilot/queue",
    requestContext: {
      http: { method: "GET", path: "/tenants/saiidz-pilot/queue" },
    },
    pathParameters: { tenantId: "saiidz-pilot" },
    queryStringParameters: {
      owner: "saiidz",
      repo: "upcomingsounds-private",
    },
    headers: { "x-admin-token": "admin-secret" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(seen.mint, 1);
  assert.equal(seen.pullsAuth, "Bearer ghs_installation_token");
  const body = JSON.parse(res.body);
  assert.equal(body.repo, "saiidz/upcomingsounds-private");
  assert.equal(body.summary.openPrs, 0);
});
