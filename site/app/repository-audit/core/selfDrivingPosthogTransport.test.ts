import assert from "node:assert/strict";
import test from "node:test";
import { planPostHogReadRequest } from "./selfDrivingPosthogRequestPlanner";
import { executePostHogReadPlan } from "./selfDrivingPosthogTransport";

const plan = planPostHogReadRequest({
  origin: "https://us.posthog.com",
  operation: "read-events",
  project: "12345",
  pageSize: 50,
});

const auth = async () => ({ authorization: "Bearer fixture_readonly_token_123456" });

test("executor uses exact GET plan and returns bounded JSON metadata", async () => {
  const calls: unknown[] = [];
  const result = await executePostHogReadPlan(plan, auth, async (request) => {
    calls.push(request);
    return {
      status: 200,
      contentType: "application/json; charset=utf-8",
      finalUrl: request.url,
      body: JSON.stringify({ results: [{ id: 1 }] }),
    };
  });

  assert.equal(calls.length, 1);
  const call = calls[0] as { method: string; url: string; headers: Record<string, string> };
  assert.equal(call.method, "GET");
  assert.equal(call.url, "https://us.posthog.com/api/projects/12345/events?limit=50");
  assert.equal(call.headers.Accept, "application/json");
  assert.equal(call.headers.Authorization, "Bearer fixture_readonly_token_123456");
  assert.equal(result.source.requestId, plan.request.id);
  assert.equal(result.source.status, 200);
  assert.deepEqual(result.json, { results: [{ id: 1 }] });
  assert.equal(result.policy.injectedTransportOnly, true);
  assert.equal(result.policy.externalSideEffectsOwnedByCore, false);
  assert.equal(JSON.stringify(result).includes("fixture_readonly_token_123456"), false);
});

test("executor rejects redirects and final URL drift", async () => {
  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 200,
      contentType: "application/json",
      finalUrl: request.url,
      body: "{}",
      redirected: true,
    })),
    /redirects are not allowed/,
  );

  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async () => ({
      status: 200,
      contentType: "application/json",
      finalUrl: "https://evil.example/api/projects/12345/events?limit=50",
      body: "{}",
    })),
    /final URL does not match/,
  );
});

test("executor rejects non-JSON, invalid JSON, and oversized bodies", async () => {
  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 200,
      contentType: "text/html",
      finalUrl: request.url,
      body: "<html>no</html>",
    })),
    /application\/json/,
  );

  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 200,
      contentType: "application/json",
      finalUrl: request.url,
      body: "not json",
    })),
    /not valid JSON/,
  );

  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 200,
      contentType: "application/json",
      finalUrl: request.url,
      body: JSON.stringify({ value: "x".repeat(100) }),
    }), { maxBodyBytes: 20 }),
    /20-byte bound/,
  );
});

test("executor suppresses provider error bodies and thrown transport details", async () => {
  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 401,
      contentType: "application/json",
      finalUrl: request.url,
      body: JSON.stringify({ secret: "provider-sensitive-error" }),
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 401/);
      assert.equal(error.message.includes("provider-sensitive-error"), false);
      return true;
    },
  );

  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async () => {
      throw new Error("transport leaked token fixture_readonly_token_123456");
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /failed without exposing/);
      assert.equal(error.message.includes("fixture_readonly_token_123456"), false);
      return true;
    },
  );
});

test("executor validates ephemeral Bearer auth without persisting it", async () => {
  for (const authorization of ["", "Basic abc", "Bearer short", "token raw"] as const) {
    await assert.rejects(
      () => executePostHogReadPlan(plan, async () => ({ authorization }), async () => {
        throw new Error("transport should not run");
      }),
      /authorization/,
    );
  }
});

test("executor rejects forged plans that weaken GET/read-only boundary", async () => {
  const forgedMethod = {
    ...plan,
    request: { ...plan.request, method: "POST" },
  } as unknown as typeof plan;
  await assert.rejects(
    () => executePostHogReadPlan(forgedMethod, auth, async () => {
      throw new Error("transport should not run");
    }),
    /GET plans only/,
  );

  const forgedPolicy = {
    ...plan,
    policy: { ...plan.policy, requestBodyAllowed: true },
  } as unknown as typeof plan;
  await assert.rejects(
    () => executePostHogReadPlan(forgedPolicy, auth, async () => {
      throw new Error("transport should not run");
    }),
    /weakens the read-only/,
  );
});

test("executor validates response status and body bounds", async () => {
  await assert.rejects(
    () => executePostHogReadPlan(plan, auth, async (request) => ({
      status: 999,
      contentType: "application/json",
      finalUrl: request.url,
      body: "{}",
    })),
    /status is invalid/,
  );

  for (const maxBodyBytes of [0, -1, 5_000_001, 1.5]) {
    await assert.rejects(
      () => executePostHogReadPlan(plan, auth, async () => {
        throw new Error("transport should not run");
      }, { maxBodyBytes }),
      /maxBodyBytes/,
    );
  }
});
