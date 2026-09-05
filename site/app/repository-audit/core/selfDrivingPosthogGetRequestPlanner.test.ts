import assert from "node:assert/strict";
import test from "node:test";
import {
  createPostHogGetRequestPlan,
  type PostHogGetRequestPlanInput,
} from "./selfDrivingPosthogGetRequestPlanner";

function input(overrides: Partial<PostHogGetRequestPlanInput> = {}): PostHogGetRequestPlanInput {
  return {
    operation: "read-events",
    tenant: "project:123",
    pageSize: 50,
    origin: { kind: "cloud", region: "us" },
    ...overrides,
  };
}

test("planner emits deterministic redacted US-cloud GET metadata without executing anything", () => {
  const first = createPostHogGetRequestPlan(input());
  const second = createPostHogGetRequestPlan(input());

  assert.equal(first.schema, "solvelang.self-driving.posthog-get-request.v0");
  assert.equal(first.mode, "analyze-only");
  assert.match(first.id, /^posthog_get_[0-9a-f]{16}$/);
  assert.equal(first.id, second.id);
  assert.equal(first.source.origin, "https://us.posthog.com");
  assert.equal(first.request.origin, "https://us.posthog.com");
  assert.equal(first.request.path, "/api/projects/123/events");
  assert.equal(first.request.method, "GET");
  assert.equal(first.request.body, null);
  assert.deepEqual(first.request.query, { limit: 50 });
  assert.equal(first.execution.status, "not-executed");
  assert.equal(first.execution.networkRequests, 0);
  assert.equal(first.execution.credentialResolutions, 0);
  assert.equal(first.execution.authorizationCallbacksInvoked, 0);
  assert.equal(first.policy.headerInjectionDeferred, true);
  assert.equal(first.policy.networkAccess, false);
  assert.equal(first.policy.externalSideEffects, false);
  assert.equal(first.audit.redacted, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.request.query), true);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("credentialRef"), false);
  assert.equal(serialized.toLowerCase().includes("authorization"), true);
  assert.equal(serialized.includes("Bearer"), false);
});

test("planner renders every allowlisted PostHog read path for US and EU cloud origins", () => {
  const cases = [
    ["read-events", "/api/projects/42/events"],
    ["read-errors", "/api/projects/42/error_tracking/issues"],
    ["read-feature-flags", "/api/projects/42/feature_flags"],
  ] as const;

  for (const region of ["us", "eu"] as const) {
    for (const [operation, path] of cases) {
      const plan = createPostHogGetRequestPlan(input({
        operation,
        tenant: "project:42",
        origin: { kind: "cloud", region },
      }));
      assert.equal(plan.request.origin, `https://${region}.posthog.com`);
      assert.equal(plan.request.path, path);
      assert.equal(plan.request.method, "GET");
    }
  }
});

test("planner accepts strict HTTPS self-hosted DNS origins and canonicalizes the origin", () => {
  const plan = createPostHogGetRequestPlan(input({
    tenant: "project:7",
    origin: { kind: "self-hosted", origin: "https://posthog.analytics.example.com:8443/" },
  }));

  assert.equal(plan.source.originKind, "self-hosted");
  assert.equal(plan.source.origin, "https://posthog.analytics.example.com:8443");
  assert.equal(plan.request.origin, "https://posthog.analytics.example.com:8443");
  assert.equal(plan.request.path, "/api/projects/7/events");
});

test("planner rejects unsafe self-hosted origins before any request can exist", () => {
  const rejectedOrigins = [
    "http://posthog.example.com",
    "https://user:password@posthog.example.com",
    "https://posthog.example.com/?next=1",
    "https://posthog.example.com/#fragment",
    "https://127.0.0.1",
    "https://[::1]",
    "https://posthog.example.com/application",
    "https://posthog.example.com/%2e%2e/",
    "https://localhost",
  ];

  for (const origin of rejectedOrigins) {
    assert.throws(
      () => createPostHogGetRequestPlan(input({ origin: { kind: "self-hosted", origin } })),
      /HTTPS|userinfo|query|string|fragment|IP-literal|application path|traversal|DNS hostname/,
      origin,
    );
  }
});

test("planner accepts only the connector-owned operation and numeric tenant bindings", () => {
  assert.throws(
    () => createPostHogGetRequestPlan(input({ operation: "read-arbitrary" })),
    /not allowlisted/,
  );
  assert.throws(
    () => createPostHogGetRequestPlan(input({ operation: "delete-events" })),
    /not allowlisted/,
  );

  for (const tenant of ["project:0", "project:abc", "project:1/../../escape", "project:-1", "1"]) {
    assert.throws(
      () => createPostHogGetRequestPlan(input({ tenant })),
      /project:<id>|positive safe integer/,
      tenant,
    );
  }
});

test("planner converts only a same-origin same-path bounded connector pagination cursor", () => {
  const first = createPostHogGetRequestPlan(input());
  const next = createPostHogGetRequestPlan(input({ cursor: "?limit=50&offset=100" }));
  const repeated = createPostHogGetRequestPlan(input({ cursor: "?limit=50&offset=100" }));

  assert.deepEqual(first.request.query, { limit: 50 });
  assert.deepEqual(next.request.query, { limit: 50, offset: 100 });
  assert.equal(next.id, repeated.id);
  assert.equal(next.request.origin, first.request.origin);
  assert.equal(next.request.path, first.request.path);
});

test("planner rejects cursor attempts to change host, path, or pagination authority", () => {
  const rejected = [
    "https://evil.example/api/projects/123/events?limit=50&offset=50",
    "//evil.example/api/projects/123/events?limit=50&offset=50",
    "https://us.posthog.com/api/projects/999/events?limit=50&offset=50",
    "?limit=50&offset=50&host=evil.example",
    "?limit=50&limit=50&offset=50",
    "?limit=51&offset=102",
    "?limit=101&offset=100",
    "?limit=50&offset=51",
    "?limit=50&offset=1000",
    "?limit=50&offset=50#fragment",
    "/api/projects/123/%2e%2e/feature_flags?limit=50&offset=50",
  ];

  for (const cursor of rejected) {
    assert.throws(
      () => createPostHogGetRequestPlan(input({ cursor })),
      /cursor|origin|path|pagination|limit|offset|fragment|unsafe/,
      cursor,
    );
  }
});

test("planner rejects caller-supplied credential material or arbitrary extra fields", () => {
  const withCredential = {
    ...input(),
    credentialRef: "env:POSTHOG_API_KEY",
    authorization: "Bearer should-never-enter-planner",
  } as unknown as PostHogGetRequestPlanInput;

  assert.throws(
    () => createPostHogGetRequestPlan(withCredential),
    /unsupported fields/,
  );
});
