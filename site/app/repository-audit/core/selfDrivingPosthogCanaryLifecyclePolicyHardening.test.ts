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
  createPostHogCanaryLifecycleRecord,
  finalizePostHogCanaryLifecycle,
  type PostHogCanaryLifecycleInput,
  type PostHogCanaryLifecycleRecord,
} from "./selfDrivingPosthogCanaryLifecycle";

const SOURCE_REVISION = "c".repeat(40);
const SANITIZED_DIGEST = `sha256:${"d".repeat(64)}`;

function approvalInput(): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-lifecycle-policy-001",
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
    notBefore: "2026-09-12T10:59:00Z",
    expiresAt: "2026-09-12T11:10:00Z",
    retentionHours: 24,
  };
}

function lifecycleInput(): PostHogCanaryLifecycleInput {
  return {
    sourceRevision: SOURCE_REVISION,
    outcome: "succeeded",
    startedAt: "2026-09-12T11:00:01Z",
    endedAt: "2026-09-12T11:00:05Z",
    responseBytes: 1024,
    acceptedRecords: 3,
    partialReasons: [],
    sanitizedArtifactSha256: SANITIZED_DIGEST,
    evidenceDestinationRef: "private-evidence/canary-policy-001",
    authorizedReaderRefs: ["reader:owner"],
    deletionOwnerRef: "owner:security",
    deleteBy: "2026-09-13T10:00:05Z",
  };
}

async function fixture() {
  const input = approvalInput();
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-lifecycle-policy-001" }),
    { now: "2026-09-12T11:00:00Z" },
  );
  assert.equal(claim.status, "claimed");
  return { approval, claim };
}

test("lifecycle creation rejects every omitted deny-authority claim mutation and extra policy keys", async () => {
  const { approval, claim } = await fixture();
  for (const field of ["rolloutMutationAccess", "billingMutationAccess", "solveRunnerAuthority"] as const) {
    const forged = {
      ...claim,
      policy: { ...claim.policy, [field]: true },
    } as unknown as PostHogCanaryClaimResult;
    assert.throws(
      () => createPostHogCanaryLifecycleRecord(approval, forged, lifecycleInput()),
      /claim binding or policy does not match/,
    );
  }

  const extraPolicyField = {
    ...claim,
    policy: { ...claim.policy, unexpectedAuthority: false },
  } as unknown as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, extraPolicyField, lifecycleInput()),
    /claim binding or policy does not match/,
  );
});

test("lifecycle creation rejects extra top-level claim fields instead of accepting deserialized drift", async () => {
  const { approval, claim } = await fixture();
  const forged = {
    ...claim,
    unexpectedField: "must-not-exist",
  } as unknown as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, forged, lifecycleInput()),
    /claim binding or policy does not match/,
  );
});

test("finalization rejects authority and safety-bound policy drift before invoking the dependency", async () => {
  const { approval, claim } = await fixture();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  const mutations: Array<Record<string, unknown>> = [
    { rolloutMutationAccess: true },
    { billingMutationAccess: true },
    { solveRunnerAuthority: true },
    { maxResponseBytes: 262145 },
    { maxAcceptedRecords: 26 },
    { totalDeadlineMs: 10001 },
    { unexpectedAuthority: false },
  ];

  for (const mutation of mutations) {
    let calls = 0;
    const forged = {
      ...record,
      policy: { ...record.policy, ...mutation },
    } as unknown as PostHogCanaryLifecycleRecord;
    await assert.rejects(
      () => finalizePostHogCanaryLifecycle(forged, async () => {
        calls += 1;
        return { status: "finalized", finalizationId: "must-not-run" };
      }),
      /safe canonical lifecycle policy boundary/,
    );
    assert.equal(calls, 0);
  }
});

test("canonical lifecycle still finalizes exactly once after exact policy hardening", async () => {
  const { approval, claim } = await fixture();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  let calls = 0;
  const result = await finalizePostHogCanaryLifecycle(record, async (request) => {
    calls += 1;
    assert.equal(request.approvalId, approval.approvalId);
    assert.equal(request.claimId, claim.claimId);
    assert.equal(request.lifecycleId, record.id);
    return { status: "finalized", finalizationId: "final-lifecycle-policy-001" };
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "finalized");
  assert.equal(result.finalizationId, "final-lifecycle-policy-001");
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
});
