import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelfDrivingGitHubInstallationTokenCredentialProvider,
  planSelfDrivingGitHubInstallationTokenMint,
  SELF_DRIVING_GITHUB_APP_JWT_SIGN_REQUEST_SCHEMA,
  SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA,
  type SelfDrivingGitHubAppJwtSignRequest,
  type SelfDrivingGitHubAppJwtSigner,
  type SelfDrivingGitHubInstallationTokenMintTransport,
  type SelfDrivingGitHubInstallationTokenMintTransportRequest,
} from "./selfDrivingGithubInstallationTokenMint";
import type {
  SelfDrivingGitHubInstallationCredential,
  SelfDrivingGitHubInstallationCredentialRequest,
} from "./selfDrivingGithubInstallationRuntimeGate";

const ISSUER = "Iv1SolveLangFixture123";
const TOKEN = "ghs_12345_fixture_stateless_installation_token_payload";
const REQUESTED_AT = "2026-09-08T09:00:00Z";
const TOKEN_EXPIRES_AT = "2026-09-08T10:00:00Z";

function credentialRequest(overrides: Partial<SelfDrivingGitHubInstallationCredentialRequest> = {}): SelfDrivingGitHubInstallationCredentialRequest {
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
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

function base64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function jwtFor(request: SelfDrivingGitHubAppJwtSignRequest, overrides: {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signature?: string;
} = {}): string {
  const header = overrides.header ?? { typ: "JWT", alg: "RS256" };
  const payload = overrides.payload ?? {
    iat: request.issuedAtEpochSeconds,
    exp: request.expiresAtEpochSeconds,
    iss: request.issuer,
  };
  return `${base64UrlJson(header)}.${base64UrlJson(payload)}.${overrides.signature ?? "fixture_signature"}`;
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    expires_at: TOKEN_EXPIRES_AT,
    permissions: { contents: "write", pull_requests: "write" },
    repository_selection: "selected",
    repositories: [{ full_name: "saiidz/solvelang" }],
    ...overrides,
  };
}

function jsonTransportResponse(request: SelfDrivingGitHubInstallationTokenMintTransportRequest, body: unknown) {
  return {
    status: 201,
    url: request.url,
    bodyText: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
  };
}

function signer(counter: { calls: number }, customize?: (request: SelfDrivingGitHubAppJwtSignRequest) => string): SelfDrivingGitHubAppJwtSigner {
  return async (request, withJwt) => {
    counter.calls += 1;
    return withJwt(customize ? customize(request) : jwtFor(request));
  };
}

test("mint planner pins exact installation endpoint, one repository name, permissions, and no JWT material", () => {
  const plan = planSelfDrivingGitHubInstallationTokenMint(credentialRequest());
  assert.equal(plan.schema, SELF_DRIVING_GITHUB_INSTALLATION_TOKEN_MINT_SCHEMA);
  assert.equal(plan.method, "POST");
  assert.equal(plan.url, "https://api.github.com/app/installations/12345/access_tokens");
  assert.deepEqual(plan.body, {
    repositories: ["solvelang"],
    permissions: { contents: "write", pull_requests: "write" },
  });
  assert.equal(plan.headers.Accept, "application/vnd.github+json");
  assert.equal(plan.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(plan.policy.authorizationHeaderIncluded, false);
  assert.equal(plan.policy.jwtMaterialIncluded, false);
  assert.equal(plan.policy.privateKeyMaterialIncluded, false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.headers, "Authorization"), false);
});

test("mint planner rejects broad repository scope, permission drift, installation drift, or unsafe repo identity", () => {
  assert.throws(
    () => planSelfDrivingGitHubInstallationTokenMint(credentialRequest({ repositories: ["saiidz/solvelang", "saiidz/other"] as unknown as readonly [string] })),
    /exactly the canonical repository/,
  );
  assert.throws(
    () => planSelfDrivingGitHubInstallationTokenMint(credentialRequest({
      permissions: { metadata: "read", contents: "read" as "write", pullRequests: "write" },
    })),
    /exact approved set/,
  );
  assert.throws(
    () => planSelfDrivingGitHubInstallationTokenMint(credentialRequest({ installationRef: "github-app/installation:999" })),
    /ref\/ID binding drifted/,
  );
  assert.throws(
    () => planSelfDrivingGitHubInstallationTokenMint(credentialRequest({ repository: "../unsafe" })),
    /owner\/name syntax|unsafe/,
  );
});

test("credential provider signs exact bounded RS256 claims, mints once, validates response, and yields normalized credential", async () => {
  const signerCounter = { calls: 0 };
  const transportCalls: SelfDrivingGitHubInstallationTokenMintTransportRequest[] = [];
  const jwtSigner = signer(signerCounter, (request) => {
    assert.equal(request.schema, SELF_DRIVING_GITHUB_APP_JWT_SIGN_REQUEST_SCHEMA);
    assert.equal(request.algorithm, "RS256");
    assert.equal(request.issuer, ISSUER);
    assert.equal(request.issuedAtEpochSeconds, Math.floor(Date.parse(REQUESTED_AT) / 1000) - 60);
    assert.equal(request.expiresAtEpochSeconds, Math.floor(Date.parse(REQUESTED_AT) / 1000) + 540);
    return jwtFor(request);
  });
  const transport: SelfDrivingGitHubInstallationTokenMintTransport = async (request) => {
    transportCalls.push(request);
    assert.equal(request.redirect, "error");
    assert.equal(request.method, "POST");
    assert.match(request.headers.Authorization, /^Bearer [A-Za-z0-9_.-]+$/);
    assert.deepEqual(JSON.parse(request.bodyText), {
      repositories: ["solvelang"],
      permissions: { contents: "write", pull_requests: "write" },
    });
    return jsonTransportResponse(request, tokenResponse());
  };
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner,
    transport,
    now: () => REQUESTED_AT,
  });
  let observed: SelfDrivingGitHubInstallationCredential | undefined;
  const result = await provider(credentialRequest(), async (value) => {
    observed = value;
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(signerCounter.calls, 1);
  assert.equal(transportCalls.length, 1);
  assert.equal(observed?.token, TOKEN);
  assert.equal(observed?.installationRef, "github-app/installation:12345");
  assert.deepEqual(observed?.repositories, ["saiidz/solvelang"]);
  assert.deepEqual(observed?.permissions, { metadata: "read", contents: "write", pullRequests: "write" });
  assert.equal(observed?.issuedAt, new Date(Date.parse(REQUESTED_AT)).toISOString());
  assert.equal(observed?.expiresAt, new Date(Date.parse(TOKEN_EXPIRES_AT)).toISOString());
  assert.match(observed?.credentialId ?? "", /^github-installation-token-[0-9a-f]{32}$/);
});

test("provider reuses the same cached token session for later permissions without reminting", async () => {
  const signerCounter = { calls: 0 };
  let transportCalls = 0;
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: signer(signerCounter),
    transport: async (request) => {
      transportCalls += 1;
      return jsonTransportResponse(request, tokenResponse());
    },
    now: () => REQUESTED_AT,
  });
  const tokens: string[] = [];
  await provider(credentialRequest(), async (value) => { tokens.push(value.token); return "first"; });
  await provider(credentialRequest({ permission: "metadata:read" }), async (value) => { tokens.push(value.token); return "second"; });
  await provider(credentialRequest({ permission: "contents:write" }), async (value) => { tokens.push(value.token); return "third"; });
  assert.equal(signerCounter.calls, 1);
  assert.equal(transportCalls, 1);
  assert.deepEqual(tokens, [TOKEN, TOKEN, TOKEN]);
});

test("provider accepts current stateless-style token lengths and does not assume legacy 40-character tokens", async () => {
  const longToken = `ghs_12345_${"x".repeat(600)}`;
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: signer({ calls: 0 }),
    transport: async (request) => jsonTransportResponse(request, tokenResponse({ token: longToken })),
    now: () => REQUESTED_AT,
  });
  await provider(credentialRequest(), async (value) => {
    assert.equal(value.token, longToken);
    return true;
  });
});

test("JWT header/issuer/time drift is rejected before token transport", async () => {
  const badJwtFactories = [
    (request: SelfDrivingGitHubAppJwtSignRequest) => jwtFor(request, { header: { typ: "JWT", alg: "HS256" } }),
    (request: SelfDrivingGitHubAppJwtSignRequest) => jwtFor(request, { payload: { iat: request.issuedAtEpochSeconds, exp: request.expiresAtEpochSeconds, iss: "wrong" } }),
    (request: SelfDrivingGitHubAppJwtSignRequest) => jwtFor(request, { payload: { iat: request.issuedAtEpochSeconds, exp: request.expiresAtEpochSeconds + 1, iss: request.issuer } }),
    (request: SelfDrivingGitHubAppJwtSignRequest) => jwtFor(request, { payload: { iat: request.issuedAtEpochSeconds, exp: request.expiresAtEpochSeconds, iss: request.issuer, extra: true } }),
  ];
  for (const factory of badJwtFactories) {
    let transports = 0;
    const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
      appIssuer: ISSUER,
      jwtSigner: signer({ calls: 0 }, factory),
      transport: async () => {
        transports += 1;
        throw new Error("must not run");
      },
      now: () => REQUESTED_AT,
    });
    await assert.rejects(
      () => provider(credentialRequest(), async () => true),
      /JWT signer or installation-token mint failed/,
    );
    assert.equal(transports, 0);
  }
});

test("broader token response permissions, wrong repository, or non-selected scope are rejected before credential callback", async () => {
  const responseCases = [
    tokenResponse({ permissions: { contents: "write", pull_requests: "write", issues: "read" } }),
    tokenResponse({ repositories: [{ full_name: "saiidz/other" }] }),
    tokenResponse({ repositories: [{ full_name: "saiidz/solvelang" }, { full_name: "saiidz/other" }] }),
    tokenResponse({ repository_selection: "all" }),
  ];
  for (const body of responseCases) {
    let callbacks = 0;
    const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
      appIssuer: ISSUER,
      jwtSigner: signer({ calls: 0 }),
      transport: async (request) => jsonTransportResponse(request, body),
      now: () => REQUESTED_AT,
    });
    await assert.rejects(
      () => provider(credentialRequest(), async () => { callbacks += 1; return true; }),
      /JWT signer or installation-token mint failed/,
    );
    assert.equal(callbacks, 0);
  }
});

test("JWT signer re-entry, swallowed callback result, or replaced result fails without a second mint transport", async () => {
  const signers: SelfDrivingGitHubAppJwtSigner[] = [
    async (request, withJwt) => {
      const first = await withJwt(jwtFor(request));
      try { await withJwt(jwtFor(request)); } catch { /* expected */ }
      return first;
    },
    async (request, withJwt) => {
      await withJwt(jwtFor(request));
      return { replaced: true } as never;
    },
  ];
  for (const jwtSigner of signers) {
    let transports = 0;
    const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
      appIssuer: ISSUER,
      jwtSigner,
      transport: async (request) => {
        transports += 1;
        return jsonTransportResponse(request, tokenResponse());
      },
      now: () => REQUESTED_AT,
    });
    await assert.rejects(
      () => provider(credentialRequest(), async () => ({ callback: true })),
      /single-callback result contract|JWT signer or installation-token mint failed/,
    );
    assert.equal(transports, 1);
  }
});

test("raw JWT signer and mint transport failures are sanitized", async () => {
  for (const mode of ["signer", "transport"] as const) {
    const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
      appIssuer: ISSUER,
      jwtSigner: mode === "signer"
        ? async () => { throw new Error("PRIVATE KEY secret must not escape"); }
        : signer({ calls: 0 }),
      transport: async () => {
        if (mode === "transport") throw new Error(`JWT ${TOKEN} secret must not escape`);
        throw new Error("must not run");
      },
      now: () => REQUESTED_AT,
    });
    let message = "";
    try {
      await provider(credentialRequest(), async () => true);
      assert.fail("expected mint failure");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(message, "GitHub App JWT signer or installation-token mint failed.");
    assert.doesNotMatch(message, /PRIVATE KEY|ghs_|secret must not escape/);
  }
});

test("provider binds one activation/repository/installation identity and rejects mid-session drift without reminting", async () => {
  const signerCounter = { calls: 0 };
  let transports = 0;
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: signer(signerCounter),
    transport: async (request) => {
      transports += 1;
      return jsonTransportResponse(request, tokenResponse());
    },
    now: () => REQUESTED_AT,
  });
  await provider(credentialRequest(), async () => true);
  await assert.rejects(
    () => provider(credentialRequest({ activationId: `github_installation_activation_${"c".repeat(64)}` }), async () => true),
    /request identity changed/,
  );
  assert.equal(signerCounter.calls, 1);
  assert.equal(transports, 1);
});

test("cached token near expiration fails rather than silently reminting a second credential session", async () => {
  const signerCounter = { calls: 0 };
  let transports = 0;
  let clockCalls = 0;
  const provider = createSelfDrivingGitHubInstallationTokenCredentialProvider({
    appIssuer: ISSUER,
    jwtSigner: signer(signerCounter),
    transport: async (request) => {
      transports += 1;
      return jsonTransportResponse(request, tokenResponse({ expires_at: "2026-09-08T09:01:01Z" }));
    },
    now: () => clockCalls++ === 0 ? REQUESTED_AT : "2026-09-08T09:00:30Z",
  });
  await provider(credentialRequest(), async () => true);
  await assert.rejects(
    () => provider(credentialRequest({ permission: "metadata:read", requestedAt: "2026-09-08T09:00:30Z" }), async () => true),
    /too close to expiration/,
  );
  assert.equal(signerCounter.calls, 1);
  assert.equal(transports, 1);
});