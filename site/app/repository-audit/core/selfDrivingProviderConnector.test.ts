import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReadOnlyProvider,
  POSTHOG_READONLY_CONNECTOR_POLICY,
  type ProviderConnectorPolicy,
} from "./selfDrivingProviderConnector";

function policy(overrides: Partial<ProviderConnectorPolicy> = {}): ProviderConnectorPolicy {
  return {
    provider: "fixture",
    allowedOperations: [
      { provider: "fixture", operation: "read-events", pathTemplate: "/v1/projects/{project}/events", tenantField: "project" },
    ],
    maxPageSize: 100,
    maxPages: 3,
    maxRecords: 10,
    maxBytes: 1_000,
    maxRetries: 1,
    maxWallClockMs: 10_000,
    ...overrides,
  };
}

const request = {
  provider: "fixture",
  operation: "read-events",
  tenant: "project:alpha",
  credentialRef: "secretref:fixture/read-only",
  pageSize: 50,
} as const;

test("connector collects bounded read-only pages without returning credential material", async () => {
  const calls: unknown[] = [];
  const result = await collectReadOnlyProvider(policy(), request, async (input) => {
    calls.push(input);
    if (!input.cursor) return { tenant: input.tenant, records: [{ id: 1 }], bytes: 20, nextCursor: "next-1" };
    return { tenant: input.tenant, records: [{ id: 2 }], bytes: 30 };
  });

  assert.equal(result.schema, "solvelang.self-driving.provider-connector.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.execution.status, "complete");
  assert.equal(result.execution.pages, 2);
  assert.equal(result.execution.records, 2);
  assert.equal(result.execution.bytes, 50);
  assert.equal(result.policy.readOnly, true);
  assert.equal(result.policy.credentialMaterialReturned, false);
  assert.equal(result.policy.writeMethodsAllowed, false);
  assert.equal(JSON.stringify(result).includes(request.credentialRef), false);
  assert.equal(calls.length, 2);
});

test("connector rejects provider, tenant, and non-observe authority mismatches", async () => {
  await assert.rejects(
    () => collectReadOnlyProvider(policy(), { ...request, provider: "other" }, async () => ({ tenant: request.tenant, records: [], bytes: 0 })),
    /does not match/,
  );
  await assert.rejects(
    () => collectReadOnlyProvider(policy(), { ...request, requestedMode: "pr" }, async () => ({ tenant: request.tenant, records: [], bytes: 0 })),
    /observe-only/,
  );
  await assert.rejects(
    () => collectReadOnlyProvider(policy(), request, async () => ({ tenant: "project:other", records: [], bytes: 0 })),
    /tenant does not match/,
  );
});

test("connector rejects mutation-shaped operations and arbitrary absolute URLs", async () => {
  await assert.rejects(
    () => collectReadOnlyProvider(policy({
      allowedOperations: [{ provider: "fixture", operation: "delete-events", pathTemplate: "/v1/projects/{project}/events", tenantField: "project" }],
    }), { ...request, operation: "delete-events" }, async () => ({ tenant: request.tenant, records: [], bytes: 0 })),
    /mutation-shaped/,
  );

  await assert.rejects(
    () => collectReadOnlyProvider(policy({
      allowedOperations: [{ provider: "fixture", operation: "read-events", pathTemplate: "https://evil.example/events", tenantField: "project" }],
    }), request, async () => ({ tenant: request.tenant, records: [], bytes: 0 })),
    /absolute URLs/,
  );
});

test("connector rejects credential material disguised as a credential reference", async () => {
  for (const credentialRef of [
    "sk-proj_abcdefghijklmnopqrstuvwxyz",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "AKIAABCDEFGHIJKLMNOP",
  ]) {
    await assert.rejects(
      () => collectReadOnlyProvider(policy(), { ...request, credentialRef }, async () => ({ tenant: request.tenant, records: [], bytes: 0 })),
      /credential material|opaque reference/,
    );
  }
});

test("connector preserves page, record, byte, and cursor-cycle partial truth", async () => {
  const pageLimited = await collectReadOnlyProvider(policy({ maxPages: 1 }), request, async (input) => ({
    tenant: input.tenant,
    records: [{ page: 1 }],
    bytes: 10,
    nextCursor: "page-2",
  }));
  assert.deepEqual(pageLimited.execution.partialReasons, ["page-limit"]);

  const recordLimited = await collectReadOnlyProvider(policy({ maxRecords: 1 }), request, async (input) => ({
    tenant: input.tenant,
    records: [{ id: 1 }, { id: 2 }],
    bytes: 10,
  }));
  assert.deepEqual(recordLimited.execution.partialReasons, ["record-limit"]);
  assert.equal(recordLimited.records.length, 1);

  const byteLimited = await collectReadOnlyProvider(policy({ maxBytes: 5 }), request, async (input) => ({
    tenant: input.tenant,
    records: [{ id: 1 }],
    bytes: 6,
  }));
  assert.deepEqual(byteLimited.execution.partialReasons, ["byte-limit"]);
  assert.equal(byteLimited.records.length, 0);

  let call = 0;
  const cycle = await collectReadOnlyProvider(policy(), request, async (input) => {
    call += 1;
    return { tenant: input.tenant, records: [{ call }], bytes: 1, nextCursor: "same" };
  });
  assert.deepEqual(cycle.execution.partialReasons, ["cursor-cycle"]);
});

test("connector enforces retry budget and reports exhaustion without throwing provider details", async () => {
  let attempts = 0;
  const result = await collectReadOnlyProvider(policy({ maxRetries: 2 }), request, async () => {
    attempts += 1;
    throw new Error("provider secret body should not escape");
  });

  assert.equal(attempts, 3);
  assert.equal(result.execution.retries, 2);
  assert.deepEqual(result.execution.partialReasons, ["retry-exhausted"]);
  assert.equal(JSON.stringify(result).includes("provider secret body"), false);
});

test("connector records wall-clock exhaustion deterministically", async () => {
  const ticks = [0, 0, 11_000];
  const now = () => ticks.shift() ?? 11_000;
  const result = await collectReadOnlyProvider(policy({ maxWallClockMs: 10_000 }), request, async (input) => ({
    tenant: input.tenant,
    records: [{ id: 1 }],
    bytes: 1,
    nextCursor: "next",
  }), now);
  assert.deepEqual(result.execution.partialReasons, ["wall-clock-limit"]);
});

test("PostHog policy exposes only bounded read operations", () => {
  assert.equal(POSTHOG_READONLY_CONNECTOR_POLICY.provider, "posthog");
  assert.deepEqual(
    POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations.map((item) => item.operation),
    ["read-events", "read-errors", "read-feature-flags"],
  );
  assert.ok(POSTHOG_READONLY_CONNECTOR_POLICY.allowedOperations.every((item) => item.pathTemplate.startsWith("/api/projects/")));
});
