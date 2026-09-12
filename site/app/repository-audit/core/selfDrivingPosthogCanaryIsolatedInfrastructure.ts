import type {
  PostHogCanaryCredentialLease,
  PostHogCanaryCredentialLeaseProvider,
  PostHogCanaryCredentialLeaseRequest,
  PostHogCanaryKillSwitch,
  PostHogCanaryKillSwitchRequest,
  PostHogCanaryRuntimeActivation,
  PostHogCanaryRuntimeDependencies,
} from "./selfDrivingPosthogCanaryRuntimeGate";

export const POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA =
  "solvelang.self-driving.posthog-canary-kill-switch-state.v0" as const;
export const POSTHOG_CANARY_CREDENTIAL_SOURCE_SCHEMA =
  "solvelang.self-driving.posthog-canary-credential-source.v0" as const;

export const defaultPostHogCanaryIsolatedInfrastructureLimits = Object.freeze({
  maxEvidenceIdLength: 128,
  maxLeaseIdLength: 128,
  maxAuthorizationLength: 4_096,
  maxLeaseLifetimeMs: 15 * 60 * 1000,
  minLeaseRemainingMs: 5_000,
});

export type PostHogCanaryKillSwitchState = Readonly<{
  schema: typeof POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA;
  status: "enabled" | "disabled";
  activationId: string;
  killSwitchRef: string;
  checkedAt: string;
  evidenceId: string;
}>;

export type PostHogCanaryKillSwitchStateReader = (
  request: PostHogCanaryKillSwitchRequest,
) => Promise<PostHogCanaryKillSwitchState>;

export type PostHogCanaryCredentialSourceMaterial = Readonly<{
  schema: typeof POSTHOG_CANARY_CREDENTIAL_SOURCE_SCHEMA;
  leaseId: string;
  credentialRef: string;
  credentialScope: string;
  project: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
  authorization: string;
}>;

export type PostHogCanaryCredentialSource = <T>(
  request: PostHogCanaryCredentialLeaseRequest,
  withCredential: (material: PostHogCanaryCredentialSourceMaterial) => Promise<T>,
) => Promise<T>;

export type PostHogCanaryIsolatedInfrastructure = Readonly<{
  killSwitchStateReader: PostHogCanaryKillSwitchStateReader;
  credentialSource: PostHogCanaryCredentialSource;
  now: () => string;
}>;

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

function normalizeUtc(value: string, name: string): string {
  const normalized = normalizeText(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${name} must be an explicit UTC timestamp.`);
  }
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) throw new Error(`${name} must be a valid UTC timestamp.`);
  return new Date(epoch).toISOString();
}

function normalizeAuthorization(value: string): string {
  if (
    typeof value !== "string"
    || value.length > defaultPostHogCanaryIsolatedInfrastructureLimits.maxAuthorizationLength
    || !/^Bearer [A-Za-z0-9._~+\/-]{8,}$/.test(value)
  ) {
    throw new Error("PostHog canary credential source authorization is malformed.");
  }
  return value;
}

function assertActivationBoundary(activation: PostHogCanaryRuntimeActivation): void {
  if (
    !activation
    || activation.schema !== "solvelang.self-driving.posthog-canary-runtime-activation.v0"
    || activation.state !== "approved"
    || !/^posthog_canary_runtime_activation_[0-9a-f]{64}$/.test(activation.id)
  ) {
    throw new Error("A canonical approved PostHog canary runtime activation is required.");
  }
  const policy = activation.policy;
  if (
    !policy
    || policy.exactApprovalRequired !== true
    || policy.successfulSingleUseClaimRequired !== true
    || policy.boundedActivationWindow !== true
    || policy.killSwitchRequiredBeforeCredentialAccess !== true
    || policy.killSwitchRequiredBeforeCredentialRelease !== true
    || policy.isolatedCredentialLeaseRequired !== true
    || policy.credentialProviderSingleUse !== true
    || policy.rawCredentialMaterialReturned !== false
    || policy.builtInSecretStoreAccess !== false
    || policy.builtInNetworkClient !== false
    || policy.retries !== 0
    || policy.automaticRearm !== false
    || policy.repositoryWriteAccess !== false
    || policy.rolloutMutationAccess !== false
    || policy.productionMutationAccess !== false
    || policy.billingMutationAccess !== false
    || policy.solveRunnerAuthority !== false
  ) {
    throw new Error("PostHog canary isolated infrastructure requires the canonical deny-by-default activation policy.");
  }
  normalizeUtc(activation.activatedAt, "activation.activatedAt");
  normalizeUtc(activation.expiresAt, "activation.expiresAt");
}

function assertWithinActivation(activation: PostHogCanaryRuntimeActivation, value: string, name: string): string {
  const normalized = normalizeUtc(value, name);
  const epoch = Date.parse(normalized);
  if (epoch < Date.parse(activation.activatedAt) || epoch >= Date.parse(activation.expiresAt)) {
    throw new Error(`${name} is outside the approved activation window.`);
  }
  return normalized;
}

function assertKillSwitchRequest(
  activation: PostHogCanaryRuntimeActivation,
  request: PostHogCanaryKillSwitchRequest,
): string {
  if (
    !request
    || request.schema !== "solvelang.self-driving.posthog-canary-kill-switch-check.v0"
    || request.activationId !== activation.id
    || request.approvalId !== activation.approvalId
    || request.claimId !== activation.claimId
    || request.killSwitchRef !== activation.killSwitchRef
  ) {
    throw new Error("PostHog canary kill-switch request drifted from the activation binding.");
  }
  return assertWithinActivation(activation, request.checkedAt, "killSwitch.request.checkedAt");
}

function normalizeKillSwitchState(
  activation: PostHogCanaryRuntimeActivation,
  request: PostHogCanaryKillSwitchRequest,
  state: PostHogCanaryKillSwitchState,
): PostHogCanaryKillSwitchState {
  if (!state || typeof state !== "object") throw new Error("PostHog canary kill-switch state is required.");
  if (Object.keys(state).sort().join(",") !== "activationId,checkedAt,evidenceId,killSwitchRef,schema,status") {
    throw new Error("PostHog canary kill-switch state contains unsupported fields.");
  }
  if (
    state.schema !== POSTHOG_CANARY_KILL_SWITCH_STATE_SCHEMA
    || (state.status !== "enabled" && state.status !== "disabled")
    || state.activationId !== activation.id
    || state.killSwitchRef !== activation.killSwitchRef
    || normalizeUtc(state.checkedAt, "killSwitch.state.checkedAt") !== request.checkedAt
  ) {
    throw new Error("PostHog canary kill-switch state is not bound to the exact request.");
  }
  normalizeText(
    state.evidenceId,
    "killSwitch.state.evidenceId",
    defaultPostHogCanaryIsolatedInfrastructureLimits.maxEvidenceIdLength,
  );
  return Object.freeze({ ...state });
}

function assertCredentialRequest(
  activation: PostHogCanaryRuntimeActivation,
  request: PostHogCanaryCredentialLeaseRequest,
): string {
  if (
    !request
    || request.schema !== "solvelang.self-driving.posthog-canary-credential-lease-request.v0"
    || request.activationId !== activation.id
    || request.approvalId !== activation.approvalId
    || request.claimId !== activation.claimId
    || request.requestId !== activation.requestId
    || request.project !== activation.project
    || request.origin !== activation.origin
    || request.operation !== activation.operation
    || request.credentialRef !== activation.credentialRef
    || request.credentialScope !== activation.credentialScope
  ) {
    throw new Error("PostHog canary credential-source request drifted from the activation binding.");
  }
  return assertWithinActivation(activation, request.requestedAt, "credentialSource.requestedAt");
}

function normalizeSourceMaterial(
  activation: PostHogCanaryRuntimeActivation,
  requestedAt: string,
  material: PostHogCanaryCredentialSourceMaterial,
): PostHogCanaryCredentialLease {
  if (!material || typeof material !== "object") throw new Error("PostHog canary credential source material is required.");
  if (
    Object.keys(material).sort().join(",")
    !== "authorization,credentialRef,credentialScope,expiresAt,issuedAt,leaseId,origin,project,schema"
  ) {
    throw new Error("PostHog canary credential source material contains unsupported fields.");
  }
  if (
    material.schema !== POSTHOG_CANARY_CREDENTIAL_SOURCE_SCHEMA
    || material.credentialRef !== activation.credentialRef
    || material.credentialScope !== activation.credentialScope
    || material.project !== activation.project
    || material.origin !== activation.origin
  ) {
    throw new Error("PostHog canary credential source material drifted from the activation binding.");
  }
  const leaseId = normalizeText(
    material.leaseId,
    "credentialSource.leaseId",
    defaultPostHogCanaryIsolatedInfrastructureLimits.maxLeaseIdLength,
  );
  const issuedAt = normalizeUtc(material.issuedAt, "credentialSource.issuedAt");
  const expiresAt = normalizeUtc(material.expiresAt, "credentialSource.expiresAt");
  const issuedEpoch = Date.parse(issuedAt);
  const requestedEpoch = Date.parse(requestedAt);
  const expiresEpoch = Date.parse(expiresAt);
  if (issuedEpoch > requestedEpoch || expiresEpoch <= requestedEpoch) {
    throw new Error("PostHog canary credential source material is not valid at the lease request time.");
  }
  if (expiresEpoch - issuedEpoch > defaultPostHogCanaryIsolatedInfrastructureLimits.maxLeaseLifetimeMs) {
    throw new Error("PostHog canary credential source material exceeds the bounded lease lifetime.");
  }
  if (expiresEpoch - requestedEpoch < defaultPostHogCanaryIsolatedInfrastructureLimits.minLeaseRemainingMs) {
    throw new Error("PostHog canary credential source material has insufficient remaining lifetime.");
  }
  const authorization = normalizeAuthorization(material.authorization);
  return Object.freeze({
    leaseId,
    credentialRef: activation.credentialRef,
    credentialScope: activation.credentialScope,
    project: activation.project,
    origin: activation.origin,
    issuedAt,
    expiresAt,
    authorization,
  });
}

function createKillSwitch(
  activation: PostHogCanaryRuntimeActivation,
  reader: PostHogCanaryKillSwitchStateReader,
): PostHogCanaryKillSwitch {
  return async (request) => {
    assertKillSwitchRequest(activation, request);
    let state: PostHogCanaryKillSwitchState;
    try {
      state = await reader(request);
    } catch {
      throw new Error("PostHog canary isolated kill-switch state read failed.");
    }
    const normalized = normalizeKillSwitchState(activation, request, state);
    return Object.freeze({
      status: normalized.status,
      activationId: activation.id,
      killSwitchRef: activation.killSwitchRef,
      checkedAt: request.checkedAt,
    });
  };
}

function createCredentialLeaseProvider(
  activation: PostHogCanaryRuntimeActivation,
  source: PostHogCanaryCredentialSource,
): PostHogCanaryCredentialLeaseProvider {
  let sourceUsed = false;
  let terminallyFailed = false;

  return async function isolatedCredentialLease<T>(
    request: PostHogCanaryCredentialLeaseRequest,
    withLease: (lease: PostHogCanaryCredentialLease) => Promise<T>,
  ): Promise<T> {
    if (terminallyFailed) throw new Error("PostHog canary isolated credential source is terminally failed.");
    if (sourceUsed) {
      terminallyFailed = true;
      throw new Error("PostHog canary isolated credential source is single-use.");
    }
    if (typeof withLease !== "function") {
      terminallyFailed = true;
      throw new Error("PostHog canary credential lease callback is required.");
    }

    try {
      const requestedAt = assertCredentialRequest(activation, request);
      sourceUsed = true;
      let callbackActive = true;
      let callbackEntered = false;
      let callbackCompleted = false;
      let sourceReentered = false;
      let callbackResult: T | undefined;
      let sourceResult: T;
      try {
        sourceResult = await source<T>(request, async (material) => {
          if (!callbackActive) throw new Error("PostHog canary credential source callback is no longer active.");
          if (callbackEntered) {
            sourceReentered = true;
            throw new Error("PostHog canary credential source re-entered its callback.");
          }
          callbackEntered = true;
          const lease = normalizeSourceMaterial(activation, requestedAt, material);
          const result = await withLease(lease);
          callbackResult = result;
          callbackCompleted = true;
          return result;
        });
      } catch {
        throw new Error("PostHog canary isolated credential source failed.");
      } finally {
        callbackActive = false;
      }
      if (!callbackEntered || !callbackCompleted || sourceReentered || !Object.is(sourceResult, callbackResult)) {
        throw new Error("PostHog canary credential source violated the exact single-callback result contract.");
      }
      return sourceResult;
    } catch (error) {
      terminallyFailed = true;
      if (error instanceof Error && (
        error.message === "PostHog canary isolated credential source is single-use."
        || error.message === "PostHog canary isolated credential source failed."
        || error.message === "PostHog canary credential source violated the exact single-callback result contract."
      )) {
        throw error;
      }
      throw new Error("PostHog canary isolated credential source failed.");
    }
  };
}

export function createPostHogCanaryIsolatedRuntimeDependencies(
  activation: PostHogCanaryRuntimeActivation,
  infrastructure: PostHogCanaryIsolatedInfrastructure,
): PostHogCanaryRuntimeDependencies {
  assertActivationBoundary(activation);
  if (!infrastructure || typeof infrastructure !== "object") {
    throw new Error("PostHog canary isolated infrastructure is required.");
  }
  if (typeof infrastructure.killSwitchStateReader !== "function") {
    throw new Error("An injected PostHog canary kill-switch state reader is required.");
  }
  if (typeof infrastructure.credentialSource !== "function") {
    throw new Error("An injected callback-scoped PostHog credential source is required.");
  }
  if (typeof infrastructure.now !== "function") {
    throw new Error("An injected PostHog canary UTC clock is required.");
  }

  return Object.freeze({
    killSwitch: createKillSwitch(activation, infrastructure.killSwitchStateReader),
    credentialLeaseProvider: createCredentialLeaseProvider(activation, infrastructure.credentialSource),
    now: infrastructure.now,
  });
}
