import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelfDrivingGitHubInstallationTokenCredentialProvider,
  type SelfDrivingGitHubAppJwtSignRequest,
  type SelfDrivingGitHubAppJwtSigner,
  type SelfDrivingGitHubInstallationTokenMintTransport,
  type SelfDrivingGitHubInstallationTokenMintTransportRequest,
  type SelfDrivingGitHubInstallationTokenMintTransportResponse,
} from "./selfDrivingGithubInstallationTokenMint";
import type {
  SelfDrivingGitHubInstallationCredential,
  SelfDrivingGitHubInstallationCredentialRequest,
} from "./selfDrivingGithubInstallationRuntimeGate";

const ISSUER = "Iv1SolveLangHardeningFixture";
const TOKEN = "ghs_hardening_fixture_stateless_installation_token";
const NOW = "2026-09-08T09:30:00Z";
const EXPIRES = "2026-09-08T10:30:00Z";

function credentialRequest(
  overrides: Partial<SelfDrivingGitHubInstallationCredentialRequest> = {},
): SelfDrivingGitHubInstallationCredentialRequest {
  return {
    schema: "solvelang.self-driving.github-installation-credential-request.v0",
    activationId: `github_installation_activation_${"a".repeat(64)}`,
    planId: `pr_write_plan_${"b".repeat(64)}`,
    repository: "saiidz/solvelang",
    repositories: ["saiidz/solvelang"],
    installationRef: "github-app/installation:12345",
    installationId: 12345,
    permission: "contents:read",
    permissions: { metadata: "read", contents: "write", pullRequests: "write" },
    requestedAt: NOW,
    ...overrides,
  };
}

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwtFor(request: SelfDrivingGitHubAppJwtSignRequest): string {
  return `${base64UrlJson({ typ: "JWT", alg: "RS256" })}.${base64UrlJson({
    iat: request.issuedAtEpochSeconds,
    exp: request.expiresAtEpochSeconds,
    iss: request.issuer,
  })}.hardening_signature`;
}

function tokenBody() {
  return {
    token: TOKEN,
    expires_at: EXPIRES,
    permissions: { contents: "write", pull_requests: "write" },
    repository_selection: "selected",
    repositories: [{ full_name: "saiidz/solvelang" }],
  };
}

function jsonResponse(
  request: SelfDrivingGitHubInstallationTokenMintTransportRequest,
): SelfDrivingGitHubInstallationTokenMintTransportResponse {
  return {
    status: 201,
    url: request.url,
    bodyText: JSON.stringify(tokenBody()),
    contentType: "application/json; charset=utf-8",
  };
}

function normalSigner(counter?: { calls: number }): SelfDrivingGitHubAppJwtSigner {
  return async (request, withJwt) => {
    if (counter) counter.calls += 1;
    return withJwt(jwtFor(request));
  };
}

test("a captured JWT callback is revoked when the signer settles without using it", async () => {
  let capturedRequest: SelfDrivingGitHubAppJwtSignRequest | undefined;
  let capturedCallback:
    | ((jwt: string) => Promise<SelfDrivingGitHubInstallationCredential>)
    | undefined;
  let transports = 0;
  let credentialCallbacks = 0;
  const jwtSigner: SelfDrivingGitHubAppJwtSigner = async (request, withJwt) => {
    capturedRequest = request;
    capturedCallback = withJwt as (jwt: string) => Promise<SelfDrivingGitHubInstallationCredential>;
    return { forged: true } as never;
  };
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner,
    transport: async (request) => {
      transports += 1;
      return jsonResponse(request);
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => provider(credentialRequest(), async () => {
      credentialCallbacks += 1;
      return true;
    }),
    /single-callback result contract/,
  );
  assert.equal(transports, 0);
  assert.equal(credentialCallbacks, 0);
  assert.ok(capturedRequest);
  assert.ok(capturedCallback);

  await assert.rejects(
    () => capturedCallback!(jwtFor(capturedRequest!)),
    /no longer active/,
  );
  assert.equal(transports, 0);
  assert.equal(credentialCallbacks, 0);
});

test("concurrent first use shares one in-flight mint and produces only one installation token", async () => {
  const signerCounter = { calls: 0 };
  let transports = 0;
  let releaseTransport: (() => void) | undefined;
  let markTransportEntered: (() => void) | undefined;
  const transportEntered = new Promise<void>((resolve) => {
    markTransportEntered = resolve;
  });
  const transportBlocked = new Promise<void>((resolve) => {
    releaseTransport = resolve;
  });
  const transport: SelfDrivingGitHubInstallationTokenMintTransport = async (request) => {
    transports += 1;
    markTransportEntered?.();
    await transportBlocked;
    return jsonResponse(request);
  };
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: normalSigner(signerCounter),
    transport,
    now: () => NOW,
  });

  const first = provider(credentialRequest(), async (credential) => {
    assert.equal(credential.token, TOKEN);
    return "first";
  });
  await transportEntered;
  const second = provider(
    credentialRequest({ permission: "metadata:read" }),
    async (credential) => {
      assert.equal(credential.token, TOKEN);
      return "second";
    },
  );
  releaseTransport?.();

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.equal(signerCounter.calls, 1);
  assert.equal(transports, 1);
});

test("installation-token mint requires an explicit JSON response content type", async () => {
  let credentialCallbacks = 0;
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: normalSigner(),
    transport: async (request) => ({
      status: 201,
      url: request.url,
      bodyText: JSON.stringify(tokenBody()),
    }),
    now: () => NOW,
  });

  await assert.rejects(
    () => provider(credentialRequest(), async () => {
      credentialCallbacks += 1;
      return true;
    }),
    /JWT signer or installation-token mint failed/,
  );
  assert.equal(credentialCallbacks, 0);
});