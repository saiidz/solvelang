import assert from "node:assert/strict";
import test from "node:test";
import {
  planPostHogReadRequest,
  postHogRequestPlanUrl,
} from "./selfDrivingPosthogRequestPlanner";

const base = {
  origin: "https://us.posthog.com",
  operation: "read-events",
  project: "12345",
  pageSize: 50,
} as const;

test("planner creates deterministic GET-only US cloud requests", () => {
  const first = planPostHogReadRequest(base);
  const second = planPostHogReadRequest(base);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.self-driving.posthog-request-plan.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.request.method, "GET");
  assert.equal(first.request.origin, "https://us.posthog.com");
  assert.equal(first.request.pathname, "/api/projects/12345/events");
  assert.deepEqual(first.request.query, { limit: "50" });
  assert.match(first.request.id, /^phr_[a-f0-9]{16}$/);
  assert.equal(postHogRequestPlanUrl(first), "https://us.posthog.com/api/projects/12345/events?limit=50");
  assert.equal(first.policy.requestBodyAllowed, false);
  assert.equal(first.policy.authorizationMaterialIncluded, false);
  assert.equal(first.policy.externalSideEffects, false);
});

test("planner supports EU cloud origin and bounded opaque cursor", () => {
  const plan = planPostHogReadRequest({
    ...base,
    origin: "https://eu.posthog.com",
    operation: "read-feature-flags",
    cursor: "cursor_ABC-123:next",
  });

  assert.equal(plan.request.origin, "https://eu.posthog.com");
  assert.equal(plan.request.pathname, "/api/projects/12345/feature_flags");
  assert.deepEqual(plan.request.query, { limit: "50", cursor: "cursor_ABC-123:next" });
  assert.equal(
    postHogRequestPlanUrl(plan),
    "https://eu.posthog.com/api/projects/12345/feature_flags?cursor=cursor_ABC-123%3Anext&limit=50",
  );
});

test("self-hosted origins require explicit opt-in and strict HTTPS DNS hostname", () => {
  assert.throws(
    () => planPostHogReadRequest({ ...base, origin: "https://posthog.example.com" }),
    /not an allowlisted cloud origin/,
  );

  const plan = planPostHogReadRequest({
    ...base,
    origin: "https://analytics.example.com",
    allowSelfHostedOrigin: true,
  });
  assert.equal(plan.request.origin, "https://analytics.example.com");

  for (const origin of [
    "http://analytics.example.com",
    "https://user:pass@analytics.example.com",
    "https://analytics.example.com/path",
    "https://analytics.example.com?x=1",
    "https://analytics.example.com#frag",
    "https://192.0.2.1",
    "https://[2001:db8::1]",
    "https://localhost",
  ]) {
    assert.throws(
      () => planPostHogReadRequest({ ...base, origin, allowSelfHostedOrigin: true }),
      /HTTPS|userinfo|path|query|string|fragment|DNS hostname|IP literal|valid DNS hostname/,
    );
  }
});

test("planner rejects operations outside the PostHog read allowlist", () => {
  for (const operation of ["delete-events", "read-persons", "update-feature-flags", "deploy"] as const) {
    assert.throws(
      () => planPostHogReadRequest({ ...base, operation }),
      /not allowlisted/,
    );
  }
});

test("planner rejects project/path escape attempts", () => {
  for (const project of ["../admin", "123/flags", "", "a?b", "a#b", "a b"]) {
    assert.throws(
      () => planPostHogReadRequest({ ...base, project }),
      /project/,
    );
  }
});

test("planner rejects cursor URL, query, and traversal syntax", () => {
  for (const cursor of [
    "https://evil.example/next",
    "../next",
    "/api/next",
    "next?host=evil.example",
    "next#fragment",
  ]) {
    assert.throws(
      () => planPostHogReadRequest({ ...base, cursor }),
      /cursor/,
    );
  }
});

test("planner enforces page-size bounds", () => {
  for (const pageSize of [0, -1, 101, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => planPostHogReadRequest({ ...base, pageSize }),
      /pageSize/,
    );
  }
});

test("durable request plan contains no credential or authorization fields", () => {
  const plan = planPostHogReadRequest(base);
  const serialized = JSON.stringify(plan).toLowerCase();

  assert.equal(serialized.includes("credential"), false);
  assert.equal(serialized.includes("authorization"), true);
  assert.equal(plan.policy.authorizationMaterialIncluded, false);
  assert.equal(serialized.includes("api_key"), false);
  assert.equal(serialized.includes("bearer"), false);
});
