import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePostHogFlags } from "./selfDrivingPosthogFlagSanitizer";
import { executePostHogReadPipeline } from "./selfDrivingPosthogReadPipeline";
import { planPostHogReadRequest } from "./selfDrivingPosthogRequestPlanner";

const flag = {
  id: 42, active: true, deleted: false, archived: false, version: 3,
  updated_at: "2026-09-05T01:00:00Z", created_at: "2026-09-01T00:00:00Z",
  key: "private-customer-key", name: "private@example.test",
  filters: { groups: [{ properties: [{ key: "email", value: "target@example.test" }] }], payloads: { true: "secret-payload" } },
  created_by: { email: "owner@example.test" }, last_modified_by: { id: 17 },
  tags: ["customer-secret"], bucketing_identifier: "person-secret",
};
const page = () => ({ count: 1, next: null, previous: null, results: [{ ...flag }] });
const input = (json: unknown) => ({ operation: "read-feature-flags", project: "42", requestId: "phr_0123456789abcdef", json });
const privateValues = [flag.key, flag.name, "target@example.test", "secret-payload", "owner@example.test", "customer-secret", "person-secret"];

test("flag sanitizer retains only deterministic structural lifecycle evidence", () => {
  const result = sanitizePostHogFlags(input(page()));
  assert.deepEqual(result, sanitizePostHogFlags(input(page())));
  assert.deepEqual(result.records, [{ kind: "feature-flag", locator: "flag:42", observedAt: "2026-09-05T01:00:00.000Z", summary: "PostHog feature-flag configuration evidence.", dimensions: { active: true, deleted: false, archived: false, version: 3 }, sanitized: true }]);
  for (const value of privateValues) assert.equal(JSON.stringify(result).includes(value), false);
});

test("flag sanitizer preserves partial collection counts but no pagination URL", () => {
  const result = sanitizePostHogFlags(input({ ...page(), count: 4, next: "https://private.invalid/?secret=next" }));
  assert.equal(result.source.coverage, "partial");
  assert.deepEqual(result.source.skipped, [{ reason: "export-truncated", count: 3 }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(sanitizePostHogFlags(input({ count: 0, next: null, previous: null, results: [] })).records, []);
});

test("unknown identity and mutation fields fail with privacy-safe diagnostics", () => {
  for (const key of ["distinct_id", "person_id", "email", "ip", "cookies", "headers", "token", "write", "raw_secret"]) {
    assert.throws(() => sanitizePostHogFlags(input({ ...page(), results: [{ ...flag, [key]: "private-value" }] })), error => {
      assert.equal((error as Error).message, "PostHog feature-flag response does not satisfy the safe sanitizer contract.");
      return true;
    });
  }
});

test("flag sanitizer rejects malformed capabilities, calendar overflow and record bounds", () => {
  for (const patch of [{ id: -1 }, { id: "42" }, { id: Number.MAX_SAFE_INTEGER + 1 }, { active: "true" }, { deleted: 0 }, { archived: null }, { version: -1 }, { updated_at: "2026-02-30T00:00:00Z" }, { updated_at: null }]) {
    assert.throws(() => sanitizePostHogFlags(input({ ...page(), results: [{ ...flag, ...patch }] })));
  }
  for (const value of [null, {}, { ...page(), count: 0 }, { ...page(), previous: "older" }, { ...page(), count: 101, results: Array(101).fill(flag) }, { ...page(), results: Array(1) }]) assert.throws(() => sanitizePostHogFlags(input(value)));
  assert.throws(() => sanitizePostHogFlags({ ...input(page()), operation: "read-errors" }));
  const hostile = { ...flag };
  Object.defineProperty(hostile, "filters", { get() { assert.fail("must not invoke getter"); } });
  assert.throws(() => sanitizePostHogFlags(input({ ...page(), results: [hostile] })));
});

test("concrete flag sanitizer composes with read-only Context without synthetic performance metrics", async () => {
  const plan = planPostHogReadRequest({ origin: "https://us.posthog.com", operation: "read-feature-flags", project: "42", pageSize: 50 });
  const result = await executePostHogReadPipeline(plan,
    async () => ({ authorization: "Bearer fixture_readonly_token_123456" }),
    async request => ({ status: 200, contentType: "application/json", finalUrl: request.url, body: JSON.stringify(page()) }),
    sanitizePostHogFlags);
  assert.equal(result.context.signals.length, 1);
  assert.equal(result.context.signals[0].kind, "feature-flag");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.policy.causalityInference, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.inbox.items.length, 0);
  for (const value of [...privateValues, "fixture_readonly_token_123456"]) assert.equal(JSON.stringify(result).includes(value), false);
});
