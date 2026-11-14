// GitHub App authentication for the merge-governance pilot.
//
// Written fresh for this service, mirroring the App-JWT pattern proven in
// services/api-access/src/github-app.js (same codebase, same author):
// RS256 app JWTs via node:crypto, "\n"-escaped PEM acceptance, and an
// injectable fetch so every flow is unit-testable without GitHub.
//
// Scope is deliberately narrow: mint per-installation access tokens for
// the queue reader and cache them in module memory until shortly before
// they expire. Nothing here logs or returns the private key, and GitHub
// error bodies are never propagated — failures surface as the typed
// GitHubAppAuthError, which the handler maps to a sanitized 502.

import { createSign } from "node:crypto";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "solvelang-merge-governance-pilot";
// Refresh a cached installation token once it is within this margin of
// its GitHub expiry, so an in-flight read never rides an expired token.
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

// App private keys reach the Lambda through an environment variable, where
// real newlines are awkward to store; accept the escaped "\n" form too.
export function normalizePrivateKey(privateKey) {
  if (typeof privateKey !== "string" || !privateKey) throw new Error("GitHub App private key is required.");
  return privateKey.includes("\\n") && !privateKey.includes("\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
}

// GitHub app JWT: iss = app id, iat backdated 60s for clock skew, exp at
// most 10 minutes out (we use 9). Signed RS256 with the app private key.
export function createAppJwt({ appId, privateKey, now = Date.now } = {}) {
  if (appId === undefined || appId === null || String(appId).trim() === "") throw new Error("GitHub App id is required.");
  const timestamp = typeof now === "function" ? now() : now;
  const seconds = Math.floor(timestamp / 1_000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iss: String(appId), iat: seconds - 60, exp: seconds + 540 });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey)).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

// createAppAuth({ appId, privateKeyPem, fetchImpl?, now? }) ->
//   { getInstallationToken(installationId) -> Promise<string> }
//
// Tokens are cached per installation id in module memory and reused
// until EXPIRY_SAFETY_MARGIN_MS before their GitHub expires_at.
export function createAppAuth({ appId, privateKeyPem, fetchImpl = fetch, now = Date.now } = {}) {
  if (appId === undefined || appId === null || String(appId).trim() === "") throw new Error("GitHub App id is required.");
  if (typeof privateKeyPem !== "string" || !privateKeyPem) throw new Error("GitHub App private key is required.");
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
      response = await fetchImpl(`${GITHUB_API_BASE}/app/installations/${id}/access_tokens`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${appJwt}`,
          "x-github-api-version": GITHUB_API_VERSION,
          "user-agent": USER_AGENT,
        },
      });
    } catch {
      // Network failure or an unusable key: one sanitized typed error.
      throw new GitHubAppAuthError(0, "github_app_token_request_failed");
    }
    if (!response.ok) {
      // Never read or forward the GitHub error body.
      throw new GitHubAppAuthError(response.status || 0, "github_app_token_request_failed");
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
