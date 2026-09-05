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

const auth = async () => ({ authorization: "Bearer fixture_readonly_token_123456" });

test("error and flag legacy paths or injected cursor cannot resolve credentials or invoke transport", async () => {
  for (const operation of ["read-errors", "read-feature-flags"]) {
    const firstPage = planPostHogReadRequest({ origin: "https://us.posthog.com", operation, project: "12345", pageSize: 50 });
    for (const request of [
      { ...firstPage.request, pathname: firstPage.request.pathname.replace(/\/$/, "") },
      { ...firstPage.request, query: { ...firstPage.request.query, cursor: "next" } },
    ]) {
      let calls = 0;
      await assert.rejects(executePostHogReadPlan({ ...firstPage, request }, async () => { calls++; return auth(); }, async () => { calls++; throw new Error("must not run"); }), /intact canonical request plan/);
      assert.equal(calls, 0);
    }
  }
});

function assertFailureCategory(category: string, forbidden?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof PostHogTransportFailure);
    assert.equal(error.category, category);
    if (forbidden) assert.equal(error.message.includes(forbidden), false);
    return true;
  };
}

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
  const call = calls[0] as {
    method: string;
    url: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  };
  assert.equal(call.method, "GET");
  assert.equal(call.url, "https://us.posthog.com/api/projects/12345/events?limit=50");
  assert.equal(call.headers.Accept, "application/json");
  assert.equal(call.headers.Authorization, "Bearer fixture_readonly_token_123456");
  assert.equal(call.signal.aborted, false);
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
    assertFailureCategory("transport", "fixture_readonly_token_123456"),
  );
});

test("authorization failures are bounded, categorized, and sanitized", async () => {
  for (const authorization of ["", "Basic abc", "Bearer short", "token raw"] as const) {
    await assert.rejects(
      () => executePostHogReadPlan(plan, async () => ({ authorization }), async () => {
        throw new Error("transport should not run");
      }),
      assertFailureCategory("authorization"),
    );
  }

  await assert.rejects(
    () => executePostHogReadPlan(plan, async () => {
      throw new Error("credential callback leaked SECRET_AUTH_DETAIL");
    }, async () => {
      throw new Error("transport should not run");
    }),
    assertFailureCategory("authorization", "SECRET_AUTH_DETAIL"),
  );

  await assert.rejects(
    () => executePostHogReadPlan(plan, async () => ({
      authorization: `Bearer ${"x".repeat(5_000)}`,
    }), async () => {
      throw new Error("transport should not run");
    }),
    assertFailureCategory("authorization"),
  );
});

test("executor rejects forged canonical-plan fields before authorization or transport", async () => {
  let calls = 0;
  const noAuth = async () => {
    calls += 1;
    return { authorization: "Bearer fixture_readonly_token_123456" };
  };
  const noTransport = async () => {
    calls += 1;
    throw new Error("transport should not run");
  };

  const forgedPlans = [
    { ...plan, request: { ...plan.request, method: "POST" } },
    { ...plan, request: { ...plan.request, origin: "https://evil.example" } },
    { ...plan, request: { ...plan.request, pathname: "/api/projects/12345/not-allowlisted" } },
    { ...plan, request: { ...plan.request, id: "phr_deadbeefdeadbeef" } },
    { ...plan, request: { ...plan.request, query: { ...plan.request.query, limit: "1000" } } },
    { ...plan, request: { ...plan.request, query: { ...plan.request.query, host: "evil.example" } } },
    { ...plan, policy: { ...plan.policy, requestBodyAllowed: true } },
    { ...plan, policy: { ...plan.policy, arbitraryHostAccess: true } },
  ] as unknown as Array<typeof plan>;

  for (const forged of forgedPlans) {
    await assert.rejects(
      () => executePostHogReadPlan(forged, noAuth, noTransport),
      /intact canonical request plan/,
    );
  }
  assert.equal(calls, 0);
});

test("executor bounds timeout and caller cancellation with sanitized categories", async () => {
  await assert.rejects(
    () => executePostHogReadPlan(
      plan,
      auth,
      async (request) => new Promise((_, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new Error("late transport leaked SECRET_TIMEOUT_DETAIL")),
          { once: true },
        );
      }),
      { timeoutMs: 5 },
    ),
    assertFailureCategory("timeout", "SECRET_TIMEOUT_DETAIL"),
  );

  const controller = new AbortController();
  let authSawSignal = false;
  const pending = executePostHogReadPlan(
    plan,
    async ({ signal }) => new Promise((_, reject) => {
      authSawSignal = true;
      signal.addEventListener(
        "abort",
        () => reject(new Error("late auth leaked SECRET_CANCEL_DETAIL")),
        { once: true },
      );
    }),
    async () => {
      throw new Error("transport should not run");
    },
    { signal: controller.signal, timeoutMs: 1_000 },
  );
  controller.abort();
  await assert.rejects(
    () => pending,
    assertFailureCategory("cancelled", "SECRET_CANCEL_DETAIL"),
  );
  assert.equal(authSawSignal, true);
});

test("executor validates response status and execution bounds", async () => {
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

  for (const timeoutMs of [0, -1, 15_001, 1.5]) {
    await assert.rejects(
      () => executePostHogReadPlan(plan, auth, async () => {
        throw new Error("transport should not run");
      }, { timeoutMs }),
      /timeoutMs/,
    );
  }
});
