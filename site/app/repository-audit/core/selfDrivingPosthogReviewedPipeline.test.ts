import assert from "node:assert/strict";
import test from "node:test";
import { executeReviewedPostHogReadPipeline } from "./selfDrivingPosthogReviewedPipeline";
import { planPostHogReadRequest } from "./selfDrivingPosthogRequestPlanner";
import type { PostHogTransport } from "./selfDrivingPosthogTransport";

const fixtures = [
  { operation: "read-errors", kind: "error", record: { id: "17cc17c3-93c6-43a8-933a-14574b96e8da", status: "active", severity: null, first_seen: "2026-09-05T00:00:00Z", name: "private@example.test" } },
  { operation: "read-feature-flags", kind: "feature-flag", record: { id: 42, active: true, deleted: false, archived: false, version: 3, updated_at: "2026-09-05T00:00:00Z", name: "private@example.test" } },
] as const;
const auth = async () => ({ authorization: "Bearer fixture_readonly_token_123456" });
const response = (json: unknown): PostHogTransport => async request => ({ status: 200, contentType: "application/json", finalUrl: request.url, body: JSON.stringify(json) });

for (const fixture of fixtures) {
  test(`reviewed composition routes ${fixture.operation} to sanitized Context`, async () => {
    const plan = planPostHogReadRequest({ origin: "https://us.posthog.com", operation: fixture.operation, project: "42", pageSize: 50 });
    const transport = response({ count: 3, next: "https://private.invalid/?secret=omitted", previous: null, results: [fixture.record] });
    const result = await executeReviewedPostHogReadPipeline(plan, auth, transport);
    assert.deepEqual(result, await executeReviewedPostHogReadPipeline(plan, auth, transport));
    assert.equal(result.context.signals[0].kind, fixture.kind);
    assert.equal(result.execution.status, "partial");
    assert.ok(result.execution.partialReasons.includes("source-partial"));
    assert.equal(result.policy.effectiveMode, "observe");
    assert.equal(result.policy.repositoryWriteAccess, false);
    assert.equal(result.policy.productionMutationAccess, false);
    for (const value of ["private@example.test", "private.invalid", "fixture_readonly_token_123456"]) assert.equal(JSON.stringify(result).includes(value), false);
    await assert.rejects(executeReviewedPostHogReadPipeline(plan, auth, response({ count: 1, next: null, previous: null, results: [{ ...fixture.record, email: "private@example.test" }] })), { message: "PostHog response sanitization failed without exposing raw provider details." });
  });
}

test("reviewed composition denies unsupported operations and modes before auth or transport", async () => {
  const never = async (): Promise<never> => assert.fail("must not access auth or transport");
  const plan = planPostHogReadRequest({ origin: "https://us.posthog.com", operation: "read-events", project: "42", pageSize: 50 });
  await assert.rejects(executeReviewedPostHogReadPipeline(plan, never, never), /Raw PostHog GET event payloads/);
  await assert.rejects(executeReviewedPostHogReadPipeline(plan, never, never, { requestedMode: "suggest" }), /observe-only/);
});
