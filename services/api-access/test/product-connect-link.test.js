import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import {
  PRODUCT_CONNECT_STATE_TTL_MS,
  createProductConnectLinkService,
  mintProductConnectState,
} from "../src/product-connect-link.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "a".repeat(40);
const BINDING_SECRET = "product-binding-secret-for-tests-0123456789";
const ACCOUNT_ID = "acct_session";
const NOW = Date.now();

// Mirrors the real gate in customer-auth.js, like the connect fixture:
// authenticate() throws 401 invalid_session when the session cookie is
// missing, invalid, or expired.
function gateFixture({ authenticated = true, productConnectLink } = {}) {
  const customerAuth = {
    async authenticate() {
      if (!authenticated) throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
      return { accountId: ACCOUNT_ID, email: "owner@example.com", csrfToken: "csrf_session" };
    },
    assertCsrf(session, presented) {
      if (presented !== session.csrfToken) throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    },
  };
  const handler = createApiAccessHandler({
    service: {},
    enabled: true,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    productConnectLink,
    logger: { error() {} },
  });
  return { handler };
}

function configuredLink() {
  return createProductConnectLinkService({
    bindingSecret: BINDING_SECRET,
    slug: "solvelang-process-solution",
    now: () => NOW,
  });
}

function getEvent(path) {
  return {
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: path,
    headers: { cookie: "sl_api_session=session" },
    queryStringParameters: {},
  };
}

function decodeState(state) {
  const [payloadPart, signature] = state.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  return { payloadPart, signature, payload };
}

function expectedSignature(payloadPart, secret = BINDING_SECRET) {
  return createHmac("sha256", secret).update(payloadPart).digest("hex");
}

test("signed-in customer gets a connect link whose state verifies", async () => {
  const { handler } = gateFixture({ productConnectLink: configuredLink() });
  const response = await handler(getEvent("/customer/github/connect-link"));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(Object.keys(body), ["installUrl"]);
  const url = new URL(body.installUrl);
  assert.equal(url.origin + url.pathname, "https://github.com/apps/solvelang-process-solution/installations/new");
  const { payloadPart, signature, payload } = decodeState(url.searchParams.get("state"));
  // The state is verifiable with the binding secret alone.
  assert.equal(signature, expectedSignature(payloadPart));
  assert.match(signature, /^[a-f0-9]{64}$/);
  // The tenant is the session's own account id, and the expiry is
  // ~10 minutes out (exactly the TTL from the minting instant).
  assert.equal(payload.tenantId, ACCOUNT_ID);
  assert.equal(payload.exp, NOW + PRODUCT_CONNECT_STATE_TTL_MS);
  assert.ok(Math.abs(payload.exp - 600_000 - Date.now()) < 60_000, "exp is roughly ten minutes from now");
});

test("state is minted server-side only: callers cannot set tenant or expiry", () => {
  // Extra caller-supplied fields are ignored by both the service and
  // the minter: the tenant comes from the caller's session argument
  // and the expiry is always the server-side TTL.
  const link = configuredLink();
  const { installUrl } = link.createConnectLink(ACCOUNT_ID, { tenantId: "acct_someone_else", exp: 0 });
  const forged = decodeState(new URL(installUrl).searchParams.get("state"));
  assert.equal(forged.payload.tenantId, ACCOUNT_ID);
  assert.equal(forged.payload.exp, NOW + PRODUCT_CONNECT_STATE_TTL_MS);
  const minted = decodeState(
    mintProductConnectState({ tenantId: ACCOUNT_ID, bindingSecret: BINDING_SECRET, now: () => NOW, exp: 0, state: "preset" }),
  );
  assert.equal(minted.payload.exp, NOW + PRODUCT_CONNECT_STATE_TTL_MS);
});

test("tampered or expired states do not verify", () => {
  const fresh = mintProductConnectState({ tenantId: ACCOUNT_ID, bindingSecret: BINDING_SECRET, now: () => NOW });
  const { payloadPart, signature, payload } = decodeState(fresh);
  assert.equal(signature, expectedSignature(payloadPart));
  assert.ok(payload.exp > Date.now(), "a freshly minted state is unexpired");
  // Tampering with the payload (a different tenant, a later expiry)
  // breaks the signature, so the receiving side rejects it.
  const tamperedPart = Buffer.from(
    JSON.stringify({ tenantId: "acct_someone_else", exp: payload.exp + 3_600_000 }),
    "utf8",
  ).toString("base64url");
  assert.notEqual(expectedSignature(tamperedPart), signature);
  // A signature made with the wrong secret never verifies either.
  assert.notEqual(expectedSignature(payloadPart, "some-other-secret"), signature);
  // An expired state is simply one whose exp is in the past: minting
  // always adds the full TTL, so only an old state can ever be expired.
  const stale = decodeState(
    mintProductConnectState({
      tenantId: ACCOUNT_ID,
      bindingSecret: BINDING_SECRET,
      now: () => NOW - PRODUCT_CONNECT_STATE_TTL_MS - 1_000,
    }),
  );
  assert.ok(stale.payload.exp < Date.now(), "a state minted over ten minutes ago is expired");
  assert.equal(stale.signature, expectedSignature(stale.payloadPart), "expiry is checked on a verified payload");
});

test("connect-link rejects signed-out callers with 401, like its sibling routes", async () => {
  const { handler } = gateFixture({ authenticated: false, productConnectLink: configuredLink() });
  const response = await handler(getEvent("/customer/github/connect-link"));
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "invalid_session");
  const sibling = await handler(getEvent("/customer/github/installations"));
  assert.equal(sibling.statusCode, 401);
  assert.equal(JSON.parse(sibling.body).code, "invalid_session");
});

test("connect-link answers a plain 503 while the binding secret is unset", async () => {
  const { handler } = gateFixture({ productConnectLink: undefined });
  const response = await handler(getEvent("/customer/github/connect-link"));
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "connect_not_configured" });
});

test("the minter and the service fail closed on missing configuration", () => {
  assert.throws(() => mintProductConnectState({ tenantId: ACCOUNT_ID }), /binding secret is required/);
  assert.throws(() => mintProductConnectState({ bindingSecret: BINDING_SECRET }), /account id is required/);
  assert.throws(() => createProductConnectLinkService({ slug: "solvelang-process-solution" }), /binding secret/);
  assert.throws(() => createProductConnectLinkService({ bindingSecret: BINDING_SECRET }), /product app slug/);
});

test("config keeps the connect link dark unless the binding secret is set", () => {
  const baseEnv = {
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(40),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idem",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_ACCESS_ADMIN_SECRET: ADMIN_SECRET,
  };
  const unset = parseApiAccessEnvironment({ ...baseEnv });
  assert.equal(unset.productConnect.enabled, false);
  assert.equal(unset.productConnect.bindingSecret, undefined);
  assert.equal(unset.productConnect.slug, "solvelang-process-solution");
  const full = parseApiAccessEnvironment({ ...baseEnv, PRODUCT_BINDING_SECRET: BINDING_SECRET });
  assert.equal(full.productConnect.enabled, true);
  assert.equal(full.productConnect.bindingSecret, BINDING_SECRET);
  const overridden = parseApiAccessEnvironment({
    ...baseEnv,
    PRODUCT_BINDING_SECRET: BINDING_SECRET,
    PRODUCT_APP_SLUG: "solvelang-process-solution-dev",
  });
  assert.equal(overridden.productConnect.slug, "solvelang-process-solution-dev");
});

test("the gateway template wires the connect-link route", async () => {
  const template = await readFile(new URL("../template.yaml", import.meta.url), "utf8");
  assert.match(template, /Path: \/customer\/github\/connect-link/);
  assert.match(template, /PRODUCT_BINDING_SECRET: !Ref ProductBindingSecret/);
  assert.match(template, /PRODUCT_APP_SLUG: !Ref ProductAppSlug/);
});
