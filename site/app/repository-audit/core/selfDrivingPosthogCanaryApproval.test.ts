import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type PostHogCanaryApprovalInput,
  type PostHogCanaryAtomicClaimer,
  type PostHogCanaryAtomicClaimRequest,
} from "./selfDrivingPosthogCanaryApproval";

function approval(overrides: Partial<PostHogCanaryApprovalInput> = {}): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-20260905-001",
    tenantId: "tenant:solve-owner",
    systemBoundary: "self-driving-posthog-canary",
    project: "12345",
    origin: "https://us.posthog.com",
    operation: "read-errors",
    credentialRef: "secret-store/posthog/canary-readonly",
    credentialScope: "verified-project-read-scope",
    operator: "owner-operator",
    runtime: "isolated-canary-runtime",
    adapterRevision: "adapter-revision-001",
    notBefore: "2026-09-05T14:00:00Z",
    expiresAt: "2026-09-05T14:10:00Z",
    retentionHours: 24,
    ...overrides,
  };
}

test("canary approval normalization binds one exact first-page request without resolving credentials", () => {
  const normalized = normalizePostHogCanaryApproval(approval());

  assert.equal(normalized.schema, "solvelang.self-driving.posthog-canary-approval.v0");
  assert.equal(normalized.state, "approved");
  assert.equal(normalized.project, "12345");
  assert.equal(normalized.origin, "https://us.posthog.com");
  assert.equal(normalized.operation, "read-errors");
  assert.equal(normalized.notBefore, "2026-09-05T14:00:00.000Z");
  assert.equal(normalized.expiresAt, "2026-09-05T14:10:00.000Z");
  assert.equal(normalized.requestPlan.request.method, "GET");
  assert.equal(normalized.requestPlan.request.pathname, "/api/projects/12345/error_tracking/issues/");
  assert.deepEqual(normalized.requestPlan.request.query, { limit: "25" });
  assert.equal(normalized.requestPlan.policy.authorizationMaterialIncluded, false);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.requestPlan), true);
  assert.equal(Object.isFrozen(normalized.requestPlan.request), true);
  assert.equal(Object.isFrozen(normalized.requestPlan.request.query), true);
});

test("claim invokes the atomic dependency exactly once only after approval validation", async () => {
  let calls = 0;
  let seen: PostHogCanaryAtomicClaimRequest | undefined;
  const claimer: PostHogCanaryAtomicClaimer = async (request) => {
    calls += 1;
    seen = request;
    return { status: "claimed", claimId: "claim-001" };
  };

  const result = await claimPostHogCanaryApproval(approval(), claimer, {
    now: "2026-09-05T14:05:00Z",
  });

  assert.equal(calls, 1);
  assert.ok(seen);
  assert.equal(seen.schema, "solvelang.self-driving.posthog-canary-claim.v0");
  assert.equal(seen.expectedState, "approved");
  assert.equal(seen.approvalId, "approval-20260905-001");
  assert.equal(seen.binding.requestPlan.request.query.limit, "25");
  assert.equal(result.status, "claimed");
  assert.equal(result.claimId, "claim-001");
  assert.equal(result.policy.atomicSingleUseClaimRequired, true);
  assert.equal(result.policy.approvalClaimMutationAttempted, true);
  assert.equal(result.policy.retries, 0);
  assert.equal(result.policy.automaticRearm, false);
  assert.equal(result.policy.credentialResolutionAccess, false);
  assert.equal(result.policy.providerNetworkAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
  assert.equal(result.policy.credentialMaterialReturned, false);
});

test("concurrent callers racing one approval allow only one fixture CAS claimant to win", async () => {
  let state: "approved" | "claimed" = "approved";
  let successfulClaims = 0;
  const claimer: PostHogCanaryAtomicClaimer = async () => {
    if (state !== "approved") return { status: "rejected", reason: "already-claimed" };
    state = "claimed";
    successfulClaims += 1;
    return { status: "claimed", claimId: `claim-${successfulClaims}` };
  };

  const [first, second, third] = await Promise.all([
    claimPostHogCanaryApproval(approval(), claimer, { now: "2026-09-05T14:05:00Z" }),
    claimPostHogCanaryApproval(approval(), claimer, { now: "2026-09-05T14:05:00Z" }),
    claimPostHogCanaryApproval(approval(), claimer, { now: "2026-09-05T14:05:00Z" }),
  ]);

  assert.equal(successfulClaims, 1);
  assert.equal([first, second, third].filter((result) => result.status === "claimed").length, 1);
  assert.equal([first, second, third].filter((result) => result.rejectionReason === "already-claimed").length, 2);
});

test("replayed or non-approved records fail closed without re-arming", async () => {
  let calls = 0;
  const claimer: PostHogCanaryAtomicClaimer = async () => {
    calls += 1;
    return { status: "rejected", reason: "already-consumed" };
  };

  const replay = await claimPostHogCanaryApproval(approval(), claimer, {
    now: "2026-09-05T14:05:00Z",
  });
  assert.equal(replay.status, "rejected");
  assert.equal(replay.rejectionReason, "already-consumed");
  assert.equal(replay.policy.automaticRearm, false);
  assert.equal(calls, 1);

  await assert.rejects(
    claimPostHogCanaryApproval(
      { ...approval(), state: "claimed" as "approved" },
      claimer,
      { now: "2026-09-05T14:05:00Z" },
    ),
    /must be in approved state/,
  );
  assert.equal(calls, 1);
});

test("not-yet-active and expired approval windows fail before the atomic claimer", async () => {
  let calls = 0;
  const claimer: PostHogCanaryAtomicClaimer = async () => {
    calls += 1;
    return { status: "claimed", claimId: "unexpected" };
  };

  await assert.rejects(
    claimPostHogCanaryApproval(approval(), claimer, { now: "2026-09-05T13:59:59Z" }),
    /not active yet/,
  );
  await assert.rejects(
    claimPostHogCanaryApproval(approval(), claimer, { now: "2026-09-05T14:10:00Z" }),
    /expired/,
  );
  assert.equal(calls, 0);
});

test("malformed identity, operation, project, origin, retention, and credential references fail before claim", async () => {
  let calls = 0;
  const claimer: PostHogCanaryAtomicClaimer = async () => {
    calls += 1;
    return { status: "claimed", claimId: "unexpected" };
  };

  const invalid: PostHogCanaryApprovalInput[] = [
    approval({ project: "0" }),
    approval({ project: "project-a" }),
    approval({ origin: "https://evil.example.com" }),
    approval({ operation: "read-events" as "read-errors" }),
    approval({ retentionHours: 25 }),
    approval({ credentialRef: "https://secret.example.com/key" }),
    approval({ credentialRef: "Bearer abcdefghijklmnop" }),
    approval({ expiresAt: "2026-09-05T13:59:00Z" }),
  ];

  for (const item of invalid) {
    await assert.rejects(
      claimPostHogCanaryApproval(item, claimer, { now: "2026-09-05T14:05:00Z" }),
    );
  }
  assert.equal(calls, 0);
});

test("claimer failures and malformed results become fixed rejection categories with zero retry", async () => {
  let throwingCalls = 0;
  const throwing: PostHogCanaryAtomicClaimer = async () => {
    throwingCalls += 1;
    throw new Error("provider-shaped secret detail must not escape");
  };
  const failed = await claimPostHogCanaryApproval(approval(), throwing, {
    now: "2026-09-05T14:05:00Z",
  });
  assert.equal(throwingCalls, 1);
  assert.equal(failed.status, "rejected");
  assert.equal(failed.rejectionReason, "claimer-failure");

  let malformedCalls = 0;
  const malformed = (async () => {
    malformedCalls += 1;
    return { status: "claimed", claimId: "Bearer abcdefghijklmnop" };
  }) as PostHogCanaryAtomicClaimer;
  const invalid = await claimPostHogCanaryApproval(approval(), malformed, {
    now: "2026-09-05T14:05:00Z",
  });
  assert.equal(malformedCalls, 1);
  assert.equal(invalid.status, "rejected");
  assert.equal(invalid.rejectionReason, "invalid-claim-result");
});

test("claim result does not return credential reference, scope, tenant details, or dependency errors", async () => {
  const claimer: PostHogCanaryAtomicClaimer = async () => ({ status: "claimed", claimId: "claim-safe" });
  const result = await claimPostHogCanaryApproval(approval(), claimer, {
    now: "2026-09-05T14:05:00Z",
  });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /secret-store\/posthog\/canary-readonly/);
  assert.doesNotMatch(serialized, /verified-project-read-scope/);
  assert.doesNotMatch(serialized, /tenant:solve-owner/);
  assert.doesNotMatch(serialized, /owner-operator/);
  assert.doesNotMatch(serialized, /Authorization|Bearer|credentialRef|credentialScope/i);
  assert.equal(result.policy.credentialMaterialReturned, false);
});
