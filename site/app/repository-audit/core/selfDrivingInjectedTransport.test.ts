import assert from "node:assert/strict";
import test from "node:test";
import { createProviderConnectionPlan } from "./selfDrivingProviderConnection";
import { createPostHogProductEventsQueryRequest } from "./selfDrivingPosthogQueryContract";
import { runInjectedFixtureTransport, fixtureCredential, type FixtureDependencies } from "./selfDrivingInjectedTransport";

function request(timeoutMs = 1000) {
  return createPostHogProductEventsQueryRequest(createProviderConnectionPlan({
    provider: "posthog", region: "eu", tenant: { projectLocator: "project:42" },
    credentialRef: "env:POSTHOG_READ_ONLY_TOKEN", capabilities: ["product-events"], bounds: { timeoutMs },
  }));
}
const fixture = { schema: "solvelang.self-driving.posthog-transport-fixture.v0", status: 200, elapsedMs: 0, requestCount: 1, responseCount: 1, bodyText: JSON.stringify({ columns: ["event", "samples"], results: [["signup", 2]], hasMore: false }) };
function dependencies(): FixtureDependencies {
  return { resolve: async binding => fixtureCredential(binding), read: async invocation => ({ requestId: invocation.requestId, fixture }) };
}

test("default, disabled, missing injection and unsupported modes never call dependencies", async () => {
  let calls = 0;
  const deps: FixtureDependencies = { resolve: async () => { calls++; throw Error("secret"); }, read: async () => { calls++; throw Error("secret"); } };
  for (const mode of [undefined, "disabled", "live", "pr", "auto"]) {
    const result = await runInjectedFixtureTransport(request(), { mode, dependencies: deps });
    assert.notEqual(result.status, "complete");
  }
  assert.equal((await runInjectedFixtureTransport(request(), { mode: "fixture" })).status, "disabled");
  assert.equal(calls, 0);
});

test("valid fake runs retain deterministic sanitized evidence and zero live activity", async () => {
  const first = await runInjectedFixtureTransport(request(), { mode: "fixture", dependencies: dependencies() });
  const second = await runInjectedFixtureTransport(request(), { mode: "fixture", dependencies: dependencies() });
  assert.deepEqual(first, second);
  assert.equal(first.status, "complete");
  assert.equal(first.networkRequests, 0);
  assert.equal(first.realCredentialResolutions, 0);
  assert.equal(first.resolverInvocations, 1);
  assert.equal(first.transportInvocations, 1);
  assert.ok(!JSON.stringify(first).includes('bodyText\\":\\"{'));
});

test("tampering fails before resolution and wrong credential binding before transport", async () => {
  let calls = 0;
  const deps = dependencies();
  deps.resolve = async binding => { calls++; return fixtureCredential(binding); };
  const forged = Object.freeze({ ...request(), region: "us" as const });
  assert.equal((await runInjectedFixtureTransport(forged, { mode: "fixture", dependencies: deps })).status, "rejected");
  assert.equal(calls, 0);
  deps.resolve = async binding => fixtureCredential(Object.freeze({ ...binding }));
  deps.read = async () => { calls++; throw Error("must not run"); };
  assert.equal((await runInjectedFixtureTransport(request(), { mode: "fixture", dependencies: deps })).status, "rejected");
  assert.equal(calls, 0);
});

test("cancellation and timeout discard late resolver results before transport", async () => {
  const controller = new AbortController();
  let release: (() => void) | undefined;
  let reads = 0;
  const deps: FixtureDependencies = {
    resolve: binding => new Promise(resolve => { release = () => resolve(fixtureCredential(binding)); }),
    read: async () => { reads++; throw Error("must not run"); },
  };
  const pending = runInjectedFixtureTransport(request(), { mode: "fixture", dependencies: deps, signal: controller.signal });
  controller.abort();
  assert.equal((await pending).status, "cancelled");
  release?.();
  await Promise.resolve();
  assert.equal(reads, 0);
  assert.equal((await runInjectedFixtureTransport(request(1), { mode: "fixture", dependencies: deps })).status, "timeout");
  release?.();
  await Promise.resolve();
  assert.equal(reads, 0);
});

test("dependency errors, wrong response identity and oversized fixtures are sanitized", async () => {
  for (const read of [
    async () => { throw Error("SECRET_RAW_BODY"); },
    async () => ({ requestId: "wrong", fixture }),
    async (invocation: Parameters<FixtureDependencies["read"]>[0]) => ({ requestId: invocation.requestId, fixture: { ...fixture, bodyText: "x".repeat(5 * 1024 * 1024 + 1) } }),
  ]) {
    const result = await runInjectedFixtureTransport(request(), { mode: "fixture", dependencies: { ...dependencies(), read } });
    assert.equal(result.status, "rejected");
    assert.ok(!JSON.stringify(result).includes("SECRET_RAW_BODY"));
  }
});

test("a caller cannot redirect the frozen invocation while resolution is pending", async () => {
  const mutable = structuredClone(request());
  Object.freeze(mutable);
  let release: (() => void) | undefined;
  let url = "";
  const pending = runInjectedFixtureTransport(mutable, { mode: "fixture", dependencies: {
    resolve: binding => new Promise(resolve => { release = () => resolve(fixtureCredential(binding)); }),
    read: async invocation => { url = invocation.outbound.url; return { requestId: invocation.requestId, fixture }; },
  } });
  mutable.request.host = "https://us.posthog.com";
  release?.();
  assert.equal((await pending).status, "complete");
  assert.equal(url, "https://eu.posthog.com/api/projects/42/query/");
});

test("a late synchronous fake cannot beat the timeout by blocking its timer", async () => {
  const result = await runInjectedFixtureTransport(request(1), { mode: "fixture", dependencies: {
    ...dependencies(),
    resolve: async binding => {
      const until = performance.now() + 5;
      while (performance.now() < until) { /* finite adversarial fixture */ }
      return fixtureCredential(binding);
    },
  } });
  assert.equal(result.status, "timeout");
  assert.equal(result.transportInvocations, 0);
});
