import type {
  SelfDrivingGitHubInstallationCredential,
  SelfDrivingGitHubInstallationCredentialProvider,
  SelfDrivingGitHubInstallationCredentialRequest,
} from "./selfDrivingGithubInstallationRuntimeGate";

export const SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA =
  "solvelang.self-driving.github-installation-token-mint.v0" as const;
export const SELF_DRIVING_GITHUB_APP_JWT_SIGN_REQUEST_SCHEMA =
  "solvelang.self-driving.github-app-jwt-sign-request.v0" as const;
export const SELF_DRIVING_GITHUB_TOKEN_API_ORIGIN = "https://api.github.com" as const;
export const SELF_DRIVING_GITHUB_TOKEN_API_VERSION = "2026-03-10" as const;
export const SELF_DRIVING_GITHUB_TOKEN_ACCEPT = "application/vnd.github+json" as const;

export const defaultSelfDrivingGitHubInstallationTokenMintLimits = Object.freeze({
  maxResponseBytes: 1_048_576,
  maxJwtLength: 8192,
  maxTokenLength: 4096,
  maxIssuerLength: 128,
  maxCredentialIdLength: 128,
  jwtPastSkewSeconds: 60,
  jwtLifetimeSeconds: 9 * 60,
  jwtMaximumFutureSeconds: 10 * 60,
  cachedTokenMinRemainingMs: 60 * 1000,
});

export type SelfDrivingGitHubAppJwtSignRequest = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_APP_JWT_SIGN_REQUEST_SCHEMA;
  algorithm: "RS256";
  issuer: string;
  issuedAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
}>;

export type SelfDrivingGitHubAppJwtSigner = <T>(
  request: SelfDrivingGitHubAppJwtSignRequest,
  withJwt: (jwt: string) => Promise<T>,
) => Promise<T>;

export type SelfDrivingGitHubInstallationTokenMintRequestPlan = Readonly<{
  schema: typeof SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA;
  operation: "create-installation-access-token";
  method: "POST";
  origin: typeof SELF_DRIVING_GITHUB_TOKEN_API_ORIGIN;
  path: string;
  url: string;
  headers: Readonly<{
    Accept: typeof SELF_DRIVING_GITHUB_TOKEN_ACCEPT;
    "X-GitHub-Api-Version": typeof SELF_DRIVING_GITHUB_TOKEN_API_VERSION;
  }>;
  body: Readonly<{
    repositories: readonly [string];
    permissions: Readonly<{
      contents: "write";
      pull_requests: "write";
    }>;
  }>;
  expectedStatus: 201;
  maxResponseBytes: number;
  policy: Readonly<{
    exactInstallationRequired: true;
    exactSingleRepositoryRequired: true;
    exactPermissionsRequired: true;
    authorizationHeaderIncluded: false;
    jwtMaterialIncluded: false;
    privateKeyMaterialIncluded: false;
    redirectsAllowed: false;
    retries: 0;
  }>;
}>;

export type SelfDrivingGitHubInstallationTokenMintTransportRequest = Readonly<{
  method: "POST";
  url: string;
  headers: Readonly<{
    Accept: typeof SELF_DRIVING_GITHUB_TOKEN_ACCEPT;
    "X-GitHub-Api-Version": typeof SELF_DRIVING_GITHUB_TOKEN_API_VERSION;
    Authorization: string;
    "Content-Type": "application/json";
  }>;
  bodyText: string;
  redirect: "error";
}>;

export type SelfDrivingGitHubInstallationTokenMintTransportResponse = Readonly<{
  status: number;
  url: string;
  bodyText: string;
  contentType?: string;
}>;

export type SelfDrivingGitHubInstallationTokenMintTransport = (
  request: SelfDrivingGitHubInstallationTokenMintTransportRequest,
) => Promise<SelfDrivingGitHubInstallationTokenMintTransportResponse>;

export type SelfDrivingGitHubInstallationTokenMintDependencies = Readonly<{
  appIssuer: string;
  jwtSigner: SelfDrivingGitHubAppJwtSigner;
  transport: SelfDrivingGitHubInstallationTokenMintTransport;
  now: () => string;
}>;

type JsonRecord = Record<string, unknown>;

type CachedCredential = Readonly<{
  activationId: string;
  planId: string;
  repository: string;
  installationRef: string;
  installationId: number;
  token: string;
  credential: SelfDrivingGitHubInstallationCredential;
}>;

const textEncoder = new TextEncoder();
const allowedPermissions = new Set(["metadata:read", "contents:read", "contents:write", "pull-requests:write"]);

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} must be single-line text.`);
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

function normalizeIssuer(value: string): string {
  const issuer = normalizeText(value, "appIssuer", defaultSelfDrivingGitHubInstallationTokenMintLimits.maxIssuerLength);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(issuer)) throw new Error("appIssuer contains unsupported characters.");
  return issuer;
}

function parseRepository(value: string): { repository: string; owner: string; repo: string } {
  const repository = normalizeText(value, "repository", 201);
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error("repository must use exact owner/name syntax.");
  }
  const [owner, repo] = repository.split("/");
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("repository contains an unsafe owner or name.");
  }
  return { repository, owner, repo };
}

function asRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as JsonRecord;
}

function asArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

function asString(value: unknown, name: string, maxLength = 4096): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (!value || value.length > maxLength || /[\r\n\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be bounded single-line text.`);
  }
  return value;
}

function asInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value as number;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 support is required for GitHub installation-token minting.");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateCredentialRequest(request: SelfDrivingGitHubInstallationCredentialRequest): {
  repository: string;
  repo: string;
  installationId: number;
} {
  if (!request || request.schema !== "solvelang.self-driving.github-installation-credential-request.v0") {
    throw new Error("A canonical GitHub installation credential request is required.");
  }
  const parsed = parseRepository(request.repository);
  if (!Array.isArray(request.repositories) || request.repositories.length !== 1 || request.repositories[0] !== parsed.repository) {
    throw new Error("Installation-token mint request must target exactly the canonical repository.");
  }
  if (!Number.isSafeInteger(request.installationId) || request.installationId <= 0) {
    throw new Error("Installation-token mint request has an invalid installation ID.");
  }
  if (request.installationRef !== `github-app/installation:${request.installationId}`) {
    throw new Error("Installation-token mint request installation ref/ID binding drifted.");
  }
  if (
    !request.permissions
    || Object.keys(request.permissions).sort().join(",") !== "contents,metadata,pullRequests"
    || request.permissions.metadata !== "read"
    || request.permissions.contents !== "write"
    || request.permissions.pullRequests !== "write"
  ) {
    throw new Error("Installation-token mint request permissions are not the exact approved set.");
  }
  if (!allowedPermissions.has(request.permission)) throw new Error("Installation-token mint request asked for an unsupported runtime permission.");
  normalizeUtc(request.requestedAt, "request.requestedAt");
  normalizeText(request.activationId, "activationId", 128);
  if (!/^pr_write_plan_[0-9a-f]{64}$/.test(request.planId)) throw new Error("Installation-token mint request plan ID is malformed.");
  return { repository: parsed.repository, repo: parsed.repo, installationId: request.installationId };
}

export function planSelfDrivingGitHubInstallationTokenMint(
  request: SelfDrivingGitHubInstallationCredentialRequest,
): SelfDrivingGitHubInstallationTokenMintRequestPlan {
  const parsed = validateCredentialRequest(request);
  const path = `/app/installations/${parsed.installationId}/access_tokens`;
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA,
    operation: "create-installation-access-token" as const,
    method: "POST" as const,
    origin: SELF_DRIVING_GITHUB_TOKEN_API_ORIGIN,
    path,
    url: `${SELF_DRIVING_GITHUB_TOKEN_API_ORIGIN}${path}`,
    headers: Object.freeze({
      Accept: SELF_DRIVING_GITHUB_TOKEN_ACCEPT,
      "X-GitHub-Api-Version": SELF_DRIVING_GITHUB_TOKEN_API_VERSION,
    }),
    body: Object.freeze({
      repositories: Object.freeze([parsed.repo]) as readonly [string],
      permissions: Object.freeze({ contents: "write" as const, pull_requests: "write" as const }),
    }),
    expectedStatus: 201 as const,
    maxResponseBytes: defaultSelfDrivingGitHubInstallationTokenMintLimits.maxResponseBytes,
    policy: Object.freeze({
      exactInstallationRequired: true as const,
      exactSingleRepositoryRequired: true as const,
      exactPermissionsRequired: true as const,
      authorizationHeaderIncluded: false as const,
      jwtMaterialIncluded: false as const,
      privateKeyMaterialIncluded: false as const,
      redirectsAllowed: false as const,
      retries: 0 as const,
    }),
  });
}

function makeJwtSignRequest(issuer: string, now: string): SelfDrivingGitHubAppJwtSignRequest {
  const nowSeconds = Math.floor(Date.parse(now) / 1000);
  return Object.freeze({
    schema: SELF_DRIVING_GITHUB_APP_JWT_SIGN_REQUEST_SCHEMA,
    algorithm: "RS256" as const,
    issuer,
    issuedAtEpochSeconds: nowSeconds - defaultSelfDrivingGitHubInstallationTokenMintLimits.jwtPastSkewSeconds,
    expiresAtEpochSeconds: nowSeconds + defaultSelfDrivingGitHubInstallationTokenMintLimits.jwtLifetimeSeconds,
  });
}

function decodeBase64UrlJson(value: string, name: string): JsonRecord {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${name} is not base64url.`);
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error(`${name} could not be base64url-decoded.`);
  }
  try {
    return asRecord(JSON.parse(decoded), name);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function validateJwt(jwt: string, request: SelfDrivingGitHubAppJwtSignRequest, now: string): string {
  const value = asString(jwt, "GitHub App JWT", defaultSelfDrivingGitHubInstallationTokenMintLimits.maxJwtLength);
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error("GitHub App JWT must have three base64url segments.");
  const header = decodeBase64UrlJson(parts[0], "JWT header");
  const payload = decodeBase64UrlJson(parts[1], "JWT payload");
  if (Object.keys(header).sort().join(",") !== "alg,typ" || header.alg !== "RS256" || header.typ !== "JWT") {
    throw new Error("GitHub App JWT header must be exactly typ=JWT and alg=RS256.");
  }
  if (Object.keys(payload).sort().join(",") !== "exp,iat,iss") throw new Error("GitHub App JWT payload contains unsupported claims.");
  if (payload.iss !== request.issuer) throw new Error("GitHub App JWT issuer drifted from the signing request.");
  const issuedAt = asInteger(payload.iat, "JWT iat");
  const expiresAt = asInteger(payload.exp, "JWT exp");
  if (
    issuedAt !== request.issuedAtEpochSeconds
    || expiresAt <= issuedAt
    || expiresAt > request.expiresAtEpochSeconds
  ) {
    throw new Error("GitHub App JWT time claims drifted from the signing request.");
  }
  const nowSeconds = Math.floor(Date.parse(now) / 1000);
  if (expiresAt <= nowSeconds || expiresAt - nowSeconds > defaultSelfDrivingGitHubInstallationTokenMintLimits.jwtMaximumFutureSeconds) {
    throw new Error("GitHub App JWT expiration is outside GitHub's bounded future window.");
  }
  return value;
}

function validJsonContentType(value: string | undefined): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  return /^application\/(?:[A-Za-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(value.trim());
}

function validateMintPlan(plan: SelfDrivingGitHubInstallationTokenMintRequestPlan): void {
  if (!plan || plan.schema !== SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA || plan.operation !== "create-installation-access-token") {
    throw new Error("Installation-token mint plan schema/operation is invalid.");
  }
  if (plan.method !== "POST" || plan.origin !== SELF_DRIVING_GITHUB_TOKEN_API_ORIGIN || plan.url !== `${plan.origin}${plan.path}`) {
    throw new Error("Installation-token mint plan method/origin/URL drifted.");
  }
  if (!/^\/app\/installations\/[1-9]\d{0,15}\/access_tokens$/.test(plan.path)) throw new Error("Installation-token mint plan path is not allowlisted.");
  if (plan.headers.Accept !== SELF_DRIVING_GITHUB_TOKEN_ACCEPT || plan.headers["X-GitHub-Api-Version"] !== SELF_DRIVING_GITHUB_TOKEN_API_VERSION) {
    throw new Error("Installation-token mint plan headers drifted.");
  }
  if (plan.expectedStatus !== 201 || plan.maxResponseBytes !== defaultSelfDrivingGitHubInstallationTokenMintLimits.maxResponseBytes) {
    throw new Error("Installation-token mint plan response contract drifted.");
  }
  if (
    !plan.body
    || !Array.isArray(plan.body.repositories)
    || plan.body.repositories.length !== 1
    || !plan.body.repositories[0]
    || Object.keys(plan.body.permissions).sort().join(",") !== "contents,pull_requests"
    || plan.body.permissions.contents !== "write"
    || plan.body.permissions.pull_requests !== "write"
  ) {
    throw new Error("Installation-token mint plan body is not exact least privilege.");
  }
  if (
    plan.policy.exactInstallationRequired !== true
    || plan.policy.exactSingleRepositoryRequired !== true
    || plan.policy.exactPermissionsRequired !== true
    || plan.policy.authorizationHeaderIncluded !== false
    || plan.policy.jwtMaterialIncluded !== false
    || plan.policy.privateKeyMaterialIncluded !== false
    || plan.policy.redirectsAllowed !== false
    || plan.policy.retries !== 0
  ) {
    throw new Error("Installation-token mint plan policy was weakened.");
  }
}

function normalizeTokenResponse(
  request: SelfDrivingGitHubInstallationCredentialRequest,
  body: unknown,
): Promise<SelfDrivingGitHubInstallationCredential> {
  return (async () => {
    const root = asRecord(body, "installation token response");
    const token = asString(root.token, "installation token", defaultSelfDrivingGitHubInstallationTokenMintLimits.maxTokenLength);
    const expiresAt = normalizeUtc(asString(root.expires_at, "installation token expires_at", 64), "installation token expires_at");
    if (root.repository_selection !== "selected") throw new Error("Installation token response must use selected repository scope.");

    const permissions = asRecord(root.permissions, "installation token permissions");
    const permissionKeys = Object.keys(permissions).sort();
    const allowedPermissionShape = permissionKeys.join(",") === "contents,pull_requests"
      || permissionKeys.join(",") === "contents,metadata,pull_requests";
    if (!allowedPermissionShape
      || permissions.contents !== "write"
      || permissions.pull_requests !== "write"
      || (permissions.metadata !== undefined && permissions.metadata !== "read")) {
      throw new Error("Installation token response permissions are broader or different from the requested set.");
    }

    const repositories = asArray(root.repositories, "installation token repositories");
    if (repositories.length !== 1) throw new Error("Installation token response must contain exactly one repository.");
    const repository = asRecord(repositories[0], "installation token repository");
    if (repository.full_name !== request.repository) throw new Error("Installation token response repository drifted from the exact request.");

    const tokenBinding = await sha256Hex(token);
    return Object.freeze({
      token,
      credentialId: `github-installation-token-${tokenBinding.slice(0, 32)}`,
      installationRef: request.installationRef,
      repositories: Object.freeze([request.repository]),
      permissions: Object.freeze({ metadata: "read" as const, contents: "write" as const, pullRequests: "write" as const }),
      issuedAt: normalizeUtc(request.requestedAt, "request.requestedAt"),
      expiresAt,
    });
  })();
}

function sameMintIdentity(
  left: SelfDrivingGitHubInstallationCredentialRequest,
  right: SelfDrivingGitHubInstallationCredentialRequest,
): boolean {
  return left.activationId === right.activationId
    && left.planId === right.planId
    && left.repository === right.repository
    && left.installationRef === right.installationRef
    && left.installationId === right.installationId
    && JSON.stringify(left.repositories) === JSON.stringify(right.repositories)
    && JSON.stringify(left.permissions) === JSON.stringify(right.permissions);
}

export function createSelfDrivingGitHubInstallationTokenCredentialProvider(
  dependencies: SelfDrivingGitHubInstallationTokenMintDependencies,
): SelfDrivingGitHubInstallationCredentialProvider {
  if (!dependencies || typeof dependencies !== "object") throw new Error("Installation-token mint dependencies are required.");
  const issuer = normalizeIssuer(dependencies.appIssuer);
  if (typeof dependencies.jwtSigner !== "function") throw new Error("An injected GitHub App JWT signer is required.");
  if (typeof dependencies.transport !== "function") throw new Error("An injected installation-token transport is required.");
  if (typeof dependencies.now !== "function") throw new Error("An injected UTC clock is required.");

  let terminallyFailed = false;
  let boundRequest: SelfDrivingGitHubInstallationCredentialRequest | undefined;
  let cached: CachedCredential | undefined;
  let mintInFlight: Promise<SelfDrivingGitHubInstallationCredential> | undefined;

  const mintCredential = async (
    request: SelfDrivingGitHubInstallationCredentialRequest,
    now: string,
  ): Promise<SelfDrivingGitHubInstallationCredential> => {
    const plan = planSelfDrivingGitHubInstallationTokenMint(request);
    validateMintPlan(plan);
    const jwtRequest = makeJwtSignRequest(issuer, now);
    let jwtCallbackActive = true;
    let jwtCallbackEntered = false;
    let jwtCallbackCompleted = false;
    let jwtSignerReentered = false;
    let callbackCredential: SelfDrivingGitHubInstallationCredential | undefined;
    let signerCredential: SelfDrivingGitHubInstallationCredential;
    try {
      signerCredential = await dependencies.jwtSigner<SelfDrivingGitHubInstallationCredential>(jwtRequest, async (rawJwt) => {
        if (!jwtCallbackActive) throw new Error("GitHub App JWT signer callback is no longer active.");
        if (jwtCallbackEntered) {
          jwtSignerReentered = true;
          throw new Error("GitHub App JWT signer re-entered the callback.");
        }
        jwtCallbackEntered = true;
        const jwt = validateJwt(rawJwt, jwtRequest, now);
        const transportRequest: SelfDrivingGitHubInstallationTokenMintTransportRequest = Object.freeze({
          method: "POST" as const,
          url: plan.url,
          headers: Object.freeze({
            Accept: SELF_DRIVING_GITHUB_TOKEN_ACCEPT,
            "X-GitHub-Api-Version": SELF_DRIVING_GITHUB_TOKEN_API_VERSION,
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json" as const,
          }),
          bodyText: JSON.stringify(plan.body),
          redirect: "error" as const,
        });

        let transportResponse: SelfDrivingGitHubInstallationTokenMintTransportResponse;
        try {
          transportResponse = await dependencies.transport(transportRequest);
        } catch {
          throw new Error("Installation-token transport failed.");
        }
        if (!transportResponse || transportResponse.url !== plan.url) throw new Error("Installation-token response URL drifted.");
        if (transportResponse.status !== 201) throw new Error("Installation-token response status was unexpected.");
        if (typeof transportResponse.bodyText !== "string" || byteLength(transportResponse.bodyText) > plan.maxResponseBytes) {
          throw new Error("Installation-token response exceeded the bounded size.");
        }
        if (!validJsonContentType(transportResponse.contentType)) throw new Error("Installation-token response content type is invalid.");
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(transportResponse.bodyText);
        } catch {
          throw new Error("Installation-token response JSON is invalid.");
        }
        const credential = await normalizeTokenResponse(request, responseBody);
        callbackCredential = credential;
        jwtCallbackCompleted = true;
        return credential;
      });
    } catch {
      throw new Error("GitHub App JWT signer or installation-token mint failed.");
    } finally {
      jwtCallbackActive = false;
    }
    if (!jwtCallbackEntered || !jwtCallbackCompleted || jwtSignerReentered || !Object.is(signerCredential, callbackCredential)) {
      throw new Error("GitHub App JWT signer violated the exact single-callback result contract.");
    }
    return signerCredential;
  };

  return async function credentialProvider<T>(
    request: SelfDrivingGitHubInstallationCredentialRequest,
    withCredential: (credential: SelfDrivingGitHubInstallationCredential) => Promise<T>,
  ): Promise<T> {
    if (terminallyFailed) throw new Error("Installation-token provider is terminally failed.");
    try {
      validateCredentialRequest(request);
      const now = normalizeUtc(dependencies.now(), "mint.now");
      if (!boundRequest) boundRequest = request;
      else if (!sameMintIdentity(boundRequest, request)) throw new Error("Installation-token provider request identity changed during one execution.");

      let credential: SelfDrivingGitHubInstallationCredential;
      if (cached) {
        credential = cached.credential;
      } else {
        if (!mintInFlight) mintInFlight = mintCredential(request, now);
        credential = await mintInFlight;
        if (terminallyFailed) throw new Error("Installation-token provider became terminally failed during token minting.");
        if (!cached) {
          cached = Object.freeze({
            activationId: request.activationId,
            planId: request.planId,
            repository: request.repository,
            installationRef: request.installationRef,
            installationId: request.installationId,
            token: credential.token,
            credential,
          });
        }
        mintInFlight = undefined;
      }

      if (Date.parse(credential.expiresAt) <= Date.parse(now) + defaultSelfDrivingGitHubInstallationTokenMintLimits.cachedTokenMinRemainingMs) {
        throw new Error("Cached installation token is too close to expiration; reminting inside one execution is forbidden.");
      }
      if (terminallyFailed) throw new Error("Installation-token provider is terminally failed.");
      return await withCredential(credential);
    } catch (error) {
      terminallyFailed = true;
      cached = undefined;
      mintInFlight = undefined;
      throw error;
    }
  };
}
