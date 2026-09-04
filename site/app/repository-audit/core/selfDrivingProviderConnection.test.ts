import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_READ_CAPABILITIES,
  createPostHogReadIntent,
  createProviderConnectionPlan,
  type ProviderConnectionPlan,
  type ProviderConnectionPlanInput,
  type ProviderReadCapability,
} from "./selfDrivingProviderConnection";

function input(overrides: Partial<ProviderConnectionPlanInput> = {}): ProviderConnectionPlanInput {
  return {
    provider: "posthog",
    region: "us",
    tenant: { projectLocator: "project:checkout-demo" },
    credentialRef: "env:POSTHOG_PERSONAL_API_KEY",
    capabilities: ["product-events", "errors", "deployments"],
    ...overrides,
  };
}

test("provider connection plans are deterministic, tenant-bound, redacted, and no-authority", () => {
  const first = createProviderConnectionPlan(input({
    capabilities: ["errors", "product-events", "deployments"],
  }));
  const second = createProviderConnectionPlan(input({
    capabilities: ["deployments", "errors", "product-events"],
  }));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.self-driving.provider-connection.v0");
  assert.equal(first.mode, "analyze-only");
  assert.match(first.id, /^provider_[a-f0-9]{16}$/);
  assert.deepEqual(first.capabilities, ["deployments", "errors", "product-events"]);
  assert.deepEqual(first.tenant, { projectLocator: "project:checkout-demo" });
  assert.deepEqual(first.credential, {
    kind: "environment-variable-reference",
    reference: "env:POSTHOG_PERSONAL_API_KEY",
    resolved: false,
  });
  assert.equal(first.redaction.personIdentity, "drop");
  assert.equal(first.redaction.sessionReplay, "reject");
  assert.equal(first.redaction.rawPrompt, "reject");
  assert.equal(first.redaction.credentialsAndSecrets, "reject");
  assert.equal(first.policy.explicitReadAllowlistOnly, true);
  assert.equal(first.policy.arbitraryEndpointAccess, false);
  assert.equal(first.policy.mutationEndpointAccess, false);
  assert.equal(first.policy.networkAccess, false);
  assert.equal(first.policy.credentialResolution, false);
  assert.equal(first.policy.repositoryWriteAccess, false);
  assert.equal(first.policy.rolloutMutationAccess, false);
  assert.equal(first.policy.productionMutationAccess, false);
  assert.equal(first.policy.externalSideEffects, false);
});

test("provider connection plans accept credential references but reject raw credential values", () => {
  for (const credentialRef of [
    "phx_live_abcdefghijklmnopqrstuvwxyz",
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "POSTHOG_PERSONAL_API_KEY",
    "env:posthog_key",
    "env:",
  ]) {
    assert.throws(
      () => createProviderConnectionPlan(input({ credentialRef })),
      /environment-variable reference|raw credential values are not accepted/,
    );
  }

  const plan = createProviderConnectionPlan(input({ credentialRef: "env:POSTHOG_READ_ONLY_TOKEN" }));
  assert.equal(plan.credential.reference, "env:POSTHOG_READ_ONLY_TOKEN");
  assert.equal(plan.credential.resolved, false);
});

test("provider connection plans reject malformed tenant locators", () => {
  for (const projectLocator of [
    "",
    "checkout-demo",
    "project:",
    "https://us.posthog.com/project/42",
    "project:person@example.com",
    `project:${"x".repeat(200)}`,
  ]) {
    assert.throws(
      () => createProviderConnectionPlan(input({ tenant: { projectLocator } })),
      /project:<locator> syntax/,
    );
  }
});

test("provider connection plans reject duplicate, unknown, and mutation-shaped capabilities", () => {
  assert.throws(
    () => createProviderConnectionPlan(input({ capabilities: ["errors", "errors"] })),
    /Duplicate provider capability/,
  );

  for (const capability of ["delete-events", "update-feature-flag", "persons", "arbitrary-endpoint"]) {
    const forged = input({ capabilities: [capability as ProviderReadCapability] });
    assert.throws(
      () => createProviderConnectionPlan(forged),
      /capabilities\[0\] is not supported/,
    );
  }
});

test("provider connection bounds are positive, capped, and internally coherent", () => {
  const plan = createProviderConnectionPlan(input({
    bounds: {
      maxPages: 5,
      maxRecords: 500,
      maxResponseBytes: 1_000_000,
      maxRequests: 8,
      timeoutMs: 5_000,
      lookbackMinutes: 60,
    },
  }));
  assert.deepEqual(plan.bounds, {
    maxPages: 5,
    maxRecords: 500,
    maxResponseBytes: 1_000_000,
    maxRequests: 8,
    timeoutMs: 5_000,
    lookbackMinutes: 60,
  });

  for (const bounds of [
    { maxPages: 0 },
    { maxRecords: -1 },
    { maxResponseBytes: Number.POSITIVE_INFINITY },
    { maxRequests: 1.5 },
    { timeoutMs: 60_001 },
    { lookbackMinutes: 43_201 },
  ]) {
    assert.throws(
      () => createProviderConnectionPlan(input({ bounds })),
      /positive safe integer|hard maximum/,
    );
  }

  assert.throws(
    () => createProviderConnectionPlan(input({ bounds: { maxPages: 30, maxRequests: 20 } })),
    /maxPages cannot exceed maxRequests/,
  );
});

test("PostHog read intents map each allowlisted capability to a bounded signal kind without executing transport", () => {
  const capabilities: ProviderReadCapability[] = [...PROVIDER_READ_CAPABILITIES];
  const plan = createProviderConnectionPlan(input({ capabilities }));
  const expectedKinds = new Map<ProviderReadCapability, string>([
    ["product-events", "runtime-event"],
    ["errors", "error"],
    ["deployments", "deployment"],
    ["feature-flags", "feature-flag"],
    ["experiments", "experiment"],
    ["ai-traces", "ai-trace"],
    ["mcp-tool-calls", "mcp-tool-call"],
  ]);

  for (const capability of capabilities) {
    const intent = createPostHogReadIntent(plan, capability);
    assert.equal(intent.schema, "solvelang.self-driving.posthog-read-intent.v0");
    assert.equal(intent.connectionPlanId, plan.id);
    assert.equal(intent.capability, capability);
    assert.equal(intent.expectedSignalKind, expectedKinds.get(capability));
    assert.equal(intent.execution.status, "not-executed");
    assert.equal(intent.execution.networkRequests, 0);
    assert.equal(intent.execution.credentialResolutions, 0);
    assert.equal(intent.policy.readOnly, true);
    assert.equal(intent.policy.arbitraryEndpointAccess, false);
    assert.equal(intent.policy.mutationEndpointAccess, false);
    assert.equal(intent.policy.networkAccess, false);
    assert.equal(intent.policy.credentialResolution, false);
    assert.equal(intent.policy.externalSideEffects, false);
  }
});

test("PostHog read intents reject capabilities that are valid globally but absent from the exact plan allowlist", () => {
  const plan = createProviderConnectionPlan(input({ capabilities: ["product-events"] }));
  assert.throws(
    () => createPostHogReadIntent(plan, "errors"),
    /is not allowlisted by provider connection plan/,
  );
});

test("PostHog read intents reject forged plans that weaken the no-network/no-mutation boundary", () => {
  const plan = createProviderConnectionPlan(input());
  for (const policyChange of [
    { networkAccess: true },
    { credentialResolution: true },
    { mutationEndpointAccess: true },
    { externalSideEffects: true },
  ]) {
    const forged = {
      ...plan,
      policy: { ...plan.policy, ...policyChange },
    } as unknown as ProviderConnectionPlan;
    assert.throws(
      () => createPostHogReadIntent(forged, "product-events"),
      /weakens the no-network\/no-mutation policy boundary/,
    );
  }
});

test("provider connection planning fails closed for suggest, PR, and auto modes", () => {
  for (const requestedMode of ["suggest", "pr", "auto"] as const) {
    assert.throws(
      () => createProviderConnectionPlan(input({ requestedMode })),
      /Connection planning is observe-only/,
    );
  }
});

test("connection plan and read intents expose no caller-controlled URL, path, method, or request body surface", () => {
  const plan = createProviderConnectionPlan(input());
  const intent = createPostHogReadIntent(plan, "product-events");
  const serialized = JSON.stringify({ plan, intent });

  for (const forbiddenKey of ["\"url\"", "\"path\"", "\"method\"", "\"requestBody\"", "\"headers\"", "\"cookies\""]) {
    assert.equal(serialized.includes(forbiddenKey), false);
  }
});

test("provider plan identity changes when tenant, region, capability set, or bounds change", () => {
  const base = createProviderConnectionPlan(input());
  const variants = [
    createProviderConnectionPlan(input({ tenant: { projectLocator: "project:other" } })),
    createProviderConnectionPlan(input({ region: "eu" })),
    createProviderConnectionPlan(input({ capabilities: ["product-events"] })),
    createProviderConnectionPlan(input({ bounds: { lookbackMinutes: 60 } })),
  ];

  assert.ok(variants.every((variant) => variant.id !== base.id));
});
