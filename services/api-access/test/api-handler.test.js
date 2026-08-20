import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { ApiAccessError } from "../src/service.js";

const adminSecret = "a".repeat(64);

function event(method, rawPath, body, headers = {}) {
  return {
    rawPath,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "203.0.113.8" } },
  };
}

const service = {
  provisionSubscription: async (body) => ({ ...body, normalized: true }),
  issueApiKey: async () => ({ apiKey: "sl_test_once", env: "SOLVELANG_API_KEY=sl_test_once\n" }),
  revokeApiKey: async ({ keyId }) => ({ keyId, revokedAt: "2026-07-28T12:00:00.000Z" }),
  consumeUsage: async () => ({ used: 1, limit: 1_000, remaining: 999 }),
  getSubscriptionAccount: async () => undefined,
};

test("health remains available while all subscription mutations fail closed", async () => {
  const handler = createApiAccessHandler({
    service,
    enabled: false,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error() {} },
  });
  const health = await handler(event("GET", "/health"));
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), {
    status: "ok",
    service: "solvelang-api-access",
    enabled: false,
    customerAccountsEnabled: false,
    customerTotpEnabled: false,
    subscriptionBillingEnabled: false,
  });

  const denied = await handler(event("POST", "/internal/keys", { accountId: "acct_1" }, {
    "x-solvelang-admin-secret": adminSecret,
  }));
  assert.equal(denied.statusCode, 503);
  assert.equal(JSON.parse(denied.body).code, "api_access_disabled");
  const webhook = await handler(event("POST", "/stripe/subscriptions/webhook", {}, { "stripe-signature": "test" }));
  assert.equal(webhook.statusCode, 503);
  assert.equal(JSON.parse(webhook.body).code, "subscription_billing_disabled");
});

test("handler refuses an impossible authenticator-without-customer-accounts state", () => {
  assert.throws(
    () => createApiAccessHandler({
      service,
      enabled: true,
      adminSecret,
      siteOrigin: "https://www.solve-lang.com",
      customerAccountsEnabled: false,
      customerTotpEnabled: true,
    }),
    /Authenticator 2FA cannot be enabled when customer accounts are disabled/,
  );
});

test("internal routes require a constant-time admin secret and return the plaintext key only on issuance", async () => {
  const logs = [];
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error(record) { logs.push(record); } },
  });
  const denied = await handler(event("POST", "/internal/keys", {}, { "x-solvelang-admin-secret": "wrong" }));
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.ok(!JSON.stringify(logs).includes("wrong"));

  const issued = await handler(event("POST", "/internal/keys", { accountId: "acct_1", name: "Server" }, {
    "x-solvelang-admin-secret": adminSecret,
  }));
  assert.equal(issued.statusCode, 201);
  assert.equal(JSON.parse(issued.body).apiKey, "sl_test_once");
  assert.equal(issued.headers["cache-control"], "no-store");
  assert.equal(issued.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(issued.headers["referrer-policy"], "no-referrer");
  assert.equal(issued.headers["x-content-type-options"], "nosniff");
});

test("customer routes support password login, credential setup, cookies, ownership, and CSRF", async () => {
  const seen = [];
  const session = { accountId: "acct_session", email: "dev@example.com", csrfToken: "csrf_ok" };
  const sessionCookie = "sl_api_session=sess_test; Path=/; HttpOnly; Secure; SameSite=None; Partitioned";
  const logoutCookie = "sl_api_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0";
  const customerAuth = {
    requestMagicLink: async (body, context) => seen.push(["magic", body.email, context.sourceIp]),
    verifyMagicLink: async () => ({ ...session, cookie: sessionCookie }),
    loginWithPassword: async (body, context) => {
      seen.push(["password", body.identifier, body.password, context.sourceIp]);
      return { ...session, cookie: sessionCookie };
    },
    getProfile: async () => ({ username: "devuser", passwordConfigured: true }),
    setCredentials: async (authenticated, body) => {
      seen.push(["credentials", authenticated.accountId, body.username, body.password]);
      return { username: body.username, passwordConfigured: true };
    },
    authenticate: async (cookie) => {
      seen.push(["cookie", cookie]);
      return session;
    },
    assertCsrf: (_session, presented) => {
      if (presented !== session.csrfToken) {
        throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
      }
    },
    logout: async (cookie) => {
      seen.push(["logout-cookie", cookie]);
      return logoutCookie;
    },
  };
  const customerAccount = {
    getDashboard: async (authenticated) => ({
      accountId: authenticated.accountId,
      email: authenticated.email,
      subscription: { plan: null, status: "none" },
      usage: {},
      keys: [],
    }),
    issueKey: async (authenticated, body) => {
      seen.push(["issue", authenticated.accountId, body.accountId, body.name]);
      return { apiKey: "sl_test_once" };
    },
    revokeKey: async (authenticated, body) => ({ accountId: authenticated.accountId, keyId: body.keyId }),
  };
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount,
    logger: { error() {} },
  });

  const requested = await handler(event("POST", "/customer/auth/magic-link", { email: "dev@example.com" }));
  assert.equal(requested.statusCode, 202);
  assert.deepEqual(JSON.parse(requested.body), {
    accepted: true,
    message: "If the address is valid, a sign-in link will arrive shortly.",
  });
  assert.deepEqual(seen.find((entry) => entry[0] === "magic"), ["magic", "dev@example.com", "203.0.113.8"]);

  const verified = await handler(event("POST", "/customer/auth/verify", { token: "ml_test" }));
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.cookies, [sessionCookie]);
  assert.equal(verified.headers["set-cookie"], undefined);

  const password = await handler(event("POST", "/customer/auth/password", {
    identifier: "devuser",
    password: "secret-value",
  }));
  assert.equal(password.statusCode, 200);
  assert.deepEqual(password.cookies, [sessionCookie]);
  assert.deepEqual(
    seen.find((entry) => entry[0] === "password"),
    ["password", "devuser", "secret-value", "203.0.113.8"],
  );

  const dashboardEvent = event("GET", "/customer/account");
  dashboardEvent.cookies = ["sl_api_session=sess_test", "other=value"];
  const dashboard = await handler(dashboardEvent);
  assert.equal(dashboard.statusCode, 200);
  assert.equal(JSON.parse(dashboard.body).accountId, "acct_session");
  assert.deepEqual(JSON.parse(dashboard.body).auth, { username: "devuser", passwordConfigured: true });
  assert.equal(dashboard.headers["access-control-allow-credentials"], "true");
  assert.deepEqual(
    seen.find((entry) => entry[0] === "cookie"),
    ["cookie", "sl_api_session=sess_test; other=value"],
  );

  const credentialsEvent = event("POST", "/customer/auth/credentials", {
    username: "devuser",
    password: "new password value",
  }, { "x-solvelang-csrf": "csrf_ok" });
  credentialsEvent.cookies = ["sl_api_session=sess_test"];
  const credentials = await handler(credentialsEvent);
  assert.equal(credentials.statusCode, 200);
  assert.deepEqual(JSON.parse(credentials.body).auth, { username: "devuser", passwordConfigured: true });
  assert.deepEqual(
    seen.find((entry) => entry[0] === "credentials"),
    ["credentials", "acct_session", "devuser", "new password value"],
  );

  const deniedEvent = event("POST", "/customer/keys", { accountId: "acct_attacker", name: "Browser" });
  deniedEvent.cookies = ["sl_api_session=sess_test"];
  const denied = await handler(deniedEvent);
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "invalid_csrf");

  const issuedEvent = event("POST", "/customer/keys", { accountId: "acct_attacker", name: "Browser" }, {
    "x-solvelang-csrf": "csrf_ok",
  });
  issuedEvent.cookies = ["sl_api_session=sess_test"];
  const issued = await handler(issuedEvent);
  assert.equal(issued.statusCode, 201);
  assert.deepEqual(
    seen.find((entry) => entry[0] === "issue"),
    ["issue", "acct_session", "acct_attacker", "Browser"],
  );

  const logoutEvent = event("POST", "/customer/auth/logout", undefined, { "x-solvelang-csrf": "csrf_ok" });
  logoutEvent.cookies = ["sl_api_session=sess_test"];
  const loggedOut = await handler(logoutEvent);
  assert.equal(loggedOut.statusCode, 200);
  assert.deepEqual(loggedOut.cookies, [logoutCookie]);
  assert.deepEqual(
    seen.find((entry) => entry[0] === "logout-cookie"),
    ["logout-cookie", "sl_api_session=sess_test"],
  );
});

test("signed Stripe webhooks bypass admin auth but require signature verification", async () => {
  const seen = [];
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    subscriptionBillingEnabled: true,
    subscriptionCheckout: {
      createCheckout: async () => ({ sessionId: "cs_test_1", url: "https://checkout.stripe.test/1" }),
    },
    stripeGateway: {
      constructWebhookEvent(rawBody, signature) {
        seen.push([rawBody.toString("utf8"), signature]);
        if (signature === "bad") throw new Error("invalid signature with secret");
        return { id: "evt_1", type: "customer.subscription.updated", data: { object: {} } };
      },
    },
    subscriptionLifecycle: { processEvent: async () => ({ handled: true, duplicate: false }) },
    logger: { error() {} },
  });
  const accepted = await handler(event("POST", "/stripe/subscriptions/webhook", { hello: "world" }, {
    "stripe-signature": "valid",
  }));
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(JSON.parse(accepted.body), { received: true, handled: true, duplicate: false });
  assert.deepEqual(seen[0], [JSON.stringify({ hello: "world" }), "valid"]);

  const rejected = await handler(event("POST", "/stripe/subscriptions/webhook", {}, { "stripe-signature": "bad" }));
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).code, "invalid_webhook_signature");
  assert.ok(!rejected.body.includes("secret"));
});

test("subscription Checkout remains admin-protected", async () => {
  const checkout = {
    createCheckout: async (body) => ({ sessionId: "cs_test_1", url: `https://checkout.example/${body.plan}` }),
  };
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    subscriptionBillingEnabled: true,
    subscriptionCheckout: checkout,
    stripeGateway: { constructWebhookEvent() {} },
    subscriptionLifecycle: { processEvent() {} },
    logger: { error() {} },
  });
  const denied = await handler(event("POST", "/internal/subscriptions/checkout", { plan: "pro" }));
  assert.equal(denied.statusCode, 403);
  const accepted = await handler(event("POST", "/internal/subscriptions/checkout", { plan: "pro" }, {
    "x-solvelang-admin-secret": adminSecret,
  }));
  assert.equal(accepted.statusCode, 201);
  assert.equal(JSON.parse(accepted.body).sessionId, "cs_test_1");
});

test("protected identity output uses only authorizer context", async () => {
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error() {} },
  });
  const identityEvent = event("GET", "/v1/whoami");
  identityEvent.requestContext.authorizer = {
    lambda: {
      accountId: "acct_1",
      keyId: "key_1",
      plan: "pro",
      scopes: "repository:audit",
      subscriptionStatus: "active",
      usageRemaining: 9_999,
      secret: "must-not-leak",
    },
  };
  const response = await handler(identityEvent);
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(body, {
    accountId: "acct_1",
    keyId: "key_1",
    plan: "pro",
    scopes: ["repository:audit"],
    subscriptionStatus: "active",
    usageRemaining: 9_999,
  });
  assert.ok(!response.body.includes("must-not-leak"));
});

test("invalid JSON and unknown routes return sanitized errors", async () => {
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error() {} },
  });
  const malformed = event("POST", "/internal/keys", undefined, { "x-solvelang-admin-secret": adminSecret });
  malformed.body = "{";
  const invalid = await handler(malformed);
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(JSON.parse(invalid.body), { error: "Invalid request.", code: "invalid_request" });

  const missing = await handler(event("POST", "/internal/missing", {}, {
    "x-solvelang-admin-secret": adminSecret,
  }));
  assert.equal(missing.statusCode, 404);
});
