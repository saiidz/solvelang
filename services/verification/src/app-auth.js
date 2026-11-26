// GitHub App authentication for the verification service.
//
// Mirrors the App-JWT pattern proven in the merge-governance service
// (services/merge-governance/src/github-app-auth.js) and in api-access:
// RS256 app JWTs via node:crypto, base64/escaped PEM acceptance, an
// injectable fetch, per-installation token caching, and sanitized
// typed errors — GitHub error bodies are never propagated and the
// private key is never logged or returned.
//
// Also owns the App Manifest conversion: the one-time exchange of the
// manifest flow's temporary code for the created app's credentials
// (id, slug, PEM, webhook secret). That exchange is the ONLY way the
// app's credentials come into existence; they are written by the
// caller to the service's sealed credentials file, never printed.

import { createSign } from "node:crypto";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "solvelang-verification";
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export class GitHubAppAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GitHubAppAuthError";
    this.status = status;
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function normalizePrivateKey(privateKey) {
  if (typeof privateKey !== "string" || !privateKey)
    throw new Error("GitHub App private key is required.");
  let candidate = privateKey;
  if (!candidate.includes("BEGIN") && /^[A-Za-z0-9+/=\s]+$/.test(candidate)) {
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    if (decoded.includes("BEGIN")) candidate = decoded;
  }
  return candidate.includes("\\n") && !candidate.includes("\n")
    ? candidate.replace(/\\n/g, "\n")
    : candidate;
}

export function createAppJwt({ appId, privateKey, now = Date.now } = {}) {
  if (appId === undefined || appId === null || String(appId).trim() === "")
    throw new Error("GitHub App id is required.");
  const timestamp = typeof now === "function" ? now() : now;
  const seconds = Math.floor(timestamp / 1_000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: String(appId),
    iat: seconds - 60,
    exp: seconds + 540,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer
    .sign(normalizePrivateKey(privateKey))
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

// createAppAuth({ appId, privateKeyPem, fetchImpl?, now? }) ->
//   { getInstallationToken(installationId) -> Promise<string> }
export function createAppAuth({
  appId,
  privateKeyPem,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  if (appId === undefined || appId === null || String(appId).trim() === "")
    throw new Error("GitHub App id is required.");
  if (typeof privateKeyPem !== "string" || !privateKeyPem)
    throw new Error("GitHub App private key is required.");
  const cache = new Map();
  const nowMs = () => (typeof now === "function" ? now() : now);

  async function getInstallationToken(installationId) {
    const id = Number(installationId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new GitHubAppAuthError(0, "github_app_installation_invalid");
    }
    const cached = cache.get(id);
    if (cached && nowMs() < cached.refreshAfterMs) {
      return cached.token;
    }
    let response;
    try {
      const appJwt = createAppJwt({ appId, privateKey: privateKeyPem, now });
      response = await fetchImpl(
        `${GITHUB_API_BASE}/app/installations/${id}/access_tokens`,
        {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: "Bearer " + appJwt,
            "x-github-api-version": GITHUB_API_VERSION,
            "user-agent": USER_AGENT,
          },
        }
      );
    } catch {
      throw new GitHubAppAuthError(0, "github_app_token_request_failed");
    }
    if (!response.ok) {
      throw new GitHubAppAuthError(
        response.status || 0,
        "github_app_token_request_failed"
      );
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload.token !== "string" || !payload.token) {
      throw new GitHubAppAuthError(0, "github_app_token_request_failed");
    }
    const expiresMs = Date.parse(payload.expires_at);
    const refreshAfterMs = Number.isFinite(expiresMs)
      ? expiresMs - EXPIRY_SAFETY_MARGIN_MS
      : nowMs();
    cache.set(id, { token: payload.token, refreshAfterMs });
    return payload.token;
  }

  return { getInstallationToken };
}

// Exchange the App Manifest flow's temporary code for the created
// app's credentials. Unauthenticated by design (the code is the
// credential, valid minutes); the response — which contains the
// app's PEM and webhook secret — is returned to the caller for
// sealed storage and is never logged here.
export async function exchangeManifestCode(code, fetchImpl = fetch) {
  if (typeof code !== "string" || !code) {
    throw new GitHubAppAuthError(0, "manifest_code_required");
  }
  let response;
  try {
    response = await fetchImpl(
      `${GITHUB_API_BASE}/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": USER_AGENT,
        },
      }
    );
  } catch {
    throw new GitHubAppAuthError(0, "manifest_conversion_failed");
  }
  if (!response.ok) {
    throw new GitHubAppAuthError(
      response.status || 0,
      "manifest_conversion_failed"
    );
  }
  const payload = await response.json().catch(() => null);
  if (
    !payload ||
    !Number.isSafeInteger(payload.id) ||
    typeof payload.pem !== "string" ||
    typeof payload.webhook_secret !== "string" ||
    typeof payload.slug !== "string"
  ) {
    throw new GitHubAppAuthError(0, "manifest_conversion_failed");
  }
  return {
    id: payload.id,
    slug: payload.slug,
    name: typeof payload.name === "string" ? payload.name : "",
    pem: payload.pem,
    webhookSecret: payload.webhook_secret,
    clientId: typeof payload.client_id === "string" ? payload.client_id : "",
    clientSecret:
      typeof payload.client_secret === "string" ? payload.client_secret : "",
    htmlUrl: typeof payload.html_url === "string" ? payload.html_url : "",
  };
}
