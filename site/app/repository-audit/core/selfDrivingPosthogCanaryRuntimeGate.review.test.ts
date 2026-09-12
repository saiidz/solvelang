import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type PostHogCanaryApprovalInput,
  type PostHogCanaryClaimResult,
} from "./selfDrivingPosthogCanaryApproval";
import {
  createPostHogCanaryRuntimeActivation,
  createPostHogCanaryRuntimeAuthProvider,
  type PostHogCanaryCredentialLease,
  type PostHogCanaryKillSwitch,
} from "./selfDrivingPosthogCanaryRuntimeGate";

const CLAIMED_AT = "2026-09-12T09:00:00.000Z";
const ACTIVATED_AT = "2026-09-12T09:00:00.100Z";
const ACTIVATION_EXPIRES_AT = "2026-09-12T09:00:09.000Z";
const AUTHORIZATION = "Bearer fixture_posthog_readonly_token_12345678";
const CREDENTIAL_SCOPE = "verified-project-read-scope";
const KILL_SWITCH_REF = "control/posthog/canary-kill-switch";

function approvalInput(credentialRef = "secret-store/posthog/canary-readonly"): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-runtime-review-001",
    tenantId: "tenant:solve-owner",
    systemBoundary: "self-driving-posthog-canary",
    project: "12345",
    origin: "https://us.posthog.com",
    operation: "read-errors",
    credentialRef,
    credentialScope: CREDENTIAL_SCOPE,
    operator: "owner-operator",
    runtime: "isolated-canary-runtime",
    adapterRevision: "adapter-revision-001",
    notBefore: "2026-09-12T08:59:00Z",
    expiresAt: "2026-09-12T09:10:00Z",
    retentionHours: 24,
  };
}

async function build(credentialRef = "secret-store/posthog/canary-readonly") {
  const input = approvalInput(credentialRef);
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-runtime-review-001" }),
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

function enabledKillSwitch(counter?: { calls: number }): PostHogCanaryKillSwitch {
  return async (request) => {
    if (counter) counter.calls += 1;
    return {
      status: "enabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
    };
  };
}

function lease(credentialRef: string): PostHogCanaryCredentialLease {
  return {
    leaseId: "posthog-canary-lease-review-001",
    credentialRef,
    credentialScope: CREDENTIAL_SCOPE,
    project: "12345",
    origin: "https://us.posthog.com",
    issuedAt: "2026-09-12T08:59:59.000Z",
    expiresAt: "2026-09-12T09:01:00.000Z",
    authorization: AUTHORIZATION,
  };
}

test("runtime rejects any mutation of canonical claim authority fields", async () => {
  const { approval, claim } = await build();
  const fields = ["rolloutMutationAccess", "billingMutationAccess", "solveRunnerAuthority"] as const;

  for (const field of fields) {
    const mutated = {
      ...claim,
      policy: { ...claim.policy, [field]: true },
    } as unknown as PostHogCanaryClaimResult;
    await assert.rejects(
      () => createPostHogCanaryRuntimeActivation(approval, mutated, {
        state: "approved",
        operator: "owner:saiidz",
        runtime: "isolated-posthog-canary-v0",
        activatedAt: ACTIVATED_AT,
        expiresAt: ACTIVATION_EXPIRES_AT,
        killSwitchRef: KILL_SWITCH_REF,
      }),
      /claim binding or policy drifted/,
    );
  }

  const extraPolicyField = {
    ...claim,
    policy: { ...claim.policy, unexpectedAuthority: false },
  } as unknown as PostHogCanaryClaimResult;
  await assert.rejects(
    () => createPostHogCanaryRuntimeActivation(approval, extraPolicyField, {
      state: "approved",
      operator: "owner:saiidz",
      runtime: "isolated-posthog-canary-v0",
      activatedAt: ACTIVATED_AT,
      expiresAt: ACTIVATION_EXPIRES_AT,
      killSwitchRef: KILL_SWITCH_REF,
    }),
    /claim binding or policy drifted/,
  );
});

test("approval-valid credential references through 512 characters survive exact lease binding", async () => {
  const longCredentialRef = `secret-store/posthog/${"a".repeat(320)}`;
  assert.ok(longCredentialRef.length > 256 && longCredentialRef.length <= 512);
  const { approval, claim, activation } = await build(longCredentialRef);
  assert.equal(activation.credentialRef, longCredentialRef);

  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async (request, withLease) => {
      assert.equal(request.credentialRef, longCredentialRef);
      return withLease(lease(longCredentialRef));
    },
    now: () => "2026-09-12T09:00:01.000Z",
  });

  const auth = await provider({ signal: new AbortController().signal });
  assert.deepEqual(auth, { authorization: AUTHORIZATION });
});

test("expiry while the first kill-switch check is pending prevents secret-store lease access", async () => {
  const { approval, claim, activation } = await build();
  let nowCalls = 0;
  let leaseCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async (_request, withLease) => {
      leaseCalls += 1;
      return withLease(lease(activation.credentialRef));
    },
    now: () => {
      nowCalls += 1;
      return nowCalls === 1 ? "2026-09-12T09:00:08.900Z" : ACTIVATION_EXPIRES_AT;
    },
  });

  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /outside its approved window/,
  );
  assert.equal(leaseCalls, 0);
});

test("expiry while the release kill-switch check is pending prevents authorization release", async () => {
  const { approval, claim, activation } = await build();
  let nowCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(),
    credentialLeaseProvider: async (_request, withLease) => withLease(lease(activation.credentialRef)),
    now: () => {
      nowCalls += 1;
      return nowCalls < 5 ? "2026-09-12T09:00:08.000Z" : ACTIVATION_EXPIRES_AT;
    },
  });

  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /isolated credential lease failed/,
  );
});

test("expiry while the final kill-switch check is pending prevents final auth return", async () => {
  const { approval, claim, activation } = await build();
  const checks = { calls: 0 };
  let nowCalls = 0;
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, {
    killSwitch: enabledKillSwitch(checks),
    credentialLeaseProvider: async (_request, withLease) => withLease(lease(activation.credentialRef)),
    now: () => {
      nowCalls += 1;
      return nowCalls < 7 ? "2026-09-12T09:00:08.000Z" : ACTIVATION_EXPIRES_AT;
    },
  });

  await assert.rejects(
    () => provider({ signal: new AbortController().signal }),
    /outside its approved window/,
  );
  assert.equal(checks.calls, 3);
});
