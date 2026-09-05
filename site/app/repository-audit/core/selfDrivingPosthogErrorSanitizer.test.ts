import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePostHogErrors } from "./selfDrivingPosthogErrorSanitizer";
import { adaptSanitizedPostHogExport } from "./selfDrivingPosthogExport";
import { executePostHogReadPipeline } from "./selfDrivingPosthogReadPipeline";
import { planPostHogReadRequest } from "./selfDrivingPosthogRequestPlanner";

const issue = {
  id: "17cc17c3-93c6-43a8-933a-14574b96e8da", status: "active", severity: null,
  first_seen: "2026-09-05T00:00:00Z", name: "private@example.test",
  description: "raw request secret", assignee: { id: 17, type: "user" },
  external_issues: [{ url: "https://private.invalid/customer" }], cohort: { id: 22, name: "customer group" },
};
const input = (json: unknown) => ({ operation: "read-errors", project: "42", requestId: "phr_0123456789abcdef", json });
const page = () => ({ count: 1, next: null, previous: null, results: [{ ...issue }] });

test("error sanitizer emits deterministic structural evidence with no raw content or identities", () => {
  const result = sanitizePostHogErrors(input(page()));
  assert.deepEqual(result, sanitizePostHogErrors(input(page())));
  assert.deepEqual(result.records, [{ kind: "error", locator: `issue:${issue.id}`, observedAt: "2026-09-05T00:00:00.000Z", summary: "PostHog tracked error issue.", dimensions: { status: "active" }, sanitized: true }]);
  const serialized = JSON.stringify(adaptSanitizedPostHogExport(result));
  for (const forbidden of [issue.name, issue.description, "private.invalid", "customer group", "assignee", "cohort"]) assert.equal(serialized.includes(forbidden), false);
});

test("error sanitizer preserves exact skipped cardinality without copying pagination links", () => {
  const result = sanitizePostHogErrors(input({ ...page(), count: 5, next: "https://private.invalid/?secret=omitted" }));
  assert.equal(result.source.coverage, "partial");
  assert.deepEqual(result.source.skipped, [{ reason: "export-truncated", count: 4 }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("unsafe and unknown fields fail with fixed diagnostics that cannot echo provider data", () => {
  for (const key of ["distinct_id", "person_id", "user_id", "email", "phone", "ip", "session_id", "recording_id", "replay", "headers", "cookies", "request", "response", "prompt", "credentials", "stack", "raw_customer_secret"]) {
    const value = { ...page(), results: [{ ...issue, [key]: "private-secret" }] };
    assert.throws(() => sanitizePostHogErrors(input(value)), error => {
      assert.equal((error as Error).message, "PostHog error response does not satisfy the safe sanitizer contract.");
      return true;
    });
  }
});

test("malformed, oversized, wrong-operation and accessor inputs fail closed", () => {
  assert.throws(() => sanitizePostHogErrors(input({ ...page(), results: Array(1) })));
  for (const value of [null, [], {}, { ...page(), count: -1 }, { ...page(), count: 0 }, { ...page(), previous: "older" }, { ...page(), next: "more" }, { ...page(), count: 101, results: Array(101).fill(issue) }, { ...page(), results: [{ ...issue, id: "private@example.test" }] }, { ...page(), results: [{ ...issue, first_seen: null }] }, { ...page(), results: [{ ...issue, status: "secret" }] }]) {
    assert.throws(() => sanitizePostHogErrors(input(value)));
  }
  const hostile = { ...issue };
  Object.defineProperty(hostile, "description", { get() { assert.fail("must not execute getter"); } });
  assert.throws(() => sanitizePostHogErrors(input({ ...page(), results: [hostile] })));
  assert.throws(() => sanitizePostHogErrors({ ...input(page()), operation: "read-events" }));
});

test("concrete sanitizer feeds the injected read pipeline without retaining provider content", async () => {
  const plan = planPostHogReadRequest({ origin: "https://us.posthog.com", operation: "read-errors", project: "42", pageSize: 50 });
  const result = await executePostHogReadPipeline(plan,
    async () => ({ authorization: "Bearer fixture_readonly_token_123456" }),
    async request => ({ status: 200, contentType: "application/json", finalUrl: request.url, body: JSON.stringify(page()) }),
    sanitizePostHogErrors);
  assert.equal(result.context.signals.length, 1);
  assert.equal(result.observe.components.product.incidentSignals, 1);
  assert.equal(result.execution.status, "complete");
  for (const value of [issue.name, issue.description, "private.invalid", "customer group", "fixture_readonly_token_123456"]) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }
});
