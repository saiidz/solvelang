import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type NormalizedPostHogCanaryApproval,
  type PostHogCanaryApprovalInput,
  type PostHogCanaryClaimResult,
} from "./selfDrivingPosthogCanaryApproval";
import {
  createPostHogCanaryLifecycleRecord,
  defaultPostHogCanaryLifecycleLimits,
  finalizePostHogCanaryLifecycle,
  POSTHOG_CANARY_DISABLE_ACTIONS,
  type PostHogCanaryFinalizer,
  type PostHogCanaryLifecycleInput,
} from "./selfDrivingPosthogCanaryLifecycle";

const SOURCE_REVISION = "a".repeat(40);
const SANITIZED_DIGEST = `sha256:${"b".repeat(64)}`;

function approvalInput(overrides: Partial<PostHogCanaryApprovalInput> = {}): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-lifecycle-001",
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

async function approvalAndClaim(
  overrides: Partial<PostHogCanaryApprovalInput> = {},
): Promise<{ approval: NormalizedPostHogCanaryApproval; claim: PostHogCanaryClaimResult }> {
  const input = approvalInput(overrides);
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-lifecycle-001" }),
    { now: "2026-09-05T14:00:00Z" },
  );
  assert.equal(claim.status, "claimed");
  return { approval, claim };
}

function lifecycleInput(overrides: Partial<PostHogCanaryLifecycleInput> = {}): PostHogCanaryLifecycleInput {
  return {
    sourceRevision: SOURCE_REVISION,
    outcome: "succeeded",
    startedAt: "2026-09-05T14:00:01Z",
    endedAt: "2026-09-05T14:00:05Z",
    responseBytes: 1024,
    acceptedRecords: 3,
    partialReasons: ["collection-truncated"],
    sanitizedArtifactSha256: SANITIZED_DIGEST,
    evidenceDestinationRef: "private-evidence/canary-001",
    authorizedReaderRefs: ["reader:security", "reader:owner"],
    deletionOwnerRef: "owner:security",
    deleteBy: "2026-09-06T13:00:00Z",
    ...overrides,
  };
}

test("lifecycle records only bounded sanitized audit metadata for one claimed canary", async () => {
  const { approval, claim } = await approvalAndClaim();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());

  assert.equal(record.schema, "solvelang.self-driving.posthog-canary-lifecycle.v0");
  assert.equal(record.mode, "sanitized-evidence-only");
  assert.match(record.id, /^canary_lifecycle_[0-9a-f]{16}$/);
  assert.equal(record.approvalId, "approval-lifecycle-001");
  assert.equal(record.claimId, "claim-lifecycle-001");
  assert.equal(record.requestId, approval.requestPlan.request.id);
  assert.equal(record.sourceRevision, SOURCE_REVISION);
  assert.equal(record.adapterRevision, "adapter-revision-001");
  assert.equal(record.project, "12345");
  assert.equal(record.origin, "https://us.posthog.com");
  assert.equal(record.operation, "read-errors");
  assert.equal(record.outcome, "succeeded");
  assert.equal(record.failureCategory, undefined);
  assert.equal(record.attemptCount, 1);
  assert.equal(record.durationMs, 5000);
  assert.equal(record.responseBytes, 1024);
  assert.equal(record.acceptedRecords, 3);
  assert.deepEqual(record.partialReasons, ["collection-truncated"]);
  assert.equal(record.sanitizedArtifactSha256, SANITIZED_DIGEST);
  assert.deepEqual(record.retention.authorizedReaderRefs, ["reader:owner", "reader:security"]);
  assert.equal(record.retention.retentionHoursCeiling, 24);
  assert.equal(record.disable.status, "required-actions-not-executed");
  assert.deepEqual(record.disable.actions, POSTHOG_CANARY_DISABLE_ACTIONS);
  assert.equal(record.disable.deleteSanitizedEvidenceBy, "2026-09-06T13:00:00.000Z");
  assert.equal(record.policy.rawProviderPayloadRetained, false);
  assert.equal(record.policy.rawProviderDigestAllowed, false);
  assert.equal(record.policy.sanitizedArtifactOnly, true);
  assert.equal(record.policy.maxAttempts, 1);
  assert.equal(record.policy.retries, 0);
  assert.equal(record.policy.automaticRearm, false);
  assert.equal(record.policy.maxResponseBytes, 262144);
  assert.equal(record.policy.maxAcceptedRecords, 25);
  assert.equal(record.policy.totalDeadlineMs, 10000);
  assert.equal(record.policy.credentialResolutionAccess, false);
  assert.equal(record.policy.providerNetworkAccess, false);
  assert.equal(record.policy.durableSinkAccess, false);
  assert.equal(record.policy.keyRevocationApiAccess, false);
  assert.equal(record.policy.repositoryWriteAccess, false);
  assert.equal(record.policy.productionMutationAccess, false);
  assert.equal(record.policy.externalSideEffects, false);
});

test("lifecycle output excludes approval credential, scope, tenant, runtime operator and raw provider material", async () => {
  const { approval, claim } = await approvalAndClaim();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  const serialized = JSON.stringify(record);

  assert.doesNotMatch(serialized, /secret-store\/posthog\/canary-readonly/);
  assert.doesNotMatch(serialized, /verified-project-read-scope/);
  assert.doesNotMatch(serialized, /tenant:solve-owner/);
  assert.doesNotMatch(serialized, /owner-operator/);
  assert.doesNotMatch(serialized, /isolated-canary-runtime/);
  assert.doesNotMatch(serialized, /Authorization|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_/i);
  assert.doesNotMatch(serialized, /rawProvider|responseBody|requestBody|headers|cookies/i);
});

test("successful, failed, and cancelled lifecycle outcomes use fixed truth rules", async () => {
  const { approval, claim } = await approvalAndClaim();
  const success = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  assert.equal(success.outcome, "succeeded");
  assert.equal(success.failureCategory, undefined);

  const failed = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    outcome: "failed",
    failureCategory: "sanitization-rejected",
    sanitizedArtifactSha256: null,
    acceptedRecords: 0,
  }));
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.failureCategory, "sanitization-rejected");

  const cancelled = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    outcome: "cancelled",
    responseBytes: 0,
    acceptedRecords: 0,
    partialReasons: [],
    sanitizedArtifactSha256: null,
  }));
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.failureCategory, undefined);

  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      outcome: "succeeded",
      failureCategory: "provider-error",
    })),
    /Successful canary evidence must not include a failure category/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      outcome: "failed",
      failureCategory: undefined,
    })),
    /requires one supported fixed failure category/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      outcome: "cancelled",
      failureCategory: "timeout",
    })),
    /fixed cancelled outcome/,
  );
});

test("successful evidence requires an explicit SHA-256 digest of the sanitized artifact only", async () => {
  const { approval, claim } = await approvalAndClaim();
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({ sanitizedArtifactSha256: null })),
    /requires a digest of the sanitized artifact/,
  );
  for (const digest of ["b".repeat(64), "sha256:short", `md5:${"b".repeat(32)}`]) {
    assert.throws(
      () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({ sanitizedArtifactSha256: digest })),
      /explicit SHA-256 digest of the sanitized artifact/,
      digest,
    );
  }
});

test("lifecycle fails closed on approval or claim identity and policy mismatch", async () => {
  const { approval, claim } = await approvalAndClaim();
  const wrongApproval = { ...claim, approvalId: "approval-other" } as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, wrongApproval, lifecycleInput()),
    /claim binding or policy does not match/,
  );
  const wrongRequest = { ...claim, requestId: "phr_other" } as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, wrongRequest, lifecycleInput()),
    /claim binding or policy does not match/,
  );
  const forgedPolicy = {
    ...claim,
    policy: { ...claim.policy, providerNetworkAccess: true },
  } as unknown as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, forgedPolicy, lifecycleInput()),
    /claim binding or policy does not match/,
  );
  const rejected = { ...claim, status: "rejected", claimId: undefined } as PostHogCanaryClaimResult;
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, rejected, lifecycleInput()),
    /requires a successful single-use approval claim/,
  );
});

test("lifecycle enforces the one-run total deadline and monotonic timestamps", async () => {
  const { approval, claim } = await approvalAndClaim();
  const exactlyTenSeconds = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    startedAt: "2026-09-05T14:00:01Z",
    endedAt: "2026-09-05T14:00:10Z",
  }));
  assert.equal(exactlyTenSeconds.durationMs, 10000);

  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      endedAt: "2026-09-05T14:00:10.001Z",
    })),
    /exceeds the 10000ms total deadline/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      startedAt: "2026-09-05T13:59:59Z",
    })),
    /must not precede the successful approval claim/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      startedAt: "2026-09-05T14:00:06Z",
      endedAt: "2026-09-05T14:00:05Z",
    })),
    /endedAt must not precede startedAt/,
  );
});

test("lifecycle enforces response byte and accepted-record ceilings", async () => {
  const { approval, claim } = await approvalAndClaim();
  const maxed = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    responseBytes: defaultPostHogCanaryLifecycleLimits.maxResponseBytes,
    acceptedRecords: defaultPostHogCanaryLifecycleLimits.maxAcceptedRecords,
  }));
  assert.equal(maxed.responseBytes, 262144);
  assert.equal(maxed.acceptedRecords, 25);

  for (const [field, value] of [
    ["responseBytes", 262145],
    ["responseBytes", -1],
    ["acceptedRecords", 26],
    ["acceptedRecords", -1],
  ] as const) {
    assert.throws(
      () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({ [field]: value })),
      /must be a safe integer between/,
      `${field}=${value}`,
    );
  }
});

test("lifecycle enforces the owner-approved sanitized evidence retention ceiling", async () => {
  const { approval, claim } = await approvalAndClaim({ retentionHours: 2 });
  const valid = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    deleteBy: "2026-09-05T16:00:05Z",
  }));
  assert.equal(valid.retention.retentionHoursCeiling, 2);

  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      deleteBy: "2026-09-05T16:00:05.001Z",
    })),
    /exceeds the owner-approved sanitized evidence retention ceiling/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      deleteBy: "2026-09-05T14:00:05Z",
    })),
    /deleteBy must be after the canary endedAt/,
  );
});

test("lifecycle rejects unsafe destination, reader, owner, partiality and source metadata", async () => {
  const { approval, claim } = await approvalAndClaim();
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({ sourceRevision: "main" })),
    /exact 40- or 64-hex revision/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      evidenceDestinationRef: "https://example.com/evidence",
    })),
    /opaque reference, not a URL/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      deletionOwnerRef: "Bearer abcdefghijklmnop",
    })),
    /credential-like material/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      authorizedReaderRefs: ["reader:owner", "reader:owner"],
    })),
    /contains duplicate values/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      authorizedReaderRefs: Array.from(
        { length: defaultPostHogCanaryLifecycleLimits.maxAuthorizedReaders + 1 },
        (_, index) => `reader:${index}`,
      ),
    })),
    /reader safety bound/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      partialReasons: ["source-partial", "source-partial"],
    })),
    /partialReasons contains duplicate values/,
  );
  assert.throws(
    () => createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      partialReasons: ["causality-inferred" as "source-partial"],
    })),
    /unsupported reason/,
  );
});

test("lifecycle is deterministic for equivalent partiality and reader ordering", async () => {
  const { approval, claim } = await approvalAndClaim();
  const forward = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    partialReasons: ["source-partial", "collection-truncated"],
    authorizedReaderRefs: ["reader:security", "reader:owner"],
  }));
  const reverse = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
    partialReasons: ["collection-truncated", "source-partial"],
    authorizedReaderRefs: ["reader:owner", "reader:security"],
  }));
  assert.deepEqual(forward, reverse);
});

test("finalizer is called once and consumes success while invalidating failed/cancelled attempts", async () => {
  const { approval, claim } = await approvalAndClaim();
  for (const [outcome, terminalState] of [
    ["succeeded", "consumed"],
    ["failed", "invalidated"],
    ["cancelled", "invalidated"],
  ] as const) {
    const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput({
      outcome,
      ...(outcome === "failed" ? { failureCategory: "provider-error" as const } : {}),
      ...(outcome === "cancelled" ? {
        responseBytes: 0,
        acceptedRecords: 0,
        partialReasons: [],
        sanitizedArtifactSha256: null,
      } : {}),
    }));
    let calls = 0;
    const finalizer: PostHogCanaryFinalizer = async (request) => {
      calls += 1;
      assert.equal(request.approvalId, record.approvalId);
      assert.equal(request.claimId, record.claimId);
      assert.equal(request.requestId, record.requestId);
      assert.equal(request.lifecycleId, record.id);
      assert.equal(request.terminalState, terminalState);
      return { status: "finalized", finalizationId: `final-${outcome}` };
    };
    const result = await finalizePostHogCanaryLifecycle(record, finalizer);
    assert.equal(calls, 1);
    assert.equal(result.status, "finalized");
    assert.equal(result.terminalState, terminalState);
    assert.equal(result.finalizationId, `final-${outcome}`);
    assert.equal(result.policy.finalizerCalls, 1);
    assert.equal(result.policy.retries, 0);
    assert.equal(result.policy.automaticRearm, false);
    assert.equal(result.policy.credentialResolutionAccess, false);
    assert.equal(result.policy.providerNetworkAccess, false);
    assert.equal(result.policy.durableSinkAccess, false);
    assert.equal(result.policy.repositoryWriteAccess, false);
    assert.equal(result.policy.productionMutationAccess, false);
    assert.equal(result.policy.credentialMaterialReturned, false);
  }
});

test("finalizer throws and malformed results become fixed rejections with no retry", async () => {
  const { approval, claim } = await approvalAndClaim();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());

  let throwCalls = 0;
  const failed = await finalizePostHogCanaryLifecycle(record, async () => {
    throwCalls += 1;
    throw new Error("Bearer abcdefghijklmnop provider detail");
  });
  assert.equal(throwCalls, 1);
  assert.equal(failed.status, "rejected");
  assert.equal(failed.rejectionReason, "finalizer-failure");

  let malformedCalls = 0;
  const malformed = await finalizePostHogCanaryLifecycle(record, (async () => {
    malformedCalls += 1;
    return { status: "finalized", finalizationId: "Bearer abcdefghijklmnop" };
  }) as PostHogCanaryFinalizer);
  assert.equal(malformedCalls, 1);
  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.rejectionReason, "invalid-finalizer-result");
});

test("replayed finalization remains non-reusable and never re-arms the approval", async () => {
  const { approval, claim } = await approvalAndClaim();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  let finalized = false;
  const finalizer: PostHogCanaryFinalizer = async () => {
    if (finalized) return { status: "rejected", reason: "already-finalized" };
    finalized = true;
    return { status: "finalized", finalizationId: "final-once" };
  };

  const first = await finalizePostHogCanaryLifecycle(record, finalizer);
  const second = await finalizePostHogCanaryLifecycle(record, finalizer);
  assert.equal(first.status, "finalized");
  assert.equal(second.status, "rejected");
  assert.equal(second.rejectionReason, "already-finalized");
  assert.equal(second.policy.retries, 0);
  assert.equal(second.policy.automaticRearm, false);
});

test("serialized finalization result returns no credential material or finalizer error detail", async () => {
  const { approval, claim } = await approvalAndClaim();
  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  const result = await finalizePostHogCanaryLifecycle(record, async () => ({
    status: "finalized",
    finalizationId: "final-safe",
  }));
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /secret-store|verified-project-read-scope|tenant:solve-owner|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|github_pat_/i);
  assert.equal(result.policy.credentialMaterialReturned, false);
  assert.equal(result.policy.providerNetworkAccess, false);
});
