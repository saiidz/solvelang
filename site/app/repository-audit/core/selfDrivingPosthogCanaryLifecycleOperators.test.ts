import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type PostHogCanaryApprovalInput,
} from "./selfDrivingPosthogCanaryApproval";
import {
  createPostHogCanaryLifecycleRecord,
  finalizePostHogCanaryLifecycle,
  POSTHOG_CANARY_DISABLE_ACTIONS,
  type PostHogCanaryLifecycleInput,
} from "./selfDrivingPosthogCanaryLifecycle";
import {
  createPostHogCanaryRuntimeActivation,
} from "./selfDrivingPosthogCanaryRuntimeGate";
import {
  executePostHogCanaryLifecycleOperatorBoundary,
  POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA,
  POSTHOG_CANARY_LIFECYCLE_OPERATOR_PLAN_SCHEMA,
  POSTHOG_CANARY_LIFECYCLE_OPERATOR_RESULT_SCHEMA,
  type PostHogCanaryLifecycleOperatorPlan,
} from "./selfDrivingPosthogCanaryLifecycleOperators";

const CLAIMED_AT = "2026-09-12T14:00:00.000Z";
const ACTIVATED_AT = "2026-09-12T14:00:00.100Z";
const ACTIVATION_EXPIRES_AT = "2026-09-12T14:00:09.000Z";
const ENDED_AT = "2026-09-12T14:00:05.000Z";
const DELETE_BY = "2026-09-13T13:00:00.000Z";
const SOURCE_REVISION = "a".repeat(40);
const SANITIZED_DIGEST = `sha256:${"b".repeat(64)}`;

function approvalInput(overrides: Partial<PostHogCanaryApprovalInput> = {}): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-lifecycle-operator-001",
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
    notBefore: "2026-09-12T13:59:00Z",
    expiresAt: "2026-09-12T14:10:00Z",
    retentionHours: 24,
    ...overrides,
  };
}

function lifecycleInput(overrides: Partial<PostHogCanaryLifecycleInput> = {}): PostHogCanaryLifecycleInput {
  return {
    sourceRevision: SOURCE_REVISION,
    outcome: "succeeded",
    startedAt: "2026-09-12T14:00:01.000Z",
    endedAt: ENDED_AT,
    responseBytes: 1024,
    acceptedRecords: 3,
    partialReasons: [],
    sanitizedArtifactSha256: SANITIZED_DIGEST,
    evidenceDestinationRef: "private-evidence/canary-operator-001",
    authorizedReaderRefs: ["reader:owner", "reader:security"],
    deletionOwnerRef: "owner:security",
    deleteBy: DELETE_BY,
    ...overrides,
  };
}

async function fixture() {
  const input = approvalInput();
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-lifecycle-operator-001" }),
    { now: CLAIMED_AT },
  );
  assert.equal(claim.status, "claimed");

  const activation = await createPostHogCanaryRuntimeActivation(approval, claim, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-posthog-canary-v0",
    activatedAt: ACTIVATED_AT,
    expiresAt: ACTIVATION_EXPIRES_AT,
    killSwitchRef: "control/posthog/canary-kill-switch",
  });

  const record = createPostHogCanaryLifecycleRecord(approval, claim, lifecycleInput());
  const finalization = await finalizePostHogCanaryLifecycle(
    record,
    async () => ({ status: "finalized", finalizationId: "finalization-operator-001" }),
  );
  assert.equal(finalization.status, "finalized");
  return { activation, record, finalization };
}

function clock(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function evidenceFor(plan: PostHogCanaryLifecycleOperatorPlan, completedAt = "2026-09-12T14:00:05.200Z") {
  return {
    schema: POSTHOG_CANARY_LIFECYCLE_OPERATOR_EVIDENCE_SCHEMA,
    planId: plan.id,
    lifecycleId: plan.lifecycleId,
    completedAt,
    retentionEvidenceId: "retention-evidence-001",
    actionEvidence: plan.actions.map((action, index) => ({
      action,
      evidenceId: `disable-evidence-${index + 1}`,
    })),
  } as const;
}

test("qualifies exact retention and disable evidence for the finalized canary", async () => {
  const { activation, record, finalization } = await fixture();
  const plans: PostHogCanaryLifecycleOperatorPlan[] = [];
  const result = await executePostHogCanaryLifecycleOperatorBoundary(
    activation,
    record,
    finalization,
    {
      now: clock("2026-09-12T14:00:05.100Z", "2026-09-12T14:00:05.300Z"),
      operator: async (plan) => {
        plans.push(plan);
        return evidenceFor(plan);
      },
    },
  );

  assert.equal(plans.length, 1);
  const plan = plans[0]!;
  assert.equal(plan.schema, POSTHOG_CANARY_LIFECYCLE_OPERATOR_PLAN_SCHEMA);
  assert.match(plan.id, /^posthog_canary_lifecycle_operator_plan_[0-9a-f]{64}$/);
  assert.equal(plan.activationId, activation.id);
  assert.equal(plan.approvalId, record.approvalId);
  assert.equal(plan.claimId, record.claimId);
  assert.equal(plan.requestId, record.requestId);
  assert.equal(plan.lifecycleId, record.id);
  assert.equal(plan.finalizationId, "finalization-operator-001");
  assert.equal(plan.project, record.project);
  assert.equal(plan.origin, record.origin);
  assert.equal(plan.operation, record.operation);
  assert.equal(plan.credentialRef, activation.credentialRef);
  assert.equal(plan.killSwitchRef, activation.killSwitchRef);
  assert.equal(plan.evidenceDestinationRef, record.retention.evidenceDestinationRef);
  assert.equal(plan.sanitizedArtifactSha256, SANITIZED_DIGEST);
  assert.equal(plan.deleteBy, DELETE_BY);
  assert.deepEqual(plan.actions, POSTHOG_CANARY_DISABLE_ACTIONS);

  assert.equal(result.schema, POSTHOG_CANARY_LIFECYCLE_OPERATOR_RESULT_SCHEMA);
  assert.equal(result.status, "qualified");
  assert.equal(result.planId, plan.id);
  assert.equal(result.lifecycleId, record.id);
  assert.equal(result.evidenceId, "retention-evidence-001");
  assert.equal(result.completedAt, "2026-09-12T14:00:05.200Z");
  assert.deepEqual(result.actionEvidence.map((entry) => entry.action), POSTHOG_CANARY_DISABLE_ACTIONS);
  assert.equal(result.policy.operatorCalls, 1);
  assert.equal(result.policy.retries, 0);
  assert.equal(result.policy.automaticRearm, false);
  assert.equal(result.policy.builtInCredentialStoreAccess, false);
  assert.equal(result.policy.builtInKeyRevocationApiAccess, false);
  assert.equal(result.policy.builtInEvidenceStoreAccess, false);
  assert.equal(result.policy.repositoryWriteAccess, false);
  assert.equal(result.policy.rolloutMutationAccess, false);
  assert.equal(result.policy.productionMutationAccess, false);
  assert.equal(result.policy.billingMutationAccess, false);
  assert.equal(result.policy.solveRunnerAuthority, false);
  assert.equal(result.policy.rawCredentialMaterialReturned, false);
  assert.doesNotMatch(JSON.stringify(result), /Bearer|fixture_token|github_pat_/i);
});

test("rejected lifecycle finalization prevents operator execution", async () => {
  const { activation, record } = await fixture();
  const rejected = await finalizePostHogCanaryLifecycle(
    record,
    async () => ({ status: "rejected", reason: "store-rejected" }),
  );
  let operatorCalls = 0;

  await assert.rejects(
    () => executePostHogCanaryLifecycleOperatorBoundary(
      activation,
      record,
      rejected,
      {
        now: () => "2026-09-12T14:00:05.100Z",
        operator: async (plan) => {
          operatorCalls += 1;
          return evidenceFor(plan);
        },
      },
    ),
    /successful canonical lifecycle finalization/,
  );
  assert.equal(operatorCalls, 0);
});

test("activation, lifecycle policy, and disable-action drift fail before the operator", async () => {
  const { activation, record, finalization } = await fixture();
  const cases = [
    {
      activation: {
        ...activation,
        policy: { ...activation.policy, billingMutationAccess: true },
      },
      record,
    },
    {
      activation,
      record: {
        ...record,
        policy: { ...record.policy, maxResponseBytes: record.policy.maxResponseBytes + 1 },
      },
    },
    {
      activation,
      record: {
        ...record,
        disable: { ...record.disable, actions: POSTHOG_CANARY_DISABLE_ACTIONS.slice(0, -1) },
      },
    },
  ];

  for (const candidate of cases) {
    let operatorCalls = 0;
    await assert.rejects(
      () => executePostHogCanaryLifecycleOperatorBoundary(
        candidate.activation as never,
        candidate.record as never,
        finalization,
        {
          now: () => "2026-09-12T14:00:05.100Z",
          operator: async (plan) => {
            operatorCalls += 1;
            return evidenceFor(plan);
          },
        },
      ),
    );
    assert.equal(operatorCalls, 0);
  }
});

test("operator evidence must bind the exact plan and cover every disable action exactly once", async () => {
  const { activation, record, finalization } = await fixture();
  const badEvidenceFactories = [
    (plan: PostHogCanaryLifecycleOperatorPlan) => ({
      ...evidenceFor(plan),
      planId: `${plan.id}-drift`,
    }),
    (plan: PostHogCanaryLifecycleOperatorPlan) => ({
      ...evidenceFor(plan),
      actionEvidence: evidenceFor(plan).actionEvidence.slice(0, -1),
    }),
    (plan: PostHogCanaryLifecycleOperatorPlan) => ({
      ...evidenceFor(plan),
      actionEvidence: [
        ...evidenceFor(plan).actionEvidence.slice(0, -1),
        evidenceFor(plan).actionEvidence[0]!,
      ],
    }),
    (plan: PostHogCanaryLifecycleOperatorPlan) => ({
      ...evidenceFor(plan),
      unexpected: "field",
    }),
  ];

  for (const badEvidence of badEvidenceFactories) {
    await assert.rejects(
      () => executePostHogCanaryLifecycleOperatorBoundary(
        activation,
        record,
        finalization,
        {
          now: clock("2026-09-12T14:00:05.100Z", "2026-09-12T14:00:05.300Z"),
          operator: async (plan) => badEvidence(plan) as never,
        },
      ),
    );
  }
});

test("operator failures are sanitized and post-await deletion deadline is revalidated", async () => {
  const { activation, record, finalization } = await fixture();
  let message = "";
  try {
    await executePostHogCanaryLifecycleOperatorBoundary(
      activation,
      record,
      finalization,
      {
        now: () => "2026-09-12T14:00:05.100Z",
        operator: async () => {
          throw new Error("secret Bearer fixture_token_12345678");
        },
      },
    );
    assert.fail("expected operator failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "PostHog lifecycle operator execution failed.");
  assert.doesNotMatch(message, /Bearer|fixture_token/i);

  let operatorCalls = 0;
  await assert.rejects(
    () => executePostHogCanaryLifecycleOperatorBoundary(
      activation,
      record,
      finalization,
      {
        now: clock("2026-09-13T12:59:59.000Z", "2026-09-13T13:00:00.001Z"),
        operator: async (plan) => {
          operatorCalls += 1;
          return evidenceFor(plan, "2026-09-13T12:59:59.500Z");
        },
      },
    ),
    /deletion deadline/,
  );
  assert.equal(operatorCalls, 1);
});

test("operator evidence timestamps cannot precede the plan or exceed the observed callback interval", async () => {
  const { activation, record, finalization } = await fixture();
  for (const completedAt of [
    "2026-09-12T14:00:05.050Z",
    "2026-09-12T14:00:05.350Z",
  ]) {
    await assert.rejects(
      () => executePostHogCanaryLifecycleOperatorBoundary(
        activation,
        record,
        finalization,
        {
          now: clock("2026-09-12T14:00:05.100Z", "2026-09-12T14:00:05.300Z"),
          operator: async (plan) => evidenceFor(plan, completedAt),
        },
      ),
      /outside the observed operator interval/,
    );
  }
});
