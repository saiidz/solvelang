import { createSelfDrivingGitHubPrWriteAdapter } from "./selfDrivingGithubPrWriteAdapter";
import type { SelfDrivingGitHubRestPermission } from "./selfDrivingGithubRestPlanner";
import type {
  SelfDrivingGitHubAuthorizationBroker,
  SelfDrivingGitHubRestTransport,
} from "./selfDrivingGithubRestTransport";
import type { SelfDrivingPrWriteAdapter } from "./selfDrivingPrWriteExecutor";
import type { SelfDrivingPrWriteExecutionPlan } from "./selfDrivingPrWriteExecutionPlan";

export const SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA =
  "solvelang.self-driving.github-installation-runtime-activation.v0" as const;
export const SELF_DRIVING_GITHUB_INSTALLATION_GATE_REQUEST_SCHEMA =
  "solvelang.self-driving.github-installation-runtime-gate-request.v0" as const;
export const SELF_DRIVING_GITHUB_INSTALLATION_CREDENTIAL_REQUEST_SCHEMA =
  "solvelang.self-driving.github-installation-credential-request.v0" as const;

export const defaultSelfDrivingGitHubInstallationRuntimeLimits = Object.freeze({
  maxActivationWindowMs: 15 * 60 * 1000,
  maxCredentialLifetimeMs: 61 * 60 * 1000,
  minCredentialRemainingMs: 30 * 1000,
  maxOperatorLength: 128,
  maxRuntimeLength: 128,
  maxEvidenceIdLength: 128,
  maxCredentialIdLength: 128,
  maxTokenLength: 4096,
});

export type SelfDrivingGitHubInstallationPermissions = Readonly<{
  metadata: "read";
  contents: "write";
  pullRequests: "write";
}>;

export type SelfDrivingGitHubInstallationActivationInput = Readonly<{
  state: "approved";
  operator: string;
  runtime: string;
  notBefore: string;
  expiresAt: string;
}>;

export type SelfDrivingGitHubInstallationActivation = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA;
  state: "approved";
  id: string;
  planId: string;
  approvalId: string;
  approvalBindingSha256: string;
  claimId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  permissions: SelfDrivingGitHubInstallationPermissions;
  operator: string;
  runtime: string;
  notBefore: string;
  expiresAt: string;
  policy: Readonly<{
    disabledByDefault: true;
    externalRuntimeGateRequired: true;
    exactPlanBindingRequired: true;
    exactInstallationBindingRequired: true;
    exactSingleRepositoryScopeRequired: true;
    exactLeastPrivilegeRequired: true;
    shortLivedCredentialRequired: true;
    credentialProviderInjected: true;
    privateKeyAccess: false;
    jwtMintingAccess: false;
    builtInCredentialStoreAccess: false;
    tokenSerializationAllowed: false;
    tokenReturnAllowed: false;
    automaticMergeAllowed: false;
    workflowDispatchAllowed: false;
    forcePushAllowed: false;
    directProtectedBaseWriteAllowed: false;
    providerAccess: false;
    billingMutationAccess: false;
    productionApplicationMutationAccess: false;
    solveRunnerAuthority: false;
  }>;
}>;

export type SelfDrivingGitHubInstallationRuntimeGateRequest = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_INSTALLATION_GATE_REQUEST_SCHEMA;
  activationId: string;
  planId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  permission: SelfDrivingGitHubRestPermission;
  checkedAt: string;
}>;

export type SelfDrivingGitHubInstallationRuntimeGateResult =
  | Readonly<{ status: "allowed"; activationId: string; gateEvidenceId: string }>
  | Readonly<{
      status: "blocked";
      reason: "disabled" | "kill-switch" | "activation-not-found" | "runtime-rejected";
    }>;

export type SelfDrivingGitHubInstallationRuntimeGate = (
  request: SelfDrivingGitHubInstallationRuntimeGateRequest,
) => Promise<SelfDrivingGitHubInstallationRuntimeGateResult>;

export type SelfDrivingGitHubInstallationCredentialRequest = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_INSTALLATION_CREDENTIAL_REQUEST_SCHEMA;
  activationId: string;
  planId: string;
  repository: string;
  repositories: readonly [string];
  installationRef: string;
  installationId: number;
  permission: SelfDrivingGitHubRestPermission;
  permissions: SelfDrivingGitHubInstallationPermissions;
  requestedAt: string;
}>;

export type SelfDrivingGitHubInstallationCredential = Readonly<{
  token: string;
  credentialId: string;
  installationRef: string;
  repositories: readonly string[];
  permissions: SelfDrivingGitHubInstallationPermissions;
  issuedAt: string;
  expiresAt: string;
}>;

export type SelfDrivingGitHubInstallationCredentialProvider = <T>(
  request: SelfDrivingGitHubInstallationCredentialRequest,
  withCredential: (credential: SelfDrivingGitHubInstallationCredential) => Promise<T>,
) => Promise<T>;

export type SelfDrivingGitHubInstallationRuntimeDependencies = Readonly<{
  runtimeGate: SelfDrivingGitHubInstallationRuntimeGate;
  credentialProvider: SelfDrivingGitHubInstallationCredentialProvider;
  transport: SelfDrivingGitHubRestTransport;
  now: () => string;
}>;

const textEncoder = new TextEncoder();
const permissionSet: SelfDrivingGitHubInstallationPermissions = Object.freeze({
  metadata: "read",
  contents: "write",
  pullRequests: "write",
});
const allowedRestPermissions = new Set<SelfDrivingGitHubRestPermission>([
  "metadata:read",
  "contents:read",
  "contents:write",
  "pull-requests:write",
]);
const credentialLikePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9_-]{8,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
] as const;

type InstallationIdentity = Readonly<{ installationRef: string; installationId: number }>;
type ActivationCanonical = Readonly<{
  planId: string;
  approvalId: string;
  approvalBindingSha256: string;
  claimId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  permissions: SelfDrivingGitHubInstallationPermissions;
  operator: string;
  runtime: string;
  notBefore: string;
  expiresAt: string;
}>;

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
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error(`${name} contains unsupported identifier characters.`);
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

function parseInstallationRef(value: string): InstallationIdentity {
  const installationRef = normalizeText(value, "installationRef", 128);
  const match = /^github-app\/installation:([1-9]\d{0,15})$/.exec(installationRef);
  if (!match) throw new Error("installationRef must use github-app/installation:<positive-id> syntax.");
  const installationId = Number(match[1]);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("installationRef installation ID is outside the safe integer range.");
  }
  return Object.freeze({ installationRef, installationId });
}

function exactPermissions(value: SelfDrivingGitHubInstallationPermissions): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === "contents"
    && keys[1] === "metadata"
    && keys[2] === "pullRequests"
    && value.metadata === "read"
    && value.contents === "write"
    && value.pullRequests === "write";
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for GitHub installation activation.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertPlan(plan: SelfDrivingPrWriteExecutionPlan): Promise<InstallationIdentity> {
  if (!plan || typeof plan !== "object" || plan.schema !== "solvelang.self-driving.pr-write-execution-plan.v0") {
    throw new Error("A canonical PR write execution plan is required.");
  }
  if (plan.mode !== "no-write-execution-plan" || plan.status !== "ready-for-separate-github-executor") {
    throw new Error("GitHub installation runtime requires the ready no-write execution plan.");
  }
  if (!/^pr_write_plan_[0-9a-f]{64}$/.test(plan.id)) throw new Error("Execution plan ID is malformed.");
  if (!/^[0-9a-f]{64}$/.test(plan.approvalBindingSha256)) throw new Error("Execution plan approval binding is malformed.");
  normalizeUtc(plan.claimedAt, "plan.claimedAt");
  if (
    plan.requiredPermissions.metadata !== "read"
    || plan.requiredPermissions.contents !== "write"
    || plan.requiredPermissions.pullRequests !== "write"
  ) {
    throw new Error("GitHub installation runtime requires the exact least-privilege PR-write permission contract.");
  }
  const policy = plan.policy;
  if (
    !policy
    || policy.sourceArtifactsRecreated !== true
    || policy.cryptographicApprovalBindingVerified !== true
    || policy.successfulSingleUseClaimRequired !== true
    || policy.exactBaseRevisionRequiredAtExecution !== true
    || policy.freshBranchProtectionRequiredAtExecution !== true
    || policy.headBranchMustNotExistAtExecution !== true
    || policy.baseBlobShaMatchRequiredAtExecution !== true
    || policy.directPushToBaseAllowed !== false
    || policy.directPushToProtectedBranchAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.automaticMergeAllowed !== false
    || policy.credentialResolutionAccess !== false
    || policy.githubApiAccess !== false
    || policy.repositoryWriteAccess !== false
    || policy.productionMutationAccess !== false
    || policy.billingMutationAccess !== false
    || policy.solveRunnerAuthority !== false
    || policy.externalSideEffects !== false
    || policy.writeExecutionStatus !== "not-executed"
  ) {
    throw new Error("GitHub installation runtime requires the safe reviewed execution-plan policy.");
  }
  const canonicalPlan = {
    repository: plan.repository,
    baseBranch: plan.baseBranch,
    baseRevision: plan.baseRevision,
    headBranch: plan.headBranch,
    installationRef: plan.installationRef,
    approvalId: plan.approvalId,
    approvalBindingSha256: plan.approvalBindingSha256,
    claimId: plan.claimId,
    claimedAt: plan.claimedAt,
    requiredPermissions: plan.requiredPermissions,
    plannedActions: plan.plannedActions,
    requiredLiveChecks: plan.requiredLiveChecks,
    branchProtectionEvidence: plan.branchProtectionEvidence,
    selectedProposals: plan.selectedProposals,
    files: plan.files,
    limits: plan.limits,
    totals: plan.totals,
  };
  const expectedId = `pr_write_plan_${await sha256Hex(JSON.stringify(canonicalPlan))}`;
  if (plan.id !== expectedId) throw new Error("GitHub installation runtime execution-plan SHA-256 identity is invalid.");
  return parseInstallationRef(plan.installationRef);
}

function activationPolicy(): SelfDrivingGitHubInstallationActivation["policy"] {
  return Object.freeze({
    disabledByDefault: true as const,
    externalRuntimeGateRequired: true as const,
    exactPlanBindingRequired: true as const,
    exactInstallationBindingRequired: true as const,
    exactSingleRepositoryScopeRequired: true as const,
    exactLeastPrivilegeRequired: true as const,
    shortLivedCredentialRequired: true as const,
    credentialProviderInjected: true as const,
    privateKeyAccess: false as const,
    jwtMintingAccess: false as const,
    builtInCredentialStoreAccess: false as const,
    tokenSerializationAllowed: false as const,
    tokenReturnAllowed: false as const,
    automaticMergeAllowed: false as const,
    workflowDispatchAllowed: false as const,
    forcePushAllowed: false as const,
    directProtectedBaseWriteAllowed: false as const,
    providerAccess: false as const,
    billingMutationAccess: false as const,
    productionApplicationMutationAccess: false as const,
    solveRunnerAuthority: false as const,
  });
}

function activationCanonical(
  plan: SelfDrivingPrWriteExecutionPlan,
  installation: InstallationIdentity,
  input: SelfDrivingGitHubInstallationActivationInput,
): ActivationCanonical {
  const operator = normalizeText(input.operator, "operator", defaultSelfDrivingGitHubInstallationRuntimeLimits.maxOperatorLength);
  const runtime = normalizeText(input.runtime, "runtime", defaultSelfDrivingGitHubInstallationRuntimeLimits.maxRuntimeLength);
  const notBefore = normalizeUtc(input.notBefore, "notBefore");
  const expiresAt = normalizeUtc(input.expiresAt, "expiresAt");
  const start = Date.parse(notBefore);
  const end = Date.parse(expiresAt);
  const claimed = Date.parse(normalizeUtc(plan.claimedAt, "plan.claimedAt"));
  if (end <= start) throw new Error("GitHub installation activation expiresAt must be after notBefore.");
  if (end - start > defaultSelfDrivingGitHubInstallationRuntimeLimits.maxActivationWindowMs) {
    throw new Error("GitHub installation activation exceeds the 15-minute window.");
  }
  if (start < claimed) throw new Error("GitHub installation activation may not begin before the PR-write claim.");
  return Object.freeze({
    planId: plan.id,
    approvalId: plan.approvalId,
    approvalBindingSha256: plan.approvalBindingSha256,
    claimId: plan.claimId,
    repository: plan.repository,
    installationRef: installation.installationRef,
    installationId: installation.installationId,
    permissions: permissionSet,
    operator,
    runtime,
    notBefore,
    expiresAt,
  });
}

export async function createSelfDrivingGitHubInstallationActivation(
  plan: SelfDrivingPrWriteExecutionPlan,
  input: SelfDrivingGitHubInstallationActivationInput,
): Promise<SelfDrivingGitHubInstallationActivation> {
  const installation = await assertPlan(plan);
  if (!input || input.state !== "approved") throw new Error("An explicit approved GitHub installation activation is required.");
  const canonical = activationCanonical(plan, installation, input);
  const binding = await sha256Hex(JSON.stringify(canonical));
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA,
    state: "approved" as const,
    id: `github_installation_activation_${binding}`,
    ...canonical,
    policy: activationPolicy(),
  });
}

async function assertActivation(
  plan: SelfDrivingPrWriteExecutionPlan,
  activation: SelfDrivingGitHubInstallationActivation,
): Promise<SelfDrivingGitHubInstallationActivation> {
  const installation = await assertPlan(plan);
  if (!activation || activation.schema !== SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA || activation.state !== "approved") {
    throw new Error("A canonical approved GitHub installation activation is required.");
  }
  const canonical = activationCanonical(plan, installation, activation);
  const expectedId = `github_installation_activation_${await sha256Hex(JSON.stringify(canonical))}`;
  if (activation.id !== expectedId) throw new Error("GitHub installation activation SHA-256 identity does not match its contents.");
  if (
    activation.planId !== canonical.planId
    || activation.approvalId !== canonical.approvalId
    || activation.approvalBindingSha256 !== canonical.approvalBindingSha256
    || activation.claimId !== canonical.claimId
    || activation.repository !== canonical.repository
    || activation.installationRef !== canonical.installationRef
    || activation.installationId !== canonical.installationId
    || !exactPermissions(activation.permissions)
  ) {
    throw new Error("GitHub installation activation binding drifted from the execution plan.");
  }
  const policy = activation.policy;
  if (
    !policy
    || policy.disabledByDefault !== true
    || policy.externalRuntimeGateRequired !== true
    || policy.exactPlanBindingRequired !== true
    || policy.exactInstallationBindingRequired !== true
    || policy.exactSingleRepositoryScopeRequired !== true
    || policy.exactLeastPrivilegeRequired !== true
    || policy.shortLivedCredentialRequired !== true
    || policy.credentialProviderInjected !== true
    || policy.privateKeyAccess !== false
    || policy.jwtMintingAccess !== false
    || policy.builtInCredentialStoreAccess !== false
    || policy.tokenSerializationAllowed !== false
    || policy.tokenReturnAllowed !== false
    || policy.automaticMergeAllowed !== false
    || policy.workflowDispatchAllowed !== false
    || policy.forcePushAllowed !== false
    || policy.directProtectedBaseWriteAllowed !== false
    || policy.providerAccess !== false
    || policy.billingMutationAccess !== false
    || policy.productionApplicationMutationAccess !== false
    || policy.solveRunnerAuthority !== false
  ) {
    throw new Error("GitHub installation activation policy is not the canonical disabled-by-default policy.");
  }
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_INSTALLATION_ACTIVATION_SCHEMA,
    state: "approved" as const,
    id: expectedId,
    ...canonical,
    policy: activationPolicy(),
  });
}

function assertDependencies(value: SelfDrivingGitHubInstallationRuntimeDependencies): void {
  if (!value || typeof value !== "object") throw new Error("GitHub installation runtime dependencies are required.");
  if (typeof value.runtimeGate !== "function") throw new Error("An injected GitHub installation runtime gate is required.");
  if (typeof value.credentialProvider !== "function") throw new Error("An injected GitHub installation credential provider is required.");
  if (typeof value.transport !== "function") throw new Error("An injected bounded GitHub transport is required.");
  if (typeof value.now !== "function") throw new Error("An injected UTC clock is required.");
}

function normalizeToken(value: string): string {
  if (typeof value !== "string" || value.length < 16 || value.length > defaultSelfDrivingGitHubInstallationRuntimeLimits.maxTokenLength) {
    throw new Error("GitHub installation credential token is malformed.");
  }
  if (/\s|[\u0000-\u001f\u007f]/.test(value)) throw new Error("GitHub installation credential token is malformed.");
  return value;
}

async function normalizeCredential(
  credential: SelfDrivingGitHubInstallationCredential,
  activation: SelfDrivingGitHubInstallationActivation,
  checkedAt: string,
): Promise<Readonly<{
  token: string;
  tokenBindingSha256: string;
  credentialId: string;
  issuedAt: string;
  expiresAt: string;
}>> {
  if (!credential || typeof credential !== "object") throw new Error("GitHub installation credential is required.");
  const token = normalizeToken(credential.token);
  const credentialId = normalizeOpaqueId(
    credential.credentialId,
    "credentialId",
    defaultSelfDrivingGitHubInstallationRuntimeLimits.maxCredentialIdLength,
  );
  if (credential.installationRef !== activation.installationRef) {
    throw new Error("GitHub installation credential installation binding drifted.");
  }
  if (!Array.isArray(credential.repositories) || credential.repositories.length !== 1 || credential.repositories[0] !== activation.repository) {
    throw new Error("GitHub installation credential must be scoped to exactly the approved repository.");
  }
  if (!exactPermissions(credential.permissions)) {
    throw new Error("GitHub installation credential permissions are broader or different from the approved permission set.");
  }
  const issuedAt = normalizeUtc(credential.issuedAt, "credential.issuedAt");
  const expiresAt = normalizeUtc(credential.expiresAt, "credential.expiresAt");
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  const checked = Date.parse(checkedAt);
  if (issued < Date.parse(activation.notBefore)) throw new Error("GitHub installation credential was issued before the activation window.");
  if (issued > checked) throw new Error("GitHub installation credential may not be future-issued.");
  if (expires <= checked + defaultSelfDrivingGitHubInstallationRuntimeLimits.minCredentialRemainingMs) {
    throw new Error("GitHub installation credential does not have enough remaining lifetime.");
  }
  if (expires <= issued || expires - issued > defaultSelfDrivingGitHubInstallationRuntimeLimits.maxCredentialLifetimeMs) {
    throw new Error("GitHub installation credential lifetime exceeds the bounded short-lived contract.");
  }
  return Object.freeze({
    token,
    tokenBindingSha256: await sha256Hex(token),
    credentialId,
    issuedAt,
    expiresAt,
  });
}

function assertPermission(permission: SelfDrivingGitHubRestPermission): void {
  if (!allowedRestPermissions.has(permission)) throw new Error("GitHub installation runtime requested an unsupported permission.");
}

function makeGateRequest(
  activation: SelfDrivingGitHubInstallationActivation,
  permission: SelfDrivingGitHubRestPermission,
  checkedAt: string,
): SelfDrivingGitHubInstallationRuntimeGateRequest {
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_INSTALLATION_GATE_REQUEST_SCHEMA,
    activationId: activation.id,
    planId: activation.planId,
    repository: activation.repository,
    installationRef: activation.installationRef,
    installationId: activation.installationId,
    permission,
    checkedAt,
  });
}

function makeCredentialRequest(
  activation: SelfDrivingGitHubInstallationActivation,
  permission: SelfDrivingGitHubRestPermission,
  requestedAt: string,
): SelfDrivingGitHubInstallationCredentialRequest {
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_INSTALLATION_CREDENTIAL_REQUEST_SCHEMA,
    activationId: activation.id,
    planId: activation.planId,
    repository: activation.repository,
    repositories: Object.freeze([activation.repository]) as readonly [string],
    installationRef: activation.installationRef,
    installationId: activation.installationId,
    permission,
    permissions: permissionSet,
    requestedAt,
  });
}

function makeAuthorizationBroker(
  activation: SelfDrivingGitHubInstallationActivation,
  dependencies: SelfDrivingGitHubInstallationRuntimeDependencies,
): SelfDrivingGitHubAuthorizationBroker {
  let lastCheckedEpoch: number | undefined;
  let terminallyFailed = false;
  let credentialSession: Readonly<{
    credentialId: string;
    tokenBindingSha256: string;
    issuedAt: string;
    expiresAt: string;
  }> | undefined;

  return async function broker<T>(permission: SelfDrivingGitHubRestPermission, withToken: (token: string) => Promise<T>): Promise<T> {
    if (terminallyFailed) throw new Error("GitHub installation runtime is terminally failed.");
    try {
      assertPermission(permission);
      const checkedAt = normalizeUtc(dependencies.now(), "runtime.checkedAt");
      const checkedEpoch = Date.parse(checkedAt);
      if (lastCheckedEpoch !== undefined && checkedEpoch < lastCheckedEpoch) {
        throw new Error("GitHub installation runtime clock moved backwards.");
      }
      lastCheckedEpoch = checkedEpoch;
      if (checkedEpoch < Date.parse(activation.notBefore) || checkedEpoch >= Date.parse(activation.expiresAt)) {
        throw new Error("GitHub installation runtime activation is not currently active.");
      }

      let gate: SelfDrivingGitHubInstallationRuntimeGateResult;
      try {
        gate = await dependencies.runtimeGate(makeGateRequest(activation, permission, checkedAt));
      } catch {
        throw new Error("GitHub installation runtime gate failed.");
      }
      if (!gate || gate.status !== "allowed" || gate.activationId !== activation.id) {
        throw new Error("GitHub installation runtime gate did not allow the exact activation.");
      }
      normalizeOpaqueId(gate.gateEvidenceId, "gateEvidenceId", defaultSelfDrivingGitHubInstallationRuntimeLimits.maxEvidenceIdLength);

      const request = makeCredentialRequest(activation, permission, checkedAt);
      let callbackEntered = false;
      let callbackCompleted = false;
      let providerReentered = false;
      let callbackResult: T | undefined;
      let providerResult: T;
      try {
        providerResult = await dependencies.credentialProvider<T>(request, async (credential) => {
          if (callbackEntered) {
            providerReentered = true;
            throw new Error("GitHub installation credential provider re-entered the credential callback.");
          }
          callbackEntered = true;
          const normalized = await normalizeCredential(credential, activation, checkedAt);
          if (!credentialSession) {
            credentialSession = Object.freeze({
              credentialId: normalized.credentialId,
              tokenBindingSha256: normalized.tokenBindingSha256,
              issuedAt: normalized.issuedAt,
              expiresAt: normalized.expiresAt,
            });
          } else if (
            credentialSession.credentialId !== normalized.credentialId
            || credentialSession.tokenBindingSha256 !== normalized.tokenBindingSha256
            || credentialSession.issuedAt !== normalized.issuedAt
            || credentialSession.expiresAt !== normalized.expiresAt
          ) {
            throw new Error("GitHub installation credential provider changed credential session during one execution.");
          }
          const result = await withToken(normalized.token);
          callbackResult = result;
          callbackCompleted = true;
          return result;
        });
      } catch {
        throw new Error("GitHub installation credential provider failed.");
      }
      if (!callbackEntered || !callbackCompleted || providerReentered || !Object.is(providerResult, callbackResult)) {
        throw new Error("GitHub installation credential provider violated the exact single-callback result contract.");
      }
      return providerResult;
    } catch (error) {
      terminallyFailed = true;
      throw error;
    }
  };
}

export async function createSelfDrivingGitHubInstallationRuntimeAdapter(
  plan: SelfDrivingPrWriteExecutionPlan,
  activationInput: SelfDrivingGitHubInstallationActivation,
  dependencies: SelfDrivingGitHubInstallationRuntimeDependencies,
): Promise<SelfDrivingPrWriteAdapter> {
  const activation = await assertActivation(plan, activationInput);
  assertDependencies(dependencies);
  const boundPlanId = plan.id;
  const concrete = createSelfDrivingGitHubPrWriteAdapter({
    authorizationBroker: makeAuthorizationBroker(activation, dependencies),
    transport: dependencies.transport,
    now: dependencies.now,
  });
  return Object.freeze({
    verifyLivePreflight: async (candidatePlan, signal) => {
      await assertPlan(candidatePlan);
      if (candidatePlan.id !== boundPlanId) {
        throw new Error("GitHub installation runtime adapter received a different execution plan.");
      }
      return concrete.verifyLivePreflight(candidatePlan, signal);
    },
    createBranch: concrete.createBranch,
    createCommit: concrete.createCommit,
    openPullRequest: concrete.openPullRequest,
  });
}
