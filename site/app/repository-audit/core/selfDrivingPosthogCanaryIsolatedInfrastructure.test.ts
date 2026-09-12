import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type PostHogCanaryApprovalInput,
} from "./selfDrivingPosthogCanaryApproval";
import {
  POSTHOG_CANARY_CREDENTIAL_SOURCE_SCHEMA,
  POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
  createPostHogCanaryIsolatedRuntimeDependencies,
  type PostHogCanaryCredentialSource,
} from "./selfDrivingPosthogCanaryIsolatedInfrastructure";
import {
  createPostHogCanaryRuntimeActivation,
  createPostHogCanaryRuntimeAuthProvider,
} from "./selfDrivingPosthogCanaryRuntimeGate";

const CLAIMED_AT = "2026-09-12T10:00:00.000Z";
const ACTIVATED_AT = "2026-09-12T10:00:00.100Z";
const EXPIRES_AT = "2026-09-12T10:00:09.000Z";
const NOW = "2026-09-12T10:00:01.000Z";
const CREDENTIAL_REF = "secret-store/posthog/canary-readonly";
const CREDENTIAL_SCOPE = "verified-project-read-scope";
const KILL_SWITCH_REF = "control/posthog/canary-kill-switch";
const AUTHORIZATION = "Bearer isolated_fixture_posthog_token_12345678";

function approvalInput(): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-isolated-infra-001",
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
    notBefore: "2026-09-12T09:59:00Z",
    expiresAt: "2026-09-12T10:10:00Z",
    retentionHours: 24,
  };
}

async function fixture() {
  const input = approvalInput();
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-isolated-infra-001" }),
    { now: CLAIMED_AT },
  );
  assert.equal(claim.status, "claimed");
  const activation = await createPostHogCanaryRuntimeActivation(approval, claim, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-posthog-canary-v0",
    activatedAt: ACTIVATED_AT,
    expiresAt: EXPIRES_AT,
    killSwitchRef: KILL_SWITCH_REF,
  });
  return { approval, claim, activation };
}

function credentialMaterial() {
  return {
    schema: POSTHOG_CANARY_CREDENTIAL_SOURCE_SCHEMA,
    leaseId: "isolated-lease-001",
    credentialRef: CREDENTIAL_REF,
    credentialScope: CREDENTIAL_SCOPE,
    project: "12345",
    origin: "https://us.posthog.com",
    issuedAt: "2026-09-12T09:59:59.000Z",
    expiresAt: "2026-09-12T10:01:00.000Z",
    authorization: AUTHORIZATION,
  } as const;
}

test("isolated adapters bind the kill switch and credential source to the exact runtime activation", async () => {
  const { approval, claim, activation } = await fixture();
  const killSwitchRequests: unknown[] = [];
  const credentialRequests: unknown[] = [];
  const dependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
    killSwitchStateReader: async (request) => {
      killSwitchRequests.push(request);
      return {
        schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
        status: "enabled",
        activationId: request.activationId,
        killSwitchRef: request.killSwitchRef,
        checkedAt: request.checkedAt,
        evidenceId: "kill-switch-evidence-001",
      };
    },
    credentialSource: async (request, withCredential) => {
      credentialRequests.push(request);
      return withCredential(credentialMaterial());
    },
    now: () => NOW,
  });
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, dependencies);
  const auth = await provider({ signal: new AbortController().signal });

  assert.deepEqual(auth, { authorization: AUTHORIZATION });
  assert.equal(credentialRequests.length, 1);
  assert.equal(killSwitchRequests.length, 3);
  assert.equal((credentialRequests[0] as { credentialRef: string }).credentialRef, CREDENTIAL_REF);
  assert.doesNotMatch(JSON.stringify(credentialRequests), /isolated_fixture_posthog_token/);
  assert.doesNotMatch(JSON.stringify(killSwitchRequests), /isolated_fixture_posthog_token/);
});

test("disabled kill switch prevents callback-scoped credential source access", async () => {
  const { approval, claim, activation } = await fixture();
  let sourceCalls = 0;
  const dependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
    killSwitchStateReader: async (request) => ({
      schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
      status: "disabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
      evidenceId: "kill-switch-disabled-001",
    }),
    credentialSource: async () => {
      sourceCalls += 1;
      throw new Error("must not run");
    },
    now: () => NOW,
  });
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, dependencies);
  await assert.rejects(() => provider({ signal: new AbortController().signal }), /disabled by the kill switch/);
  assert.equal(sourceCalls, 0);
});

test("credential-source metadata drift and extra secret-bearing fields fail closed with sanitized errors", async () => {
  for (const badMaterial of [
    { ...credentialMaterial(), project: "99999" },
    { ...credentialMaterial(), privateKey: "must-not-exist" },
    { ...credentialMaterial(), credentialRef: "secret-store/posthog/other" },
  ]) {
    const { approval, claim, activation } = await fixture();
    const dependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
      killSwitchStateReader: async (request) => ({
        schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
        status: "enabled",
        activationId: request.activationId,
        killSwitchRef: request.killSwitchRef,
        checkedAt: request.checkedAt,
        evidenceId: "kill-switch-evidence-002",
      }),
      credentialSource: async (_request, withCredential) => withCredential(badMaterial as never),
      now: () => NOW,
    });
    const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, dependencies);
    await assert.rejects(() => provider({ signal: new AbortController().signal }), /isolated credential lease failed/);
  }

  const { approval, claim, activation } = await fixture();
  const dependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
    killSwitchStateReader: async (request) => ({
      schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
      status: "enabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
      evidenceId: "kill-switch-evidence-003",
    }),
    credentialSource: async () => {
      throw new Error(`backend leaked ${AUTHORIZATION}`);
    },
    now: () => NOW,
  });
  const provider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, dependencies);
  let message = "";
  try {
    await provider({ signal: new AbortController().signal });
    assert.fail("expected source failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "PostHog canary isolated credential lease failed.");
  assert.doesNotMatch(message, /isolated_fixture_posthog_token/);
});

test("credential source callback re-entry, result substitution, and delayed reuse are rejected", async () => {
  const { activation } = await fixture();
  let captured: ((material: ReturnType<typeof credentialMaterial>) => Promise<unknown>) | undefined;
  const source: PostHogCanaryCredentialSource = async (_request, withCredential) => {
    captured = withCredential as typeof captured;
    await withCredential(credentialMaterial());
    return { substituted: true } as never;
  };
  const dependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
    killSwitchStateReader: async (request) => ({
      schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
      status: "enabled",
      activationId: request.activationId,
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
      evidenceId: "kill-switch-evidence-004",
    }),
    credentialSource: source,
    now: () => NOW,
  });
  const request = {
    schema: "solvelang.self-driving.posthog-canary-credential-lease-request.v0",
    activationId: activation.id,
    approvalId: activation.approvalId,
    claimId: activation.claimId,
    requestId: activation.requestId,
    project: activation.project,
    origin: activation.origin,
    operation: activation.operation,
    credentialRef: activation.credentialRef,
    credentialScope: activation.credentialScope,
    requestedAt: NOW,
  } as const;

  await assert.rejects(
    () => dependencies.credentialLeaseProvider(request, async () => ({ expected: true })),
    /single-callback result contract/,
  );
  assert.ok(captured);
  await assert.rejects(() => captured!(credentialMaterial()), /no longer active/);

  const next = await fixture();
  const reenterDependencies = createPostHogCanaryIsolatedRuntimeDependencies(next.activation, {
    killSwitchStateReader: async (killRequest) => ({
      schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
      status: "enabled",
      activationId: killRequest.activationId,
      killSwitchRef: killRequest.killSwitchRef,
      checkedAt: killRequest.checkedAt,
      evidenceId: "kill-switch-evidence-005",
    }),
    credentialSource: async (_sourceRequest, withCredential) => {
      await withCredential(credentialMaterial());
      return withCredential(credentialMaterial());
    },
    now: () => NOW,
  });
  const nextRequest = { ...request, activationId: next.activation.id, approvalId: next.activation.approvalId, claimId: next.activation.claimId };
  await assert.rejects(
    () => reenterDependencies.credentialLeaseProvider(nextRequest, async () => ({ ok: true })),
    /isolated credential source failed/,
  );
});

test("invalid kill-switch evidence and raw state-reader errors fail closed without leaking backend details", async () => {
  const { approval, claim, activation } = await fixture();
  const invalidDependencies = createPostHogCanaryIsolatedRuntimeDependencies(activation, {
    killSwitchStateReader: async (request) => ({
      schema: POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA,
      status: "enabled",
      activationId: "wrong-activation",
      killSwitchRef: request.killSwitchRef,
      checkedAt: request.checkedAt,
      evidenceId: "kill-switch-evidence-006",
    }),
    credentialSource: async (_request, withCredential) => withCredential(credentialMaterial()),
    now: () => NOW,
  });
  const invalidProvider = await createPostHogCanaryRuntimeAuthProvider(approval, claim, activation, invalidDependencies);
  await assert.rejects(() => invalidProvider({ signal: new AbortController().signal }), /kill-switch check failed/);

  const next = await fixture();
  const throwingDependencies = createPostHogCanaryIsolatedRuntimeDependencies(next.activation, {
    killSwitchStateReader: async () => {
      throw new Error(`backend secret ${AUTHORIZATION}`);
    },
    credentialSource: async (_request, withCredential) => withCredential(credentialMaterial()),
    now: () => NOW,
  });
  const throwingProvider = await createPostHogCanaryRuntimeAuthProvider(next.approval, next.claim, next.activation, throwingDependencies);
  let message = "";
  try {
    await throwingProvider({ signal: new AbortController().signal });
    assert.fail("expected kill-switch failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "PostHog canary kill-switch check failed.");
  assert.doesNotMatch(message, /isolated_fixture_posthog_token/);
});

test("isolated infrastructure refuses activation policy drift before any external dependency is reachable", async () => {
  const { activation } = await fixture();
  let readerCalls = 0;
  let sourceCalls = 0;
  const drifted = {
    ...activation,
    policy: { ...activation.policy, billingMutationAccess: true },
  } as unknown as typeof activation;
  assert.throws(
    () => createPostHogCanaryIsolatedRuntimeDependencies(drifted, {
      killSwitchStateReader: async () => {
        readerCalls += 1;
        throw new Error("must not run");
      },
      credentialSource: async () => {
        sourceCalls += 1;
        throw new Error("must not run");
      },
      now: () => NOW,
    }),
    /deny-by-default activation policy/,
  );
  assert.equal(readerCalls, 0);
  assert.equal(sourceCalls, 0);
});
