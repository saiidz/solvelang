import {
  normalizePostHogCanaryApproval,
  type NormalizedPostHogCanaryApproval,
  type PostHogCanaryClaimResult,
  type PostHogCanaryOperation,
} from "./selfDrivingPosthogCanaryApproval";
import type {
  PostHogAuthProvider,
  PostHogEphemeralAuth,
} from "./selfDrivingPosthogTransport";

export const POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA =
  "solvelang.self-driving.posthog-canary-runtime-activation.v0" as const;
export const POSTHOG_CANARY_KILL_SWITCH_REQUEST_SCHEMA =
  "solvelang.self-driving.posthog-canary-kill-switch-check.v0" as const;
export const POSTHOG_CANARY_CREDENTIAL_LEASE_REQUEST_SCHEMA =
  "solvelang.self-driving.posthog-canary-credential-lease-request.v0" as const;

export const defaultPostHogCanaryRuntimeLimits = Object.freeze({
  maxActivationLifetimeMs: 10_000,
  maxLeaseLifetimeMs: 15 * 60 * 1000,
  minLeaseRemainingMs: 5_000,
  maxOpaqueRefLength: 256,
  maxAuthorizationLength: 4_096,
});

export type PostHogCanaryRuntimeActivationInput = Readonly<{
  state: "approved";
  operator: string;
  runtime: string;
  activatedAt: string;
  expiresAt: string;
  killSwitchRef: string;
}>;

export type PostHogCanaryRuntimeActivation = Readonly<{
  schema: typeof POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA;
  state: "approved";
  id: string;
  approvalId: string;
  claimId: string;
  requestId: string;
  project: string;
  origin: string;
  operation: PostHogCanaryOperation;
  credentialRef: string;
  credentialScope: string;
  operator: string;
  runtime: string;
  adapterRevision: string;
  activatedAt: string;
  expiresAt: string;
  killSwitchRef: string;
  policy: Readonly<{
    exactApprovalRequired: true;
    successfulSingleUseClaimRequired: true;
    boundedActivationWindow: true;
    killSwitchRequiredBeforeCredentialAccess: true;
    killSwitchRequiredBeforeCredentialRelease: true;
    isolatedCredentialLeaseRequired: true;
    credentialProviderSingleUse: true;
    rawCredentialMaterialReturned: false;
    builtInSecretStoreAccess: false;
    builtInNetworkClient: false;
    retries: 0;
    automaticRearm: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
  }>;
}>;

export type PostHogCanaryKillSwitchRequest = Readonly<{
  schema: typeof POSTHOG_CANARY_KILL_SWITCH_REQUEST_SCHEMA;
  activationId: string;
  approvalId: string;
  claimId: string;
  killSwitchRef: string;
  checkedAt: string;
}>;

export type PostHogCanaryKillSwitchResult = Readonly<{
  status: "enabled" | "disabled";
  activationId: string;
  killSwitchRef: string;
  checkedAt: string;
}>;

export type PostHogCanaryKillSwitch = (
  request: PostHogCanaryKillSwitchRequest,
) => Promise<PostHogCanaryKillSwitchResult>;

export type PostHogCanaryCredentialLeaseRequest = Readonly<{
  schema: typeof POSTHOG_CANARY_CREDENTIAL_LEASE_REQUEST_SCHEMA;
  activationId: string;
  approvalId: string;
  claimId: string;
  requestId: string;
  project: string;
  origin: string;
  operation: PostHogCanaryOperation;
  credentialRef: string;
  credentialScope: string;
  requestedAt: string;
}>;

export type PostHogCanaryCredentialLease = Readonly<{
  leaseId: string;
  credentialRef: string;
  credentialScope: string;
  project: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
  authorization: string;
}>;

export type PostHogCanaryCredentialLeaseProvider = <T>(
  request: PostHogCanaryCredentialLeaseRequest,
  withLease: (lease: PostHogCanaryCredentialLease) => Promise<T>,
) => Promise<T>;

export type PostHogCanaryRuntimeDependencies = Readonly<{
  killSwitch: PostHogCanaryKillSwitch;
  credentialLeaseProvider: PostHogCanaryCredentialLeaseProvider;
  now: () => string;
}>;

class SafeCanaryRuntimeError extends Error {}

const textEncoder = new TextEncoder();
const credentialLikePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i,
  /\b(?:sk|pk)-(?:live|test)-[A-Za-z0-9_-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_-]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bsl_(?:test|live)_[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
  if (credentialLikePatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`${name} contains credential-like material.`);
  }
  return normalized;
}

function normalizeOpaqueRef(value: string, name: string): string {
  const normalized = normalizeText(value, name, defaultPostHogCanaryRuntimeLimits.maxOpaqueRefLength);
  if (/^https?:\/\//i.test(normalized) || !/^[A-Za-z][A-Za-z0-9._:/-]{2,255}$/.test(normalized)) {
    throw new Error(`${name} must be a bounded opaque reference.`);
  }
  return normalized;
}

function normalizeUtc(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 support is required for PostHog canary runtime activation.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function activationPolicy(): PostHogCanaryRuntimeActivation["policy"] {
  return Object.freeze({
    exactApprovalRequired: true as const,
    successfulSingleUseClaimRequired: true as const,
    boundedActivationWindow: true as const,
    killSwitchRequiredBeforeCredentialAccess: true as const,
    killSwitchRequiredBeforeCredentialRelease: true as const,
    isolatedCredentialLeaseRequired: true as const,
    credentialProviderSingleUse: true as const,
    rawCredentialMaterialReturned: false as const,
    builtInSecretStoreAccess: false as const,
    builtInNetworkClient: false as const,
    retries: 0 as const,
    automaticRearm: false as const,
    repositoryWriteAccess: false as const,
    rolloutMutationAccess: false as const,
    productionMutationAccess: false as const,
    billingMutationAccess: false as const,
    solveRunnerAuthority: false as const,
  });
}

function recreateApproval(approval: NormalizedPostHogCanaryApproval): NormalizedPostHogCanaryApproval {
  if (!approval || typeof approval !== "object") throw new Error("A normalized PostHog canary approval is required.");
  const recreated = normalizePostHogCanaryApproval({
    schema: approval.schema,
    state: approval.state,
    approvalId: approval.approvalId,
    tenantId: approval.tenantId,
    systemBoundary: approval.systemBoundary,
    project: approval.project,
    origin: approval.origin,
    operation: approval.operation,
    credentialRef: approval.credentialRef,
    credentialScope: approval.credentialScope,
    operator: approval.operator,
    runtime: approval.runtime,
    adapterRevision: approval.adapterRevision,
    notBefore: approval.notBefore,
    expiresAt: approval.expiresAt,
    retentionHours: approval.retentionHours,
  });
  if (JSON.stringify(recreated) !== JSON.stringify(approval)) {
    throw new Error("PostHog canary runtime requires the exact canonical approval source artifact.");
  }
  return recreated;
}

function assertClaim(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
): { claimId: string; requestedAt: string } {
  if (!claim || typeof claim !== "object" || claim.status !== "claimed" || typeof claim.claimId !== "string") {
    throw new Error("PostHog canary runtime requires a successful single-use claim.");
  }
  const claimId = normalizeText(claim.claimId, "claim.claimId", 128);
  const requestedAt = normalizeUtc(claim.requestedAt, "claim.requestedAt");
  if (
    claim.approvalId !== approval.approvalId
    || claim.requestId !== approval.requestPlan.request.id
    || claim.policy.atomicSingleUseClaimRequired !== true
    || claim.policy.approvalClaimMutationAttempted !== true
    || claim.policy.retries !== 0
    || claim.policy.automaticRearm !== false
    || claim.policy.credentialResolutionAccess !== false
    || claim.policy.providerNetworkAccess !== false
    || claim.policy.repositoryWriteAccess !== false
    || claim.policy.productionMutationAccess !== false
    || claim.policy.credentialMaterialReturned !== false
  ) {
    throw new Error("PostHog canary runtime claim binding or policy drifted from the approved request.");
  }
  const claimEpoch = Date.parse(requestedAt);
  if (claimEpoch < Date.parse(approval.notBefore) || claimEpoch >= Date.parse(approval.expiresAt)) {
    throw new Error("PostHog canary runtime claim lies outside the approval window.");
  }
  return { claimId, requestedAt };
}

export async function createPostHogCanaryRuntimeActivation(
  approvalInput: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
  input: PostHogCanaryRuntimeActivationInput,
): Promise<PostHogCanaryRuntimeActivation> {
  const approval = recreateApproval(approvalInput);
  const claimed = assertClaim(approval, claim);
  if (!input || typeof input !== "object" || input.state !== "approved") {
    throw new Error("PostHog canary runtime activation must be explicitly approved.");
  }
  const operator = normalizeText(input.operator, "operator", 256);
  const runtime = normalizeText(input.runtime, "runtime", 256);
  const activatedAt = normalizeUtc(input.activatedAt, "activatedAt");
  const expiresAt = normalizeUtc(input.expiresAt, "expiresAt");
  const killSwitchRef = normalizeOpaqueRef(input.killSwitchRef, "killSwitchRef");
  const activationEpoch = Date.parse(activatedAt);
  const expiryEpoch = Date.parse(expiresAt);
  const claimEpoch = Date.parse(claimed.requestedAt);
  const hardExpiry = Math.min(
    Date.parse(approval.expiresAt),
    claimEpoch + defaultPostHogCanaryRuntimeLimits.maxActivationLifetimeMs,
  );
  if (activationEpoch < claimEpoch) throw new Error("PostHog canary activation may not precede the successful claim.");
  if (expiryEpoch <= activationEpoch) throw new Error("PostHog canary activation expiresAt must be after activatedAt.");
  if (expiryEpoch > hardExpiry || expiryEpoch - activationEpoch > defaultPostHogCanaryRuntimeLimits.maxActivationLifetimeMs) {
    throw new Error("PostHog canary activation exceeds the approval/claim deadline boundary.");
  }

  const canonical = Object.freeze({
    approvalId: approval.approvalId,
    claimId: claimed.claimId,
    requestId: approval.requestPlan.request.id,
    project: approval.project,
    origin: approval.origin,
    operation: approval.operation,
    credentialRef: approval.credentialRef,
    credentialScope: approval.credentialScope,
    operator,
    runtime,
    adapterRevision: approval.adapterRevision,
    activatedAt,
    expiresAt,
    killSwitchRef,
  });
  const identity = await sha256Hex(JSON.stringify(canonical));
  return Object.freeze({
    schema: POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA,
    state: "approved" as const,
    id: `posthog_canary_runtime_activation_${identity}`,
    ...canonical,
    policy: activationPolicy(),
  });
}

async function assertActivation(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
  activation: PostHogCanaryRuntimeActivation,
): Promise<PostHogCanaryRuntimeActivation> {
  if (!activation || activation.schema !== POSTHOG_CANARY_RUNTIME_ACTIVATION_SCHEMA || activation.state !== "approved") {
    throw new Error("A canonical approved PostHog canary runtime activation is required.");
  }
  const recreated = await createPostHogCanaryRuntimeActivation(approval, claim, {
    state: "approved",
    operator: activation.operator,
    runtime: activation.runtime,
    activatedAt: activation.activatedAt,
    expiresAt: activation.expiresAt,
    killSwitchRef: activation.killSwitchRef,
  });
  if (JSON.stringify(recreated) !== JSON.stringify(activation)) {
    throw new Error("PostHog canary runtime activation does not match its exact approval/claim source chain.");
  }
  return activation;
}

function assertActiveWindow(activation: PostHogCanaryRuntimeActivation, now: string): string {
  const normalized = normalizeUtc(now, "runtime.now");
  const epoch = Date.parse(normalized);
  if (epoch < Date.parse(activation.activatedAt) || epoch >= Date.parse(activation.expiresAt)) {
    throw new SafeCanaryRuntimeError("PostHog canary runtime activation is outside its approved window.");
  }
  return normalized;
}

async function checkKillSwitch(
  activation: PostHogCanaryRuntimeActivation,
  dependency: PostHogCanaryKillSwitch,
  checkedAt: string,
): Promise<void> {
  const request: PostHogCanaryKillSwitchRequest = Object.freeze({
    schema: POSTHOG_CANARY_KILL_SWITCH_REQUEST_SCHEMA,
    activationId: activation.id,
    approvalId: activation.approvalId,
    claimId: activation.claimId,
    killSwitchRef: activation.killSwitchRef,
    checkedAt,
  });
  let result: PostHogCanaryKillSwitchResult;
  try {
    result = await dependency(request);
  } catch {
    throw new Error("PostHog canary kill-switch check failed.");
  }
  if (
    !result
    || (result.status !== "enabled" && result.status !== "disabled")
    || result.activationId !== activation.id
    || result.killSwitchRef !== activation.killSwitchRef
    || normalizeUtc(result.checkedAt, "killSwitch.checkedAt") !== checkedAt
  ) {
    throw new Error("PostHog canary kill-switch evidence is invalid.");
  }
  if (result.status !== "enabled") {
    throw new SafeCanaryRuntimeError("PostHog canary runtime is disabled by the kill switch.");
  }
}

function makeLeaseRequest(
  activation: PostHogCanaryRuntimeActivation,
  requestedAt: string,
): PostHogCanaryCredentialLeaseRequest {
  return Object.freeze({
    schema: POSTHOG_CANARY_CREDENTIAL_LEASE_REQUEST_SCHEMA,
    activationId: activation.id,
    approvalId: activation.approvalId,
    claimId: activation.claimId,
    requestId: activation.requestId,
    project: activation.project,
    origin: activation.origin,
    operation: activation.operation,
    credentialRef: activation.credentialRef,
    credentialScope: activation.credentialScope,
    requestedAt,
  });
}

function validateAuthorization(value: string): string {
  if (
    typeof value !== "string"
    || value.length > defaultPostHogCanaryRuntimeLimits.maxAuthorizationLength
    || !/^Bearer [A-Za-z0-9._~+\/-]{8,}$/.test(value)
  ) {
    throw new Error("PostHog canary credential lease must contain one bounded Bearer authorization value.");
  }
  return value;
}

function validateLease(
  activation: PostHogCanaryRuntimeActivation,
  lease: PostHogCanaryCredentialLease,
  now: string,
): PostHogCanaryCredentialLease {
  if (!lease || typeof lease !== "object") throw new Error("PostHog canary credential lease is required.");
  if (Object.keys(lease).sort().join(",") !== "authorization,credentialRef,credentialScope,expiresAt,issuedAt,leaseId,origin,project") {
    throw new Error("PostHog canary credential lease contains unsupported fields.");
  }
  const leaseId = normalizeText(lease.leaseId, "lease.leaseId", 128);
  const credentialRef = normalizeOpaqueRef(lease.credentialRef, "lease.credentialRef");
  const credentialScope = normalizeText(lease.credentialScope, "lease.credentialScope", 256);
  const project = normalizeText(lease.project, "lease.project", 20);
  const origin = normalizeText(lease.origin, "lease.origin", 256);
  if (
    credentialRef !== activation.credentialRef
    || credentialScope !== activation.credentialScope
    || project !== activation.project
    || origin !== activation.origin
  ) {
    throw new Error("PostHog canary credential lease drifted from the activation binding.");
  }
  const issuedAt = normalizeUtc(lease.issuedAt, "lease.issuedAt");
  const expiresAt = normalizeUtc(lease.expiresAt, "lease.expiresAt");
  const nowEpoch = Date.parse(now);
  const issuedEpoch = Date.parse(issuedAt);
  const expiresEpoch = Date.parse(expiresAt);
  if (issuedEpoch > nowEpoch || expiresEpoch <= nowEpoch) throw new Error("PostHog canary credential lease is not currently valid.");
  if (expiresEpoch - issuedEpoch > defaultPostHogCanaryRuntimeLimits.maxLeaseLifetimeMs) {
    throw new Error("PostHog canary credential lease exceeds the lifetime bound.");
  }
  if (expiresEpoch - nowEpoch < defaultPostHogCanaryRuntimeLimits.minLeaseRemainingMs) {
    throw new Error("PostHog canary credential lease has insufficient remaining lifetime.");
  }
  const authorization = validateAuthorization(lease.authorization);
  return Object.freeze({ ...lease, leaseId, credentialRef, credentialScope, project, origin, issuedAt, expiresAt, authorization });
}

export async function createPostHogCanaryRuntimeAuthProvider(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
  activationInput: PostHogCanaryRuntimeActivation,
  dependencies: PostHogCanaryRuntimeDependencies,
): Promise<PostHogAuthProvider> {
  recreateApproval(approval);
  assertClaim(approval, claim);
  const activation = await assertActivation(approval, claim, activationInput);
  if (!dependencies || typeof dependencies !== "object") throw new Error("PostHog canary runtime dependencies are required.");
  if (typeof dependencies.killSwitch !== "function") throw new Error("An injected PostHog canary kill switch is required.");
  if (typeof dependencies.credentialLeaseProvider !== "function") throw new Error("An injected PostHog credential lease provider is required.");
  if (typeof dependencies.now !== "function") throw new Error("An injected UTC runtime clock is required.");

  let used = false;
  let inFlight = false;
  let terminallyFailed = false;

  return async function runtimeAuthProvider(context): Promise<PostHogEphemeralAuth> {
    if (terminallyFailed) throw new Error("PostHog canary runtime auth provider is terminally failed.");
    if (used || inFlight) {
      terminallyFailed = true;
      throw new Error("PostHog canary runtime auth provider is single-use.");
    }
    if (!context || context.signal?.aborted) {
      terminallyFailed = true;
      throw new Error("PostHog canary runtime authorization was cancelled.");
    }
    inFlight = true;
    try {
      const beforeLease = assertActiveWindow(activation, dependencies.now());
      await checkKillSwitch(activation, dependencies.killSwitch, beforeLease);
      if (context.signal.aborted) throw new SafeCanaryRuntimeError("PostHog canary runtime authorization was cancelled.");
      const request = makeLeaseRequest(activation, beforeLease);

      let callbackActive = true;
      let callbackEntered = false;
      let callbackCompleted = false;
      let providerReentered = false;
      let callbackAuth: PostHogEphemeralAuth | undefined;
      let providerAuth: PostHogEphemeralAuth;
      try {
        providerAuth = await dependencies.credentialLeaseProvider<PostHogEphemeralAuth>(request, async (rawLease) => {
          if (!callbackActive) throw new Error("PostHog credential lease callback is no longer active.");
          if (callbackEntered) {
            providerReentered = true;
            throw new Error("PostHog credential lease provider re-entered the callback.");
          }
          callbackEntered = true;
          const lease = validateLease(activation, rawLease, beforeLease);
          const beforeRelease = assertActiveWindow(activation, dependencies.now());
          if (!callbackActive) throw new Error("PostHog credential lease callback is no longer active.");
          if (Date.parse(lease.expiresAt) <= Date.parse(beforeRelease)) {
            throw new Error("PostHog credential lease expired before authorization release.");
          }
          await checkKillSwitch(activation, dependencies.killSwitch, beforeRelease);
          if (!callbackActive) throw new Error("PostHog credential lease callback is no longer active.");
          if (context.signal.aborted) throw new SafeCanaryRuntimeError("PostHog canary runtime authorization was cancelled.");
          const auth = Object.freeze({ authorization: lease.authorization });
          callbackAuth = auth;
          callbackCompleted = true;
          return auth;
        });
      } catch {
        throw new Error("PostHog canary isolated credential lease failed.");
      } finally {
        callbackActive = false;
      }

      if (!callbackEntered || !callbackCompleted || providerReentered || !Object.is(providerAuth, callbackAuth)) {
        throw new Error("PostHog canary credential lease provider violated the exact single-callback result contract.");
      }
      const finalCheck = assertActiveWindow(activation, dependencies.now());
      await checkKillSwitch(activation, dependencies.killSwitch, finalCheck);
      if (context.signal.aborted) throw new SafeCanaryRuntimeError("PostHog canary runtime authorization was cancelled.");
      used = true;
      inFlight = false;
      return providerAuth;
    } catch (error) {
      terminallyFailed = true;
      inFlight = false;
      if (error instanceof SafeCanaryRuntimeError) throw error;
      if (error instanceof Error && (
        error.message === "PostHog canary runtime auth provider is single-use."
        || error.message === "PostHog canary isolated credential lease failed."
        || error.message === "PostHog canary credential lease provider violated the exact single-callback result contract."
      )) {
        throw error;
      }
      throw new Error("PostHog canary runtime authorization failed.");
    }
  };
}
