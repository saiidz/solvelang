import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type PostHogCanaryApprovalInput,
} from "./selfDrivingPosthogCanaryApproval";
import {
  createPostHogCanaryRuntimeActivation,
  createPostHogCanaryRuntimeAuthProvider,
  POSTHOG_CANARY_CREDENTIAL_LEASE_REQUEST_SCHEMA,
  POSTHOG_CANARY_KILL_SWITCH_REQUEST_SCHEMA,
  POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA,
  type PostHogCanaryCredentialLease,
  type PostHogCanaryCredentialLeaseProvider,
  type PostHogCanaryKillSwitch,
} from "./selfDrivingPosthogCanaryRuntimeGate";

const CLAIMED_AT = "2026-09-12T09:00:00.000Z";
const ACTIVATED_AT = "2026-09-12T09:00:00.100Z";
const ACTIVATION_EXPIRES_AT = "2026-09-12T09:00:09.000Z";
const AUTHORIZATION = "Bearer fixture_posthog_readonly_token_12345678";
const CREDENTIAL_REF = "secret-store/posthog/canary-readonly";
const CREDENTIAL_SCOPE = "verified-project-read-scope";
const KILL_SWITCH_REF = "control/posthog/canary-kill-switch";

function approvalInput(overrides: Partial<PostHogCanaryApprovalInput> = {}): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-runtime-001",
    tenantId: "tenant:solve-owner",
    systemBoundary: "self-driving-posthog-canary",
    project: "12345",
    origin: "https://us.posthog.com",
    operation: "read-errors",
    credentialRef: CREDENTIAL_REF,
    credentialScope: CREDENTIAL_SCOPE,
    operator: "owner-operator",
    runtime: "isolated-canary-runtime",
    adapterRevision: "adapter-revision-001",
    notBefore: "2026-09-12T08:59:00Z",
    expiresAt: "2026-09-12T09:10:00Z",
    retentionHours: 24,
    ...overrides,
  };
}

async function approvalClaimActivation() {
  const input = approvalInput();
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-runtime-001" }),
    { now: CLAIMED_AT },
  );
  assert.equal(claim.status, "claimed");
  const activation = await createPostHogCanaryRuntimeActivation(approval, claim, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-posthog-canary-v0",
    activatedAt: ACTIVATED_AT,
    expiresAt: ACTIVATION_EXPIRES_AT,
    killSwitchRef: KILL_SWITCH_REF,
  });
  return { approval, claim, activation };
}

function enabledKillSwitch(calls?: unknown[]): PostHogCanaryKillSwitch {
  return async (request) => {
    calls?.push(request);
    return {
      status: "enabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
    };
  };
}

function lease(overrides: Partial<PostHogCanaryCredentialLease> = {}): PostHogCanaryCredentialLease {
  return {
    leaseId: "posthog-canary-lease-001",
    credentialRef: CREDENTIAL_REF,
    credentialScope: CREDENTIAL_SCOPE,
    project: "12345",
    origin: "https://us.posthog.com",
    issuedAt: "2026-09-12T08:59:59.000Z",
    expiresAt: "2026-09-12T09:01:00.000Z",
    authorization: AUTHORIZATION,
    ...overrides,
  };
}

test("runtime activation is deterministic and binds the exact approval, claim, project, scope, and kill switch", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  const second = await createPostHogCanaryRuntimeActivation(approval, claim, {
    state: "approved",
    operator: activation.operator,
    runtime: activation.runtime,
    activatedAt: activation.activatedAt,
    expiresAt: activation.expiresAt,
    killSwitchRef: activation.killSwitchRef,
  });
  assert.equal(activation.schema, POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA);
  assert.equal(activation.id, second.id);
  assert.equal(activation.approvalId, approval.approvalId);
  assert.equal(activation.claimId, claim.claimId);
  assert.equal(activation.project, approval.project);
  assert.equal(activation.origin, approval.origin);
  assert.equal(activation.credentialRef, CREDENTIAL_REF);
  assert.equal(activation.credentialScope, CREDENTIAL_SCOPE);
  assert.equal(activation.killSwitchRef, KILL_SWITCH_REF);
  assert.equal(activation.policy.builtInSecretStoreAccess, false);
  assert.equal(activation.policy.builtInNetworkClient, false);
  assert.equal(activation.policy.rawCredentialMaterialReturned, false);
  assert.doesNotMatch(JSON.stringify(activation), /fixture_posthog_readonly_token/);
});

test("activation cannot outlive the claim deadline or precede the successful claim", async () => {
  const input = approvalInput();
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-runtime-002" }),
    { now: CLAIMED_AT },
  );
  await assert.rejects(
    () => createPostHogCanaryRuntimeActivation(approval, claim, {
      state: "approved",
      operator: "owner:saiidz",
      runtime: "isolated-posthog-canary-v0",
      activatedAt: "2026-09-12T08:59:59.999Z",
      expiresAt: ACTIVATION_EXPIRES_AT,
      killSwitchRef: KILL_SWITCH_REF,
    }),
    /may not precede/,
  );
  await assert.rejects(
    () => createPostHogCanaryRuntimeActivation(approval, claim, {
      state: "approved",
      operator: "owner:saiidz",
      runtime: "isolated-posthog-canary-v0",
      activatedAt: ACTIVATED_AT,
      expiresAt: "2026-09-12T09:00:10.001Z",
      killSwitchRef: KILL_SWITCH_REF,
    }),
    /deadline boundary/,
  );
});

test("auth provider checks the kill switch, requests the exact lease once, and returns only ephemeral auth", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  const killSwitchCalls: unknown[] = [];
  const leaseRequests: unknown[] = [];
  let leaseCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(killSwitchCalls),
    credentialLeaseProvider: async (request, withLease) => {
      leaseCalls += 1;
      leaseRequests.push(request);
      return withLease(lease());
    },
    now: () => "2026-09-12T09:00:01.000Z",
  });
  const auth = await provider({ signal: new AbortController().signal });
  assert.deepEqual(auth, { authorization: AUTHORIZATION });
  assert.equal(leaseCalls, 1);
  assert.equal(leaseRequests.length, 1);
  const request = leaseRequests[0] as Record<string, unknown>;
  assert.equal(request.schema, POSTHOG_CANARY_CREDENTIAL_LEASE_REQUEST_SCHEMA);
  assert.equal(request.activationId, activation.id);
  assert.equal(request.approvalId, approval.approvalId);
  assert.equal(request.claimId, claim.claimId);
  assert.equal(request.requestId, approval.requestPlan.request.id);
  assert.equal(request.project, "12345");
  assert.equal(request.origin, "https://us.posthog.com");
  assert.equal(request.credentialRef, CREDENTIAL_REF);
  assert.equal(request.credentialScope, CREDENTIAL_SCOPE);
  assert.equal(killSwitchCalls.length, 3);
  for (const raw of killSwitchCalls) {
    const check = raw as Record<string, unknown>;
    assert.equal(check.schema, POSTHOG_CANARY_KILL_SWITCH_REQUEST_SCHEMA);
    assert.equal(check.activationId, activation.id);
    assert.equal(check.killSwitchRef, KILL_SWITCH_REF);
  }
  assert.doesNotMatch(JSON.stringify(leaseRequests), /fixture_posthog_readonly_token/);
});

test("disabled kill switch fails before credential lease access", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  let leaseCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: async (request) => ({
      status: "disabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
    }),
    credentialLeaseProvider: async () => {
      leaseCalls += 1;
      throw new Error("must not run");
    },
    now: () => "2026-09-12T09:00:01.000Z",
  });
  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /disabled by the kill switch/,
  );
  assert.equal(leaseCalls, 0);
});

test("lease identity drift, extra fields, short lifetime, and raw provider errors fail closed", async () => {
  const cases: Array<PostHogCanaryCredentialLease & Record<string, unknown>> = [
    { ...lease(), project: "99999" },
    { ...lease(), privateKey: "must-not-exist" },
    { ...lease(), expiresAt: "2026-09-12T09:00:04.000Z" },
  ];
  for (const badLease of cases) {
    const { approval, claim, activation } = await approvalClaimActivation();
    const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
      killSwitch: enabledKillSwitch(),
      credentialLeaseProvider: async (_request, withLease) => withLease(badLease),
      now: () => "2026-09-12T09:00:01.000Z",
    });
    await assert.rejects(
      () => provider({ signal: new AbortController().signal }),
      /isolated credential lease failed/,
    );
  }

  const { approval, claim, activation } = await approvalClaimActivation();
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async () => {
      throw new Error(`secret ${AUTHORIZATION}`);
    },
    now: () => "2026-09-12T09:00:01.000Z",
  });
  let message = "";
  try {
    await provider({ signal: new AbortController().signal });
    assert.fail("expected failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "PostHog canary isolated credential lease failed.");
  assert.doesNotMatch(message, /fixture_posthog_readonly_token/);
});

test("provider result substitution and callback use after settlement are rejected", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  let captured: ((lease: PostHogCanaryCredentialLease) => Promise<unknown>) | undefined;
  const credentialLeaseProvider: PostHogCanaryCredentialLeaseProvider = async (_request, withLease) => {
    captured = withLease;
    return { authorization: "Bearer substituted_result_12345678" } as never;
  };
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider,
    now: () => "2026-09-12T09:00:01.000Z",
  });
  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /single-callback result contract/,
  );
  assert.ok(captured);
  await assert.rejects(() => captured!(lease()), /no longer active/);
});

test("kill switch is rechecked after lease access and activation expiry prevents credential release", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  let checks = 0;
  let nowCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: async (request) => {
      checks += 1;
      return {
        status: checks === 1 ? "enabled" : "disabled",
        activationId: request.activationId,
        killSwitchRef: request.killSwitchRef,
        checkedAt: request.checkedAt,
      };
    },
    credentialLeaseProvider: async (_request, withLease) => withLease(lease()),
    now: () => {
      nowCalls += 1;
      return nowCalls === 1 ? "2026-09-12T09:00:01.000Z" : "2026-09-12T09:00:02.000Z";
    },
  });
  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /isolated credential lease failed/,
  );
  assert.equal(checks, 2);

  const next = await approvalClaimActivation();
  let clock = 0;
  const expiringProvider = await createPostHogCanaryRuntimeAuthProvider(next.approval, next.claim, next.activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async (_request, withLease) => withLease(lease()),
    now: () => {
      clock += 1;
      return clock === 1 ? "2026-09-12T09:00:01.000Z" : ACTIVATION_EXPIRES_AT;
    },
  });
  await assert.rejects(
    () => expiringProvider({ signal: new AbortController().signal }),
    /isolated credential lease failed/,
  );
});

test("auth provider is single-use and never leases a second credential", async () => {
  const { approval, claim, activation } = await approvalClaimActivation();
  let leaseCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async (_request, withLease) => {
      leaseCalls += 1;
      return withLease(lease());
    },
    now: () => "2026-09-12T09:00:01.000Z",
  });
  await provider({ signal: new AbortController().signal });
  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /single-use/,
  );
  assert.equal(leaseCalls, 1);
});
