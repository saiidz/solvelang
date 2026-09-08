import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelfDrivingGitHubInstallationActivation,
  createSelfDrivingGitHubInstallationRuntimeAdapter,
  SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA,
  type SelfDrivingGitHubInstallationCredential,
  type SelfDrivingGitHubInstallationCredentialProvider,
  type SelfDrivingGitHubInstallationRuntimeDependencies,
} from "./selfDrivingGithubInstallationRuntimeGate";
import type {
  SelfDrivingGitHubRestTransport,
  SelfDrivingGitHubRestTransportRequest,
  SelfDrivingGitHubRestTransportResponse,
} from "./selfDrivingGithubRestTransport";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const TOKEN = "ghs_fixture_installation_token_1234567890";
const TOKEN_TWO = "ghs_fixture_installation_token_0987654321";
const INSTALLATION_REF = "github-app/installation:12345";
const CLAIMED_AT = "2026-09-08T08:00:00Z";
const ACTIVE_AT = "2026-09-08T08:00:30Z";
const ISSUED_AT = "2026-09-08T08:00:20Z";
const TOKEN_EXPIRES_AT = "2026-09-08T09:00:20Z";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function executionPlan(overrides: Partial<SelfDrivingPrWriteExecutionPlan> = {}): Promise<SelfDrivingPrWriteExecutionPlan> {
  const seed = {
    schema: "solvelang.self-driving.pr-write-execution-plan.v0" as const,
    mode: "no-write-execution-plan" as const,
    status: "ready-for-separate-github-executor" as const,
    id: "pr_write_plan_pending",
    repository: "saiidz/solvelang",
    baseBranch: "main",
    baseRevision: BASE,
    headBranch: "solve/review/runtime-gate",
    installationRef: INSTALLATION_REF,
    approvalId: "approval-runtime-gate",
    approvalBindingSha256: "1".repeat(64),
    claimId: "claim-runtime-gate",
    claimedAt: CLAIMED_AT,
    requiredPermissions: { metadata: "read" as const, contents: "write" as const, pullRequests: "write" as const },
    plannedActions: ["create-branch", "create-commit", "open-pr"] as const,
    requiredLiveChecks: [
      "verify-exact-base-revision",
      "verify-fresh-branch-protection",
      "verify-head-branch-absent",
      "verify-base-blob-shas",
    ] as const,
    branchProtectionEvidence: {
      protectedBranches: ["main"],
      requiresPullRequest: true as const,
      allowsForcePush: false as const,
      requiredApprovals: 1,
      requiredChecks: ["CI", "Rust", "WASM artifact security"],
      observedAt: "2026-09-08T07:59:00Z",
      evidenceLocator: "github:rules:runtime-gate",
    },
    selectedProposals: [{
      validationId: "validation-runtime-gate",
      patchProposalId: "patch-runtime-gate",
      suggestionProposalId: "suggestion-runtime-gate",
      findingId: "finding-runtime-gate",
      severity: "high" as const,
    }],
    files: [{
      proposalId: "patch-runtime-gate",
      validationId: "validation-runtime-gate",
      suggestionProposalId: "suggestion-runtime-gate",
      findingId: "finding-runtime-gate",
      path: "site/app/a.ts",
      baseBlobSha: BLOB,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] }],
    }],
    limits: {
      maxSelectedProposals: 25,
      maxFiles: 50,
      maxHunks: 256,
      maxLines: 2500,
      maxPatchBytes: 131072,
      maxClaimIdLength: 128,
    },
    totals: { proposals: 1, files: 1, hunks: 1, lines: 2, patchBytes: 8 },
    policy: {
      sourceArtifactsRecreated: true as const,
      cryptographicApprovalBindingVerified: true as const,
      successfulSingleUseClaimRequired: true as const,
      exactBaseRevisionRequiredAtExecution: true as const,
      freshBranchProtectionRequiredAtExecution: true as const,
      headBranchMustNotExistAtExecution: true as const,
      baseBlobShaMatchRequiredAtExecution: true as const,
      directPushToBaseAllowed: false as const,
      directPushToProtectedBranchAllowed: false as const,
      forcePushAllowed: false as const,
      automaticMergeAllowed: false as const,
      credentialResolutionAccess: false as const,
      githubApiAccess: false as const,
      branchCreationAccess: false as const,
      commitWriteAccess: false as const,
      pullRequestCreationAccess: false as const,
      patchApplicationAccess: false as const,
      shellExecutionAccess: false as const,
      repositoryWriteAccess: false as const,
      providerAccess: false as const,
      networkAccess: false as const,
      rolloutMutationAccess: false as const,
      productionMutationAccess: false as const,
      billingMutationAccess: false as const,
      solveRunnerAuthority: false as const,
      externalSideEffects: false as const,
      writeExecutionStatus: "not-executed" as const,
    },
  };
  const merged = { ...seed, ...overrides } as SelfDrivingPrWriteExecutionPlan;
  const canonical = {
    repository: merged.repository,
    baseBranch: merged.baseBranch,
    baseRevision: merged.baseRevision,
    headBranch: merged.headBranch,
    installationRef: merged.installationRef,
    approvalId: merged.approvalId,
    approvalBindingSha256: merged.approvalBindingSha256,
    claimId: merged.claimId,
    claimedAt: merged.claimedAt,
    requiredPermissions: merged.requiredPermissions,
    plannedActions: merged.plannedActions,
    requiredLiveChecks: merged.requiredLiveChecks,
    branchProtectionEvidence: merged.branchProtectionEvidence,
    selectedProposals: merged.selectedProposals,
    files: merged.files,
    limits: merged.limits,
    totals: merged.totals,
  };
  return { ...merged, id: `pr_write_plan_${await sha256Hex(JSON.stringify(canonical))}` };
}

async function activation(plan: SelfDrivingPrWriteExecutionPlan) {
  return createSelfDrivingGitHubInstallationActivation(plan, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-github-pr-writer-v0",
    notBefore: "2026-09-08T08:00:10Z",
    expiresAt: "2026-09-08T08:10:10Z",
  });
}

function credential(overrides: Partial<SelfDrivingGitHubInstallationCredential> = {}): SelfDrivingGitHubInstallationCredential {
  return {
    token: TOKEN,
    credentialId: "credential-session-runtime-gate",
    installationRef: INSTALLATION_REF,
    repositories: ["saiidz/solvelang"],
    permissions: { metadata: "read", contents: "write", pullRequests: "write" },
    issuedAt: ISSUED_AT,
    expiresAt: TOKEN_EXPIRES_AT,
    ...overrides,
  };
}

function response(
  request: SelfDrivingGitHubRestTransportRequest,
  status: number,
  body: unknown,
): SelfDrivingGitHubRestTransportResponse {
  return {
    status,
    url: request.url,
    bodyText: JSON.stringify(body),
    contentType: "application/json",
  };
}

function firstBranchTransport(calls: SelfDrivingGitHubRestTransportRequest[]): SelfDrivingGitHubRestTransport {
  return async (request) => {
    calls.push(request);
    if (request.url.endsWith("/branches/main")) {
      return response(request, 200, { name: "main", protected: true, commit: { sha: BASE } });
    }
    throw new Error("unexpected second transport call");
  };
}

function dependencies(options: Partial<SelfDrivingGitHubInstallationRuntimeDependencies> & {
  transportCalls?: SelfDrivingGitHubRestTransportRequest[];
  gateCalls?: unknown[];
  providerCalls?: unknown[];
} = {}): SelfDrivingGitHubInstallationRuntimeDependencies {
  const transportCalls = options.transportCalls ?? [];
  const gateCalls = options.gateCalls ?? [];
  const providerCalls = options.providerCalls ?? [];
  return {
    runtimeGate: options.runtimeGate ?? (async (request) => {
      gateCalls.push(request);
      return { status: "allowed", activationId: request.activationId, gateEvidenceId: "gate-evidence-runtime" };
    }),
    credentialProvider: options.credentialProvider ?? (async (request, withCredential) => {
      providerCalls.push(request);
      return withCredential(credential());
    }),
    transport: options.transport ?? firstBranchTransport(transportCalls),
    now: options.now ?? (() => ACTIVE_AT),
  };
}

test("activation is deterministic, plan-bound, short-lived, and contains no credential material", async () => {
  const plan = await executionPlan();
  const first = await activation(plan);
  const second = await activation(plan);
  assert.equal(first.schema, SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA);
  assert.equal(first.id, second.id);
  assert.equal(first.planId, plan.id);
  assert.equal(first.repository, "saiidz/solvelang");
  assert.equal(first.installationRef, INSTALLATION_REF);
  assert.equal(first.installationId, 12345);
  assert.deepEqual(first.permissions, { metadata: "read", contents: "write", pullRequests: "write" });
  assert.equal(first.policy.disabledByDefault, true);
  assert.equal(first.policy.privateKeyAccess, false);
  assert.equal(first.policy.jwtMintingAccess, false);
  assert.equal(first.policy.tokenReturnAllowed, false);
  assert.doesNotMatch(JSON.stringify(first), /ghs_|Bearer|PRIVATE KEY|github_pat_/i);
});

test("activation rejects forged plan identity, invalid installation syntax, pre-claim start, and oversized window", async () => {
  const plan = await executionPlan();
  await assert.rejects(
    () => createSelfDrivingGitHubInstallationActivation({ ...plan, id: `pr_write_plan_${"0".repeat(64)}` }, {
      state: "approved", operator: "owner", runtime: "runtime", notBefore: "2026-09-08T08:00:10Z", expiresAt: "2026-09-08T08:01:10Z",
    }),
    /SHA-256 identity/,
  );
  const badInstallation = await executionPlan({ installationRef: "github-app/installation:0" });
  await assert.rejects(() => activation(badInstallation), /installation:<positive-id>/);
  await assert.rejects(
    () => createSelfDrivingGitHubInstallationActivation(plan, {
      state: "approved", operator: "owner", runtime: "runtime", notBefore: "2026-09-08T07:59:59Z", expiresAt: "2026-09-08T08:01:00Z",
    }),
    /may not begin before/,
  );
  await assert.rejects(
    () => createSelfDrivingGitHubInstallationActivation(plan, {
      state: "approved", operator: "owner", runtime: "runtime", notBefore: "2026-09-08T08:00:10Z", expiresAt: "2026-09-08T08:15:11Z",
    }),
    /15-minute window/,
  );
});

test("blocked runtime gate prevents credential access and network access", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  let providerCalls = 0;
  let transportCalls = 0;
  const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
    runtimeGate: async () => ({ status: "blocked", reason: "kill-switch" }),
    credentialProvider: async (_request, _withCredential) => {
      providerCalls += 1;
      throw new Error("must not run");
    },
    transport: async () => {
      transportCalls += 1;
      throw new Error("must not run");
    },
  }));
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /credential-broker-failed/);
  assert.equal(providerCalls, 0);
  assert.equal(transportCalls, 0);
});

test("credential request is exact one-repository least privilege and gate runs first", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const order: string[] = [];
  const transportCalls: SelfDrivingGitHubRestTransportRequest[] = [];
  const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
    runtimeGate: async (request) => {
      order.push("gate");
      assert.equal(request.activationId, active.id);
      assert.equal(request.repository, plan.repository);
      assert.equal(request.installationId, 12345);
      assert.equal(request.permission, "contents:read");
      return { status: "allowed", activationId: request.activationId, gateEvidenceId: "gate-evidence-exact" };
    },
    credentialProvider: async (request, withCredential) => {
      order.push("credential");
      assert.deepEqual(request.repositories, [plan.repository]);
      assert.deepEqual(request.permissions, { metadata: "read", contents: "write", pullRequests: "write" });
      assert.equal(request.permission, "contents:read");
      return withCredential(credential());
    },
    transport: async (request) => {
      order.push("transport");
      transportCalls.push(request);
      throw new Error("stop after exact credential request");
    },
  }));
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /transport-failed/);
  assert.deepEqual(order, ["gate", "credential", "transport"]);
  assert.equal(transportCalls.length, 1);
  assert.equal(transportCalls[0].headers.Authorization, `Bearer ${TOKEN}`);
});

test("broad repository scope, permission drift, stale lifetime, or pre-activation issuance never reaches transport", async () => {
  const cases: SelfDrivingGitHubInstallationCredential[] = [
    credential({ repositories: ["saiidz/solvelang", "saiidz/other"] }),
    credential({ permissions: { metadata: "read", contents: "read" as "write", pullRequests: "write" } }),
    credential({ expiresAt: "2026-09-08T08:00:40Z" }),
    credential({ issuedAt: "2026-09-08T08:00:00Z" }),
  ];
  for (const value of cases) {
    const plan = await executionPlan();
    const active = await activation(plan);
    let transports = 0;
    const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
      credentialProvider: async (_request, withCredential) => withCredential(value),
      transport: async () => {
        transports += 1;
        throw new Error("must not run");
      },
    }));
    await assert.rejects(() => adapter.verifyLivePreflight(plan), /credential-broker-failed/);
    assert.equal(transports, 0);
  }
});

test("credential provider must reuse the same actual token session across one execution", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  let providerCalls = 0;
  const transportCalls: SelfDrivingGitHubRestTransportRequest[] = [];
  const provider: SelfDrivingGitHubInstallationCredentialProvider = async (_request, withCredential) => {
    providerCalls += 1;
    return withCredential(credential({ token: providerCalls === 1 ? TOKEN : TOKEN_TWO }));
  };
  const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
    credentialProvider: provider,
    transport: firstBranchTransport(transportCalls),
  }));
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /credential-broker-failed/);
  assert.equal(providerCalls, 2);
  assert.equal(transportCalls.length, 1);
});

test("runtime gate is checked before every credential use and a second-use kill switch stops before transport", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  let gates = 0;
  let providers = 0;
  const transportCalls: SelfDrivingGitHubRestTransportRequest[] = [];
  const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
    runtimeGate: async (request) => {
      gates += 1;
      return gates === 1
        ? { status: "allowed", activationId: request.activationId, gateEvidenceId: "gate-first" }
        : { status: "blocked", reason: "kill-switch" };
    },
    credentialProvider: async (_request, withCredential) => {
      providers += 1;
      return withCredential(credential());
    },
    transport: firstBranchTransport(transportCalls),
  }));
  await assert.rejects(() => adapter.verifyLivePreflight(plan), /credential-broker-failed/);
  assert.equal(gates, 2);
  assert.equal(providers, 1);
  assert.equal(transportCalls.length, 1);
});

test("provider re-entry, swallowed callback failure, or replaced callback result fails terminally", async () => {
  const providers: SelfDrivingGitHubInstallationCredentialProvider[] = [
    async (_request, withCredential) => {
      const first = await withCredential(credential());
      try { await withCredential(credential()); } catch { /* expected */ }
      return first;
    },
    async (_request, withCredential) => {
      try { await withCredential(credential()); } catch { /* hostile swallow */ }
      return { hostile: true } as never;
    },
    async (_request, withCredential) => {
      await withCredential(credential());
      return { replaced: true } as never;
    },
  ];
  for (const provider of providers) {
    const plan = await executionPlan();
    const active = await activation(plan);
    let transports = 0;
    const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
      credentialProvider: provider,
      transport: async () => {
        transports += 1;
        throw new Error("transport callback failure");
      },
    }));
    await assert.rejects(() => adapter.verifyLivePreflight(plan), /credential-broker-failed/);
    assert.equal(transports, 1);
  }
});

test("runtime adapter rejects a different cryptographically valid execution plan before gate or credential use", async () => {
  const plan = await executionPlan();
  const other = await executionPlan({ headBranch: "solve/review/other-valid-plan" });
  const active = await activation(plan);
  let gates = 0;
  let providers = 0;
  let transports = 0;
  const adapter = await createSelfDrivingGitHubInstallationRuntimeAdapter(plan, active, dependencies({
    runtimeGate: async (request) => {
      gates += 1;
      return { status: "allowed", activationId: request.activationId, gateEvidenceId: "should-not-run" };
    },
    credentialProvider: async (_request, withCredential) => {
      providers += 1;
      return withCredential(credential());
    },
    transport: async () => {
      transports += 1;
      throw new Error("should not run");
    },
  }));
  await assert.rejects(() => adapter.verifyLivePreflight(other), /different execution plan/);
  assert.equal(gates, 0);
  assert.equal(providers, 0);
  assert.equal(transports, 0);
});

test("activation identity or policy drift is rejected before runtime dependencies are invoked", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  let calls = 0;
  const deps = dependencies({
    runtimeGate: async () => {
      calls += 1;
      return { status: "blocked", reason: "runtime-rejected" };
    },
  });
  await assert.rejects(
    () => createSelfDrivingGitHubInstallationRuntimeAdapter(plan, { ...active, repository: "saiidz/other" }, deps),
    /binding drifted/,
  );
  await assert.rejects(
    () => createSelfDrivingGitHubInstallationRuntimeAdapter(plan, {
      ...active,
      policy: { ...active.policy, automaticMergeAllowed: true },
    } as unknown as typeof active, deps),
    /policy is not the canonical/,
  );
  assert.equal(calls, 0);
});
