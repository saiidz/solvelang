import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelfDrivingGitHubPrivateKeyJwtSigner,
  createSelfDrivingGitHubPrivateKeySignerBinding,
  SELF_DRIVING_GITHUB_PRIVATE_KEY_LEASE_REQUEST_SCHEMA,
  SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA,
  SELF_DRIVING_GITHUB_RS256_SIGNATURE_REQUEST_SCHEMA,
  type SelfDrivingGitHubPrivateKeyLease,
  type SelfDrivingGitHubPrivateKeyLeaseProvider,
  type SelfDrivingGitHubPrivateKeySignerBinding,
} from "./selfDrivingGithubPrivateKeySignerBoundary";
import {
  createSelfDrivingGitHubInstallationActivation,
  type SelfDrivingGitHubInstallationActivation,
} from "./selfDrivingGithubInstallationRuntimeGate";
import type { SelfDrivingGitHubAppJwtSignRequest } from "./selfDrivingGithubInstallationTokenMint";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

const BASE = "a".repeat(40);
const BLOB = "b".repeat(40);
const INSTALLATION_REF = "github-app/installation:12345";
const APP_ISSUER = "Iv1SolveLangSignerFixture";
const KEY_REF = "secret-store:github-app/solvelang/key-2026-09";
const FINGERPRINT = "c".repeat(64);
const NOW = "2026-09-08T08:01:00Z";
const LEASE_ISSUED_AT = "2026-09-08T08:00:50Z";
const LEASE_EXPIRES_AT = "2026-09-08T08:05:00Z";
const SIGNATURE = "fixture_rs256_signature_base64url";

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
    headBranch: "solve/review/private-key-signer",
    installationRef: INSTALLATION_REF,
    approvalId: "approval-private-key-signer",
    approvalBindingSha256: "1".repeat(64),
    claimId: "claim-private-key-signer",
    claimedAt: "2026-09-08T08:00:00Z",
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
      evidenceLocator: "github:rules:private-key-signer",
    },
    selectedProposals: [{
      validationId: "validation-private-key-signer",
      patchProposalId: "patch-private-key-signer",
      suggestionProposalId: "suggestion-private-key-signer",
      findingId: "finding-private-key-signer",
      severity: "high" as const,
    }],
    files: [{
      proposalId: "patch-private-key-signer",
      validationId: "validation-private-key-signer",
      suggestionProposalId: "suggestion-private-key-signer",
      findingId: "finding-private-key-signer",
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

async function activation(plan: SelfDrivingPrWriteExecutionPlan): Promise<SelfDrivingGitHubInstallationActivation> {
  return createSelfDrivingGitHubInstallationActivation(plan, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-github-pr-writer-v0",
    notBefore: "2026-09-08T08:00:10Z",
    expiresAt: "2026-09-08T08:10:10Z",
  });
}

async function shortActivation(
  plan: SelfDrivingPrWriteExecutionPlan,
  expiresAt = "2026-09-08T08:04:00Z",
): Promise<SelfDrivingGitHubInstallationActivation> {
  return createSelfDrivingGitHubInstallationActivation(plan, {
    state: "approved",
    operator: "owner:saiidz",
    runtime: "isolated-github-pr-writer-v0",
    notBefore: "2026-09-08T08:00:10Z",
    expiresAt,
  });
}

async function binding(
  plan: SelfDrivingPrWriteExecutionPlan,
  active: SelfDrivingGitHubInstallationActivation,
) {
  return createSelfDrivingGitHubPrivateKeySignerBinding(plan, active, {
    appIssuer: APP_ISSUER,
    keyRef: KEY_REF,
    publicKeyFingerprintSha256: FINGERPRINT,
  });
}

function signRequest(overrides: Partial<SelfDrivingGitHubAppJwtSignRequest> = {}): SelfDrivingGitHubAppJwtSignRequest {
  const nowSeconds = Math.floor(Date.parse(NOW) / 1000);
  return {
    schema: "solvelang.self-driving.github-app-jwt-sign-request.v0",
    algorithm: "RS256",
    issuer: APP_ISSUER,
    issuedAtEpochSeconds: nowSeconds - 60,
    expiresAtEpochSeconds: nowSeconds + 540,
    ...overrides,
  };
}

function lease(
  signCalls: { value: number },
  overrides: Partial<SelfDrivingGitHubPrivateKeyLease> = {},
): SelfDrivingGitHubPrivateKeyLease {
  return {
    leaseId: "key-lease-private-key-signer",
    keyRef: KEY_REF,
    publicKeyFingerprintSha256: FINGERPRINT,
    algorithm: "RS256",
    issuedAt: LEASE_ISSUED_AT,
    expiresAt: LEASE_EXPIRES_AT,
    signRs256: async (request) => {
      signCalls.value += 1;
      assert.equal(request.schema, SELF_DRIVING_GITHUB_RS256_SIGNATURE_REQUEST_SCHEMA);
      assert.equal(request.algorithm, "RS256");
      return SIGNATURE;
    },
    ...overrides,
  };
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - segment.length % 4) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

test("signer binding is deterministic, exact-plan/activation bound, and contains no secret material", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const first = await binding(plan, active);
  const second = await binding(plan, active);
  assert.equal(first.schema, SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA);
  assert.equal(first.status, "bound");
  assert.equal(first.id, second.id);
  assert.equal(first.planId, plan.id);
  assert.equal(first.activationId, active.id);
  assert.equal(first.installationRef, INSTALLATION_REF);
  assert.equal(first.installationId, 12345);
  assert.equal(first.appIssuer, APP_ISSUER);
  assert.equal(first.keyRef, KEY_REF);
  assert.equal(first.publicKeyFingerprintSha256, FINGERPRINT);
  assert.equal(first.policy.rawPrivateKeyMaterialAllowed, false);
  assert.equal(first.policy.environmentFallbackAllowed, false);
  assert.equal(first.policy.browserKeyAccessAllowed, false);
  assert.equal(first.policy.builtInCryptoEngine, false);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE KEY|Bearer|ghs_|github_pat_/i);
});

test("binding rejects forged activation, forged plan identity, credential-like key refs, or malformed fingerprints", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  await assert.rejects(
    () => createSelfDrivingGitHubPrivateKeySignerBinding(plan, { ...active, id: `github_installation_activation_${"0".repeat(64)}` }, {
      appIssuer: APP_ISSUER,
      keyRef: KEY_REF,
      publicKeyFingerprintSha256: FINGERPRINT,
    }),
    /exact canonical installation activation/,
  );
  await assert.rejects(
    () => createSelfDrivingGitHubPrivateKeySignerBinding({ ...plan, id: `pr_write_plan_${"0".repeat(64)}` }, active, {
      appIssuer: APP_ISSUER,
      keyRef: KEY_REF,
      publicKeyFingerprintSha256: FINGERPRINT,
    }),
    /SHA-256 identity/,
  );
  await assert.rejects(
    () => createSelfDrivingGitHubPrivateKeySignerBinding(plan, active, {
      appIssuer: APP_ISSUER,
      keyRef: "-----BEGIN PRIVATE KEY-----",
      publicKeyFingerprintSha256: FINGERPRINT,
    }),
    /credential-like material/,
  );
  await assert.rejects(
    () => createSelfDrivingGitHubPrivateKeySignerBinding(plan, active, {
      appIssuer: APP_ISSUER,
      keyRef: KEY_REF,
      publicKeyFingerprintSha256: "not-a-fingerprint",
    }),
    /SHA-256 hex fingerprint/,
  );
});

test("signer recreates source binding, requests exact lease, signs exact JWT input once, and returns only the JWT callback result", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const bound = await binding(plan, active);
  const leaseCalls: unknown[] = [];
  const signCalls = { value: 0 };
  const signatureInputs: string[] = [];
  const leaseProvider: SelfDrivingGitHubPrivateKeyLeaseProvider = async (request, withLease) => {
    leaseCalls.push(request);
    return withLease(lease(signCalls, {
      signRs256: async (signatureRequest) => {
        signCalls.value += 1;
        signatureInputs.push(signatureRequest.signingInput);
        assert.equal(signatureRequest.bindingId, bound.id);
        assert.equal(signatureRequest.leaseId, "key-lease-private-key-signer");
        return SIGNATURE;
      },
    }));
  };
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider,
    now: () => NOW,
  });
  let observedJwt = "";
  const result = await signer(signRequest(), async (jwt) => {
    observedJwt = jwt;
    return { accepted: true };
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(leaseCalls.length, 1);
  const request = leaseCalls[0] as Record<string, unknown>;
  assert.equal(request.schema, SELF_DRIVING_GITHUB_PRIVATE_KEY_LEASE_REQUEST_SCHEMA);
  assert.equal(request.bindingId, bound.id);
  assert.equal(request.activationId, active.id);
  assert.equal(request.planId, plan.id);
  assert.equal(request.installationRef, INSTALLATION_REF);
  assert.equal(request.keyRef, KEY_REF);
  assert.equal(request.expectedPublicKeyFingerprintSha256, FINGERPRINT);
  assert.equal(request.algorithm, "RS256");
  assert.equal(request.purpose, "github-app-jwt");
  assert.equal(request.requestedAt, new Date(Date.parse(NOW)).toISOString());
  assert.equal(signCalls.value, 1);
  assert.equal(signatureInputs.length, 1);
  const parts = observedJwt.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(decodeBase64UrlJson(parts[0]), { typ: "JWT", alg: "RS256" });
  assert.deepEqual(decodeBase64UrlJson(parts[1]), {
    iat: signRequest().issuedAtEpochSeconds,
    exp: signRequest().expiresAtEpochSeconds,
    iss: APP_ISSUER,
  });
  assert.equal(parts[2], SIGNATURE);
});

test("a structurally valid but source-substituted binding is rejected before key lease access", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const attackerPlan = await executionPlan({ headBranch: "solve/review/attacker" });
  const attackerActivation = await activation(attackerPlan);
  const attackerBinding = await binding(attackerPlan, attackerActivation);
  let leaseCalls = 0;
  await assert.rejects(
    () => createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, attackerBinding, {
      leaseProvider: async () => {
        leaseCalls += 1;
        throw new Error("must not run");
      },
      now: () => NOW,
    }),
    /exact approved plan\/activation source chain/,
  );
  assert.equal(leaseCalls, 0);
});

test("issuer drift, excessive JWT lifetime, or expired activation fail before lease access", async () => {
  const cases: Array<readonly [Partial<SelfDrivingGitHubAppJwtSignRequest>, string, RegExp]> = [
    [{ issuer: "WrongIssuer" }, NOW, /issuer drifted/],
    [{ expiresAtEpochSeconds: signRequest().issuedAtEpochSeconds + 601 }, NOW, /ten-minute bound/],
    [{}, "2026-09-08T08:10:10Z", /outside its activation window/],
  ];
  for (const [requestOverrides, now, expected] of cases) {
    const plan = await executionPlan();
    const active = await activation(plan);
    const bound = await binding(plan, active);
    let leaseCalls = 0;
    const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
      leaseProvider: async () => {
        leaseCalls += 1;
        throw new Error("must not run");
      },
      now: () => now,
    });
    await assert.rejects(() => signer(signRequest(requestOverrides), async () => true), expected);
    assert.equal(leaseCalls, 0);
  }
});

test("JWT expiration is capped to the remaining activation window", async () => {
  const plan = await executionPlan();
  const active = await shortActivation(plan);
  const bound = await binding(plan, active);
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (_request, withLease) => withLease(lease({ value: 0 })),
    now: () => NOW,
  });
  let observedExp = 0;
  await signer(signRequest(), async (jwt) => {
    const payload = decodeBase64UrlJson(jwt.split(".")[1]);
    observedExp = payload.exp as number;
    return true;
  });
  assert.equal(observedExp, Math.floor(Date.parse(active.expiresAt) / 1000));
  assert.ok(observedExp < signRequest().expiresAtEpochSeconds);
});

test("lease key/fingerprint/algorithm/expiry drift and raw-key-like extra fields fail before signature capability", async () => {
  const cases: Array<readonly [Partial<SelfDrivingGitHubPrivateKeyLease> & Record<string, unknown>, RegExp]> = [
    [{ keyRef: "secret-store:wrong-key" }, /keyRef drifted/],
    [{ publicKeyFingerprintSha256: "d".repeat(64) }, /fingerprint drifted/],
    [{ algorithm: "HS256" as "RS256" }, /algorithm must be RS256/],
    [{ expiresAt: "2026-09-08T08:01:00Z" }, /not currently valid/],
    [{ privateKeyPem: "secret" }, /unsupported fields or raw key material/],
  ];
  for (const [overrides, expected] of cases) {
    const plan = await executionPlan();
    const active = await activation(plan);
    const bound = await binding(plan, active);
    const signCalls = { value: 0 };
    const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
      leaseProvider: async (_request, withLease) => withLease({
        ...lease(signCalls),
        ...overrides,
      } as unknown as SelfDrivingGitHubPrivateKeyLease),
      now: () => NOW,
    });
    await assert.rejects(() => signer(signRequest(), async () => true), /private-key lease\/signing failed/i);
    assert.equal(signCalls.value, 0, expected.source);
  }
});

test("captured lease callback is revoked after provider settles and cannot sign later", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const bound = await binding(plan, active);
  let captured:
    | ((leaseValue: SelfDrivingGitHubPrivateKeyLease) => Promise<string>)
    | undefined;
  const signCalls = { value: 0 };
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (_request, withLease) => {
      captured = withLease as (leaseValue: SelfDrivingGitHubPrivateKeyLease) => Promise<string>;
      return "replaced-provider-result" as never;
    },
    now: () => NOW,
  });
  await assert.rejects(
    () => signer(signRequest(), async () => true),
    /single-callback result contract/,
  );
  assert.ok(captured);
  await assert.rejects(() => captured!(lease(signCalls)), /no longer active/);
  assert.equal(signCalls.value, 0);
});

test("an already-running lease callback is revoked if the provider settles before signing completes", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const bound = await binding(plan, active);
  const signCalls = { value: 0 };
  let releaseSignature: (() => void) | undefined;
  let pendingCallback: Promise<unknown> | undefined;
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (_request, withLease) => {
      pendingCallback = withLease(lease(signCalls, {
        signRs256: async () => {
          signCalls.value += 1;
          await new Promise<void>((resolve) => { releaseSignature = resolve; });
          return SIGNATURE;
        },
      }));
      await Promise.resolve();
      return "provider-settled-without-callback" as never;
    },
    now: () => NOW,
  });
  await assert.rejects(
    () => signer(signRequest(), async () => true),
    /single-callback result contract/,
  );
  assert.ok(pendingCallback);
  assert.ok(releaseSignature);
  releaseSignature!();
  await assert.rejects(pendingCallback!, /no longer active/);
  assert.equal(signCalls.value, 1);
});

test("activation and JWT are rechecked after signing and immediately before JWT release", async () => {
  const plan = await executionPlan();
  const active = await shortActivation(plan, "2026-09-08T08:01:30Z");
  const bound = await binding(plan, active);
  let clockCalls = 0;
  let consumerCalls = 0;
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (_request, withLease) => withLease(lease({ value: 0 })),
    now: () => {
      clockCalls += 1;
      if (clockCalls <= 2) return NOW;
      return "2026-09-08T08:01:30Z";
    },
  });
  await assert.rejects(
    () => signer(signRequest(), async () => {
      consumerCalls += 1;
      return true;
    }),
    /expired before JWT release/,
  );
  assert.equal(consumerCalls, 0);
  assert.ok(clockCalls >= 3);
});

test("lease provider callback re-entry or result substitution fails closed", async () => {
  const providers: SelfDrivingGitHubPrivateKeyLeaseProvider[] = [
    async (_request, withLease) => {
      const signCalls = { value: 0 };
      const first = await withLease(lease(signCalls));
      try { await withLease(lease(signCalls)); } catch { /* expected */ }
      return first;
    },
    async (_request, withLease) => {
      await withLease(lease({ value: 0 }));
      return "replaced" as never;
    },
  ];
  for (const leaseProvider of providers) {
    const plan = await executionPlan();
    const active = await activation(plan);
    const bound = await binding(plan, active);
    const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
      leaseProvider,
      now: () => NOW,
    });
    await assert.rejects(
      () => signer(signRequest(), async () => true),
      /single-callback result contract|private-key lease\/signing failed/i,
    );
  }
});

test("signer is single-use and never requests a second private-key lease", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const bound = await binding(plan, active);
  let leaseCalls = 0;
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (_request, withLease) => {
      leaseCalls += 1;
      return withLease(lease({ value: 0 }));
    },
    now: () => NOW,
  });
  await signer(signRequest(), async () => "first");
  await assert.rejects(() => signer(signRequest(), async () => "second"), /single-use/);
  assert.equal(leaseCalls, 1);
});

test("raw lease/signature errors are sanitized and secret-like material never appears in public binding/request artifacts", async () => {
  const plan = await executionPlan();
  const active = await activation(plan);
  const bound = await binding(plan, active);
  let observedLeaseRequest: unknown;
  const signer = await createSelfDrivingGitHubPrivateKeyJwtSigner(plan, active, bound, {
    leaseProvider: async (request, withLease) => {
      observedLeaseRequest = request;
      return withLease(lease({ value: 0 }, {
        signRs256: async () => { throw new Error("PRIVATE KEY super-secret-value"); },
      }));
    },
    now: () => NOW,
  });
  let message = "";
  try {
    await signer(signRequest(), async () => true);
    assert.fail("expected signing failure");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message, "GitHub private-key lease/signing failed.");
  assert.doesNotMatch(message, /PRIVATE KEY|super-secret-value/);
  assert.doesNotMatch(JSON.stringify(bound), /PRIVATE KEY|Bearer|ghs_|github_pat_/i);
  assert.doesNotMatch(JSON.stringify(observedLeaseRequest), /PRIVATE KEY|Bearer|ghs_|github_pat_/i);
});
