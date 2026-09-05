import assert from "node:assert/strict";
import test from "node:test";
import { planPostHogReadRequest } from "./selfDrivingPosthogRequestPlanner";
import {
  executePostHogReadPlan,
  PostHogTransportFailure,
} from "./selfDrivingPosthogTransport";

const plan = planPostHogReadRequest({
  origin: "https://us.posthog.com",
  operation: "read-events",
  project: "12345",
  pageSize: 50,
});

test("pre-cancelled execution performs zero authorization or transport callbacks", async () => {
  const controller = new AbortController();
  controller.abort();
  let authorizationCalls = 0;
  let transportCalls = 0;

  await assert.rejects(
    () => executePostHogReadPlan(
      plan,
      async () => {
        authorizationCalls += 1;
        return { authorization: "Bearer must_not_be_resolved_123456" };
      },
      async () => {
        transportCalls += 1;
        throw new Error("transport must not run");
      },
      { signal: controller.signal },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PostHogTransportFailure);
      assert.equal(error.category, "cancelled");
      return true;
    },
  );

  assert.equal(authorizationCalls, 0);
  assert.equal(transportCalls, 0);
});
