import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_COOKIE,
  createAdminConsoleGateway,
  createSessionCodec,
  verifyAdminPassword,
} from "../src/gateway.js";

const password = "correct horse battery staple";
const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const passwordHash = `${salt.toString("hex")}:${scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
const upstreamSecret = "upstream-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const sessionSecret = "session-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const origin = "https://admin.solve-lang.com";
const upstreamBase = "https://api.example.execute-api.us-east-2.amazonaws.com";
const accountId = "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function event(method, path, { body, headers = {}, cookies, query, sourceIp = "203.0.113.5" } = {}) {
  return {
    rawPath: `/admin-gateway${path}`,
    headers: { origin, ...headers },
    cookies,
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp } },
  };
}

function cookieToken(response) {
  const cookie = response.cookies?.[0];
  assert.ok(cookie?.startsWith(`${ADMIN_COOKIE}=`));
  return cookie.split(";")[0].slice(`${ADMIN_COOKIE}=`.length);
}

function app(overrides = {}) {
  return createAdminConsoleGateway({
    upstreamBase,
    upstreamSecret,
    adminOrigin: origin,
    passwordHash,
    sessionSecret,
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 7),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    logger: { warn() {}, error() {} },
    ...overrides,
  });
}

test("password verifier uses the reviewed scrypt hash shape and rejects malformed input", () => {
  assert.equal(verifyAdminPassword(password, passwordHash), true);
  assert.equal(verifyAdminPassword("wrong password value", passwordHash), false);
  assert.equal(verifyAdminPassword(password, "broken"), false);
});

test("signed sessions reject tampering and expiry", () => {
  let now = 1_800_000_000_000;
  const codec = createSessionCodec(sessionSecret, { now: () => now, random: (size) => Buffer.alloc(size, 3) });
  const token = codec.issue();
  assert.equal(codec.read(token)?.v, 1);
  assert.equal(codec.read(`${token}x`), null);
  now += 9 * 60 * 60 * 1000;
  assert.equal(codec.read(token), null);
});

test("login returns only a signed HttpOnly session and never exposes the upstream admin secret", async () => {
  const application = app();
  const denied = await application(event("POST", "/session/login", { body: { password: "incorrect-password" } }));
  assert.equal(denied.statusCode, 401);
  assert.doesNotMatch(denied.body, /upstream-secret/);

  const accepted = await application(event("POST", "/session/login", { body: { password } }));
  assert.equal(accepted.statusCode, 200);
  assert.match(accepted.cookies[0], /HttpOnly/);
  assert.match(accepted.cookies[0], /Secure/);
  assert.match(accepted.cookies[0], /SameSite=Strict/);
  assert.doesNotMatch(accepted.body, /upstream-secret|session-secret/);
  const payload = JSON.parse(accepted.body);
  assert.equal(payload.authenticated, true);
  assert.equal(typeof payload.csrfToken, "string");
});

test("proxy is session-bound, exact-origin protected, CSRF protected, and injects the upstream secret server-side only", async () => {
  const calls = [];
  const application = app({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ profile: { accountId } }), { status: 200 });
    },
  });
  const login = await application(event("POST", "/session/login", { body: { password } }));
  const token = cookieToken(login);
  const csrf = JSON.parse(login.body).csrfToken;

  const noCsrf = await application(event("POST", "/crm/profile", { cookies: [`${ADMIN_COOKIE}=${token}`], body: { identity: { accountId }, profile: {} } }));
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(calls.length, 0);

  const ok = await application(event("POST", "/crm/profile", {
    cookies: [`${ADMIN_COOKIE}=${token}`],
    headers: { "x-solvelang-csrf": csrf },
    body: { identity: { accountId }, profile: { stage: "active" } },
  }));
  assert.equal(ok.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-solvelang-admin-secret"], upstreamSecret);
  assert.doesNotMatch(ok.body, new RegExp(upstreamSecret));

  const wrongOrigin = await application({ ...event("GET", "/customers"), headers: { origin: "https://evil.example" }, cookies: [`${ADMIN_COOKIE}=${token}`] });
  assert.equal(wrongOrigin.statusCode, 403);
});

test("irreversible termination requires exact server-side confirmation and strips it before upstream forwarding", async () => {
  const calls = [];
  const application = app({ fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return new Response("{}", { status: 200 }); } });
  const login = await application(event("POST", "/session/login", { body: { password } }));
  const token = cookieToken(login);
  const csrf = JSON.parse(login.body).csrfToken;
  const headers = { "x-solvelang-csrf": csrf };
  const cookies = [`${ADMIN_COOKIE}=${token}`];
  const mutation = { accountId, state: "terminated", reason: "confirmed violation", requestId: "terminate-12345678" };

  const denied = await application(event("POST", "/account-access", { cookies, headers, body: { ...mutation, confirmation: "TERMINATE wrong" } }));
  assert.equal(denied.statusCode, 400);
  assert.equal(JSON.parse(denied.body).code, "termination_confirmation_required");
  assert.equal(calls.length, 0);

  const allowed = await application(event("POST", "/account-access", { cookies, headers, body: { ...mutation, confirmation: `TERMINATE ${accountId}` } }));
  assert.equal(allowed.statusCode, 200);
  assert.equal(calls.length, 1);
  const forwarded = JSON.parse(calls[0].options.body);
  assert.equal(forwarded.state, "terminated");
  assert.equal(forwarded.accountId, accountId);
  assert.equal("confirmation" in forwarded, false);
});

test("gateway exposes only the reviewed upstream route allowlist", async () => {
  const calls = [];
  const application = app({ fetchImpl: async (url) => { calls.push(String(url)); return new Response("{}", { status: 200 }); } });
  const login = await application(event("POST", "/session/login", { body: { password } }));
  const token = cookieToken(login);
  const cookies = [`${ADMIN_COOKIE}=${token}`];

  await application(event("GET", "/customers", { cookies, query: { email: "owner@example.com", ignored: "secret" } }));
  assert.match(calls[0], /\/internal\/admin\/customers\?email=owner%40example.com$/);
  assert.doesNotMatch(calls[0], /ignored/);

  const unknown = await application(event("GET", "/proxy-anything", { cookies }));
  assert.equal(unknown.statusCode, 404);
});

test("SAM contract is opt-in and never puts the upstream secret into a browser/static parameter", async () => {
  const template = await readFile(new URL("../template.yaml", import.meta.url), "utf8");
  assert.match(template, /AdminConsoleGatewayEnabled:/);
  assert.match(template, /Default: "false"/);
  assert.match(template, /UpstreamAdminSecret:\n    Type: String\n    NoEcho: true/);
  assert.match(template, /AdminPasswordScrypt:\n    Type: String\n    NoEcho: true/);
  assert.match(template, /AdminSessionSecret:\n    Type: String\n    NoEcho: true/);
  assert.doesNotMatch(template, /NEXT_PUBLIC|Output.*Secret|Value:.*UpstreamAdminSecret/);
});
