import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createEntitlementService, type EntitlementStore, type StripeGateway } from "../src/service.js";

const forbidden = [
  "Secret workflow name",
  "nodeParameters",
  "credential-reference",
  "sk_test_do_not_log",
  "whsec_do_not_log",
  "entitlement-signing-do-not-log",
  "raw-webhook-payload-do-not-log",
];

function event(path: string, body: string, signature?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: signature ? { "stripe-signature": signature } : {},
    requestContext: {
      accountId: "test", apiId: "test", domainName: "test.invalid", domainPrefix: "test",
      http: { method: "POST", path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "node-test" },
      requestId: "request-test", routeKey: `POST ${path}`, stage: "$default", time: "test", timeEpoch: 0,
    },
    body,
    isBase64Encoded: false,
  };
}

function fixture() {
  const output: string[] = [];
  const serialize = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
  const stripe: StripeGateway = {
    payments: {
      async create() { throw new Error(forbidden.join(" | ")); },
      async retrieve() { throw new Error(forbidden.join(" | ")); },
    },
    webhooks: {
      constructEvent() { throw new Error(forbidden.join(" | ")); },
    },
  };
  const store: EntitlementStore = {
    async putIfAbsent() { throw new Error(forbidden.join(" | ")); },
    async get() { throw new Error(forbidden.join(" | ")); },
  };
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripePriceId: "price_test",
      stripeWebhookSecret: "whsec_do_not_log",
      entitlementSigningSecret: "entitlement-signing-do-not-log-32-bytes",
      mode: "test",
    },
    stripe,
    store,
    now: () => 0,
    logger: {
      info: (...values) => output.push(values.map(serialize).join(" ")),
      error: (...values) => output.push(values.map(serialize).join(" ")),
    },
  });
  return { service, output };
}

test("workflow and secret material never reaches client errors or structured logs", async () => {
  const cases = [
    { request: event("/checkout", JSON.stringify({ scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875", workflow: forbidden })), status: 400 },
    { request: event("/checkout", JSON.stringify({ scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875" })), status: 502 },
    { request: event("/webhook", `{"raw":"${forbidden.join("-")}"}`, "invalid"), status: 400 },
    { request: event("/entitlement", JSON.stringify({ scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875", sessionId: "pi_test_private", workflow: forbidden })), status: 400 },
    { request: event("/entitlement", JSON.stringify({ scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875", sessionId: "pi_test_private" })), status: 500 },
  ];

  for (const { request, status } of cases) {
    const { service, output } = fixture();
    const response = await service(request);
    assert.equal(response.statusCode, status);
    const observable = `${response.body ?? ""}\n${output.join("\n")}`;
    for (const value of forbidden) assert.equal(observable.includes(value), false, `leaked ${value}`);
  }
});

test("conversion logging accepts only allowlisted event names", async () => {
  const { service, output } = fixture();
  const payload = JSON.stringify({ name: "workflow_selected", workflow: forbidden });
  const response = await service(event("/events", payload));
  assert.equal(response.statusCode, 202);
  assert.equal(output.length, 1);
  assert.match(output[0], /conversion_event/);
  assert.match(output[0], /workflow_selected/);
  for (const value of forbidden) assert.equal(output[0].includes(value), false, `logged ${value}`);
});
