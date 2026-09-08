import {
  createSelfDrivingGitHubInstallationActivation,
  type SelfDrivingGitHubInstallationActivation,
} from "./selfDrivingGithubInstallationRuntimeGate";
import type {
  SelfDrivingGitHubAppJwtSignRequest,
  SelfDrivingGitHubAppJwtSigner,
} from "./selfDrivingGithubInstallationTokenMint";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA =
  "solvelang.self-driving.github-private-key-signer-binding.v0" as const;
export const SELF_DRIVING_GITHUB_PRIVATE_KEY_LEASE_REQUEST_SCHEMA =
  "solvelang.self-driving.github-private-key-lease-request.v0" as const;
export const SELF_DRIVING_GITHUB_RS256_SIGNATURE_REQUEST_SCHEMA =
  "solvelang.self-driving.github-rs256-signature-request.v0" as const;

export const defaultSelfDrivingGitHubPrivateKeySignerLimits = Object.freeze({
  maxIssuerLength: 128,
  maxKeyRefLength: 256,
  maxLeaseIdLength: 128,
  maxSignatureLength: 2048,
  maxJwtLifetimeSeconds: 10 * 60,
  maxLeaseLifetimeMs: 15 * 60 * 1000,
  minLeaseRemainingMs: 30 * 1000,
});

export type SelfDrivingGitHubPrivateKeySignerBindingInput = Readonly<{
  appIssuer: string;
  keyRef: string;
  publicKeyFingerprintSha256: string;
}>;

export type SelfDrivingGitHubPrivateKeySignerBinding = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA;
  status: "bound";
  id: string;
  activationId: string;
  planId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  appIssuer: string;
  keyRef: string;
  publicKeyFingerprintSha256: string;
  notBefore: string;
  expiresAt: string;
  policy: Readonly<{
    exactActivationRequired: true;
    exactPlanRequired: true;
    exactIssuerRequired: true;
    exactKeyRefRequired: true;
    exactPublicKeyFingerprintRequired: true;
    isolatedLeaseProviderRequired: true;
    rawPrivateKeyMaterialAllowed: false;
    environmentFallbackAllowed: false;
    browserKeyAccessAllowed: false;
    builtInSecretStoreAccess: false;
    builtInCryptoEngine: false;
    signerSingleUse: true;
    leaseCallbackRevokedAfterProviderSettles: true;
    signatureCapabilitySingleCall: true;
    privateKeyMaterialReturned: false;
    jwtReturnedOnlyToInjectedMintCallback: true;
    automaticMergeAllowed: false;
    workflowDispatchAllowed: false;
    productionApplicationMutationAccess: false;
    billingMutationAccess: false;
    solveRunnerAuthority: false;
  }>;
}>;

export type SelfDrivingGitHubPrivateKeyLeaseRequest = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_PRIVATE_KEY_LEASE_REQUEST_SCHEMA;
  bindingId: string;
  activationId: string;
  planId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  appIssuer: string;
  keyRef: string;
  expectedPublicKeyFingerprintSha256: string;
  algorithm: "RS256";
  purpose: "github-app-jwt";
  requestedAt: string;
}>;

export type SelfDrivingGitHubRs256SignatureRequest = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_RS256_SIGNATURE_REQUEST_SCHEMA;
  bindingId: string;
  leaseId: string;
  algorithm: "RS256";
  signingInput: string;
}>;

export type SelfDrivingGitHubPrivateKeyLease = Readonly<{
  leaseId: string;
  keyRef: string;
  publicKeyFingerprintSha256: string;
  algorithm: "RS256";
  issuedAt: string;
  expiresAt: string;
  signRs256: (request: SelfDrivingGitHubRs256SignatureRequest) => Promise<string>;
}>;

export type SelfDrivingGitHubPrivateKeyLeaseProvider = <T>(
  request: SelfDrivingGitHubPrivateKeyLeaseRequest,
  withLease: (lease: SelfDrivingGitHubPrivateKeyLease) => Promise<T>,
) => Promise<T>;

export type SelfDrivingGitHubPrivateKeySignerDependencies = Readonly<{
  leaseProvider: SelfDrivingGitHubPrivateKeyLeaseProvider;
  now: () => string;
}>;

const textEncoder = new TextEncoder();
const credentialLikePatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_-]{8,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
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

function normalizeOpaqueId(value: string, name: string, maxLength: number): string {
  const normalized = normalizeText(value, name, maxLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized)) {
    throw new Error(`${name} contains unsupported identifier characters.`);
  }
  return normalized;
}

function normalizeIssuer(value: string): string {
  const normalized = normalizeText(value, "appIssuer", defaultSelfDrivingGitHubPrivateKeySignerLimits.maxIssuerLength);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error("appIssuer contains unsupported characters.");
  return normalized;
}

function normalizeFingerprint(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${name} must be an exact SHA-256 hex fingerprint.`);
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

function base64UrlJson(value: unknown): string {
  const bytes = textEncoder.encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for GitHub private-key signer binding.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recreateActivation(
  plan: SelfDrivingPrWriteExecutionPlan,
  activation: SelfDrivingGitHubInstallationActivation,
): Promise<SelfDrivingGitHubInstallationActivation> {
  const recreated = await createSelfDrivingGitHubInstallationActivation(plan, {
    state: "approved",
    operator: activation.operator,
    runtime: activation.runtime,
    notBefore: activation.notBefore,
    expiresAt: activation.expiresAt,
  });
  if (
    activation.id !== recreated.id
    || activation.schema !== recreated.schema
    || activation.state !== recreated.state
    || activation.planId !== recreated.planId
    || activation.approvalId !== recreated.approvalId
    || activation.approvalBindingSha256 !== recreated.approvalBindingSha256
    || activation.claimId !== recreated.claimId
    || activation.repository !== recreated.repository
    || activation.installationRef !== recreated.installationRef
    || activation.installationId !== recreated.installationId
    || JSON.stringify(activation.permissions) !== JSON.stringify(recreated.permissions)
    || JSON.stringify(activation.policy) !== JSON.stringify(recreated.policy)
  ) {
    throw new Error("GitHub signer binding requires the exact canonical installation activation.");
  }
  return recreated;
}

function bindingPolicy(): SelfDrivingGitHubPrivateKeySignerBinding["policy"] {
  return Object.freeze({
    exactActivationRequired: true as const,
    exactPlanRequired: true as const,
    exactIssuerRequired: true as const,
    exactKeyRefRequired: true as const,
    exactPublicKeyFingerprintRequired: true as const,
    isolatedLeaseProviderRequired: true as const,
    rawPrivateKeyMaterialAllowed: false as const,
    environmentFallbackAllowed: false as const,
    browserKeyAccessAllowed: false as const,
    builtInSecretStoreAccess: false as const,
    builtInCryptoEngine: false as const,
    signerSingleUse: true as const,
    leaseCallbackRevokedAfterProviderSettles: true as const,
    signatureCapabilitySingleCall: true as const,
    privateKeyMaterialReturned: false as const,
    jwtReturnedOnlyToInjectedMintCallback: true as const,
    automaticMergeAllowed: false as const,
    workflowDispatchAllowed: false as const,
    productionApplicationMutationAccess: false as const,
    billingMutationAccess: false as const,
    solveRunnerAuthority: false as const,
  });
}

export async function createSelfDrivingGitHubPrivateKeySignerBinding(
  plan: SelfDrivingPrWriteExecutionPlan,
  activation: SelfDrivingGitHubInstallationActivation,
  input: SelfDrivingGitHubPrivateKeySignerBindingInput,
): Promise<SelfDrivingGitHubPrivateKeySignerBinding> {
  const canonicalActivation = await recreateActivation(plan, activation);
  const appIssuer = normalizeIssuer(input.appIssuer);
  const keyRef = normalizeOpaqueId(input.keyRef, "keyRef", defaultSelfDrivingGitHubPrivateKeySignerLimits.maxKeyRefLength);
  const publicKeyFingerprintSha256 = normalizeFingerprint(
    input.publicKeyFingerprintSha256,
    "publicKeyFingerprintSha256",
  );
  const canonical = Object.freeze({
    activationId: canonicalActivation.id,
    planId: plan.id,
    repository: plan.repository,
    installationRef: canonicalActivation.installationRef,
    installationId: canonicalActivation.installationId,
    appIssuer,
    keyRef,
    publicKeyFingerprintSha256,
    notBefore: canonicalActivation.notBefore,
    expiresAt: canonicalActivation.expiresAt,
  });
  const identity = await sha256Hex(JSON.stringify(canonical));
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA,
    status: "bound" as const,
    id: `github_private_key_signer_binding_${identity}`,
    ...canonical,
    policy: bindingPolicy(),
  });
}

async function assertBinding(
  binding: SelfDrivingGitHubPrivateKeySignerBinding,
): Promise<SelfDrivingGitHubPrivateKeySignerBinding> {
  if (!binding || binding.schema !== SELF_DRIVING_GITHUB_PRIVATE_KEY_SIGNER_BINDING_SCHEMA || binding.status !== "bound") {
    throw new Error("A canonical GitHub private-key signer binding is required.");
  }
  const canonical = Object.freeze({
    activationId: normalizeOpaqueId(binding.activationId, "activationId", 160),
    planId: normalizeText(binding.planId, "planId", 96),
    repository: normalizeText(binding.repository, "repository", 201),
    installationRef: normalizeText(binding.installationRef, "installationRef", 128),
    installationId: binding.installationId,
    appIssuer: normalizeIssuer(binding.appIssuer),
    keyRef: normalizeOpaqueId(binding.keyRef, "keyRef", defaultSelfDrivingGitHubPrivateKeySignerLimits.maxKeyRefLength),
    publicKeyFingerprintSha256: normalizeFingerprint(binding.publicKeyFingerprintSha256, "publicKeyFingerprintSha256"),
    notBefore: normalizeUtc(binding.notBefore, "notBefore"),
    expiresAt: normalizeUtc(binding.expiresAt, "expiresAt"),
  });
  if (!Number.isSafeInteger(canonical.installationId) || canonical.installationId <= 0) {
    throw new Error("Signer binding installation ID is invalid.");
  }
  if (canonical.installationRef !== `github-app/installation:${canonical.installationId}`) {
    throw new Error("Signer binding installation ref/ID drifted.");
  }
  if (!/^pr_write_plan_[0-9a-f]{64}$/.test(canonical.planId)) throw new Error("Signer binding plan ID is malformed.");
  const expectedId = `github_private_key_signer_binding_${await sha256Hex(JSON.stringify(canonical))}`;
  if (binding.id !== expectedId) throw new Error("GitHub private-key signer binding SHA-256 identity does not match its contents.");
  if (JSON.stringify(binding.policy) !== JSON.stringify(bindingPolicy())) {
    throw new Error("GitHub private-key signer binding policy was weakened.");
  }
  return binding;
}

function validateSignRequest(
  binding: SelfDrivingGitHubPrivateKeySignerBinding,
  request: SelfDrivingGitHubAppJwtSignRequest,
  now: string,
): void {
  if (!request || request.schema !== "solvelang.self-driving.github-app-jwt-sign-request.v0") {
    throw new Error("GitHub App signer requires the canonical JWT sign request.");
  }
  if (request.algorithm !== "RS256") throw new Error("GitHub App signer only permits RS256.");
  if (request.issuer !== binding.appIssuer) throw new Error("GitHub App signer issuer drifted from the bound app issuer.");
  if (!Number.isSafeInteger(request.issuedAtEpochSeconds) || !Number.isSafeInteger(request.expiresAtEpochSeconds)) {
    throw new Error("GitHub App signer JWT timestamps must be safe integer seconds.");
  }
  if (request.expiresAtEpochSeconds <= request.issuedAtEpochSeconds
    || request.expiresAtEpochSeconds - request.issuedAtEpochSeconds > defaultSelfDrivingGitHubPrivateKeySignerLimits.maxJwtLifetimeSeconds) {
    throw new Error("GitHub App signer JWT lifetime exceeds the ten-minute bound.");
  }
  const nowEpoch = Date.parse(now);
  if (nowEpoch < Date.parse(binding.notBefore) || nowEpoch >= Date.parse(binding.expiresAt)) {
    throw new Error("GitHub private-key signer binding is outside its activation window.");
  }
  if (request.expiresAtEpochSeconds * 1000 > Date.parse(binding.expiresAt)) {
    throw new Error("GitHub App JWT may not outlive the signer activation window.");
  }
}

function leaseRequest(
  binding: SelfDrivingGitHubPrivateKeySignerBinding,
  now: string,
): SelfDrivingGitHubPrivateKeyLeaseRequest {
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_PRIVATE_KEY_LEASE_REQUEST_SCHEMA,
    bindingId: binding.id,
    activationId: binding.activationId,
    planId: binding.planId,
    repository: binding.repository,
    installationRef: binding.installationRef,
    installationId: binding.installationId,
    appIssuer: binding.appIssuer,
    keyRef: binding.keyRef,
    expectedPublicKeyFingerprintSha256: binding.publicKeyFingerprintSha256,
    algorithm: "RS256" as const,
    purpose: "github-app-jwt" as const,
    requestedAt: now,
  });
}

function validateLease(
  binding: SelfDrivingGitHubPrivateKeySignerBinding,
  lease: SelfDrivingGitHubPrivateKeyLease,
  now: string,
): SelfDrivingGitHubPrivateKeyLease {
  if (!lease || typeof lease !== "object") throw new Error("Private-key lease is required.");
  const exactKeys = Object.keys(lease).sort().join(",");
  if (exactKeys !== "algorithm,expiresAt,issuedAt,keyRef,leaseId,publicKeyFingerprintSha256,signRs256") {
    throw new Error("Private-key lease contains unsupported fields or raw key material.");
  }
  const leaseId = normalizeOpaqueId(lease.leaseId, "leaseId", defaultSelfDrivingGitHubPrivateKeySignerLimits.maxLeaseIdLength);
  if (normalizeOpaqueId(lease.keyRef, "lease.keyRef", defaultSelfDrivingGitHubPrivateKeySignerLimits.maxKeyRefLength) !== binding.keyRef) {
    throw new Error("Private-key lease keyRef drifted from the signer binding.");
  }
  if (normalizeFingerprint(lease.publicKeyFingerprintSha256, "lease.publicKeyFingerprintSha256") !== binding.publicKeyFingerprintSha256) {
    throw new Error("Private-key lease public-key fingerprint drifted from the signer binding.");
  }
  if (lease.algorithm !== "RS256") throw new Error("Private-key lease algorithm must be RS256.");
  if (typeof lease.signRs256 !== "function") throw new Error("Private-key lease must expose one RS256 signing capability.");
  const issuedAt = normalizeUtc(lease.issuedAt, "lease.issuedAt");
  const expiresAt = normalizeUtc(lease.expiresAt, "lease.expiresAt");
  const nowEpoch = Date.parse(now);
  const issuedEpoch = Date.parse(issuedAt);
  const expiresEpoch = Date.parse(expiresAt);
  if (issuedEpoch > nowEpoch || expiresEpoch <= nowEpoch) throw new Error("Private-key lease is not currently valid.");
  if (expiresEpoch - issuedEpoch > defaultSelfDrivingGitHubPrivateKeySignerLimits.maxLeaseLifetimeMs) {
    throw new Error("Private-key lease exceeds the fifteen-minute lifetime bound.");
  }
  if (expiresEpoch - nowEpoch < defaultSelfDrivingGitHubPrivateKeySignerLimits.minLeaseRemainingMs) {
    throw new Error("Private-key lease has insufficient remaining lifetime.");
  }
  return Object.freeze({ ...lease, leaseId, issuedAt, expiresAt });
}

function normalizeSignature(value: string): string {
  if (typeof value !== "string" || !value || value.length > defaultSelfDrivingGitHubPrivateKeySignerLimits.maxSignatureLength) {
    throw new Error("RS256 signature must be bounded non-empty base64url text.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("RS256 signature must be base64url without padding or separators.");
  return value;
}

export async function createSelfDrivingGitHubPrivateKeyJwtSigner(
  bindingInput: SelfDrivingGitHubPrivateKeySignerBinding,
  dependencies: SelfDrivingGitHubPrivateKeySignerDependencies,
): Promise<SelfDrivingGitHubAppJwtSigner> {
  const binding = await assertBinding(bindingInput);
  if (!dependencies || typeof dependencies !== "object") throw new Error("GitHub private-key signer dependencies are required.");
  if (typeof dependencies.leaseProvider !== "function") throw new Error("An injected private-key lease provider is required.");
  if (typeof dependencies.now !== "function") throw new Error("An injected UTC clock is required.");

  let signerUsed = false;
  let signerInFlight = false;
  let terminallyFailed = false;

  const signer: SelfDrivingGitHubAppJwtSigner = async <T>(
    request: SelfDrivingGitHubAppJwtSignRequest,
    withJwt: (jwt: string) => Promise<T>,
  ): Promise<T> => {
    if (terminallyFailed) throw new Error("GitHub private-key signer is terminally failed.");
    if (signerUsed || signerInFlight) {
      terminallyFailed = true;
      throw new Error("GitHub private-key signer is single-use per activation binding.");
    }
    signerInFlight = true;
    try {
      const now = normalizeUtc(dependencies.now(), "signer.now");
      validateSignRequest(binding, request, now);
      if (typeof withJwt !== "function") throw new Error("GitHub App JWT consumer callback is required.");
      const header = base64UrlJson({ typ: "JWT", alg: "RS256" });
      const payload = base64UrlJson({
        iat: request.issuedAtEpochSeconds,
        exp: request.expiresAtEpochSeconds,
        iss: request.issuer,
      });
      const signingInput = `${header}.${payload}`;
      const requestLease = leaseRequest(binding, now);

      let leaseCallbackActive = true;
      let leaseCallbackEntered = false;
      let leaseCallbackCompleted = false;
      let providerReentered = false;
      let callbackJwt: string | undefined;
      let providerJwt: string;
      try {
        providerJwt = await dependencies.leaseProvider<string>(requestLease, async (rawLease) => {
          if (!leaseCallbackActive) throw new Error("Private-key lease callback is no longer active.");
          if (leaseCallbackEntered) {
            providerReentered = true;
            throw new Error("Private-key lease provider re-entered the callback.");
          }
          leaseCallbackEntered = true;
          const lease = validateLease(binding, rawLease, now);
          let signatureCalls = 0;
          const signatureRequest: SelfDrivingGitHubRs256SignatureRequest = Object.freeze({
            schema: SELF_DRIVING_GITHUB_RS256_SIGNATURE_REQUEST_SCHEMA,
            bindingId: binding.id,
            leaseId: lease.leaseId,
            algorithm: "RS256" as const,
            signingInput,
          });
          let rawSignature: string;
          try {
            signatureCalls += 1;
            rawSignature = await lease.signRs256(signatureRequest);
          } catch {
            throw new Error("Isolated RS256 signing capability failed.");
          }
          if (signatureCalls !== 1) throw new Error("RS256 signing capability must be called exactly once.");
          const signature = normalizeSignature(rawSignature);
          const jwt = `${signingInput}.${signature}`;
          callbackJwt = jwt;
          leaseCallbackCompleted = true;
          return jwt;
        });
      } catch {
        throw new Error("GitHub private-key lease/signing failed.");
      } finally {
        leaseCallbackActive = false;
      }
      if (!leaseCallbackEntered || !leaseCallbackCompleted || providerReentered || providerJwt !== callbackJwt) {
        throw new Error("Private-key lease provider violated the exact single-callback result contract.");
      }

      let consumerCalls = 0;
      let consumerResult: T | undefined;
      consumerCalls += 1;
      const result = await withJwt(providerJwt);
      consumerResult = result;
      if (consumerCalls !== 1 || !Object.is(result, consumerResult)) {
        throw new Error("GitHub App JWT consumer violated the single-callback contract.");
      }
      signerUsed = true;
      signerInFlight = false;
      return result;
    } catch (error) {
      terminallyFailed = true;
      signerInFlight = false;
      throw error instanceof Error && (
        error.message === "GitHub private-key signer is single-use per activation binding."
        || error.message === "GitHub private-key lease/signing failed."
        || error.message === "Private-key lease provider violated the exact single-callback result contract."
      )
        ? error
        : new Error("GitHub private-key signer failed.");
    }
  };

  return signer;
}