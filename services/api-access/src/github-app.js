import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { ApiAccessError } from "./service.js";

// GitHub App primitives for the SolveLang GitHub App: app JWT signing,
// webhook signature verification, the OAuth web flow, and installation
// access tokens. Everything network-shaped takes an injectable fetchImpl
// so the flows are unit-testable without GitHub. Nothing here logs or
// returns secrets beyond the token a caller explicitly asked to mint.

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_API_VERSION = "2022-11-28";

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// App private keys reach the Lambda through an environment variable, where
// real newlines are awkward to store; accept the escaped "\n" form too.
function normalizePrivateKey(privateKey) {
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

// Webhook deliveries are signed with the app webhook secret as
// "sha256=<hex HMAC-SHA256 of the raw body>". Any malformed input — wrong
// type, missing prefix, non-hex or wrong-length digest — is simply false:
// verification never throws, so callers can fail closed on false.
export function verifyWebhookSignature({ secret, rawBody, signature } = {}) {
  try {
    if (typeof secret !== "string" || !secret) return false;
    if (typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
    const presentedHex = signature.slice("sha256=".length);
    if (!/^[a-f0-9]{64}$/.test(presentedHex)) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : null;
    if (!body) return false;
    const expected = createHmac("sha256", secret).update(body).digest();
    const presented = Buffer.from(presentedHex, "hex");
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  } catch {
    return false;
  }
}

export function buildAuthorizeUrl({ clientId, state, redirectUri } = {}) {
  if (typeof clientId !== "string" || !clientId) throw new Error("GitHub App client id is required.");
  if (typeof state !== "string" || !state) throw new Error("GitHub OAuth state is required.");
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  if (typeof redirectUri === "string" && redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

async function githubJson(fetchImpl, url, options, failureMessage) {
  const response = await fetchImpl(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") throw new Error(failureMessage);
  return payload;
}

export async function exchangeOAuthCode({ clientId, clientSecret, code, fetchImpl = fetch } = {}) {
  if (typeof clientId !== "string" || !clientId) throw new Error("GitHub App client id is required.");
  if (typeof clientSecret !== "string" || !clientSecret) throw new Error("GitHub App client secret is required.");
  if (typeof code !== "string" || !code) throw new Error("GitHub OAuth code is required.");
  const payload = await githubJson(fetchImpl, GITHUB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  }, "GitHub OAuth code exchange failed.");
  if (typeof payload.access_token !== "string" || !payload.access_token || payload.error) {
    throw new Error("GitHub OAuth code exchange failed.");
  }
  return { accessToken: payload.access_token, tokenType: payload.token_type, scope: payload.scope };
}

function githubApiHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "solvelang-api-access",
  };
}

// The signed-in GitHub user plus the email the account resolution binds
// to: ONLY a verified email is ever returned, preferring the primary one.
// public profile email is not proof of mailbox control, so it is never
// used as a fallback.
export async function fetchGitHubUser({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !token) throw new Error("GitHub user token is required.");
  const headers = githubApiHeaders(token);
  const user = await githubJson(fetchImpl, `${GITHUB_API_BASE}/user`, { headers }, "GitHub user lookup failed.");
  if (!Number.isSafeInteger(user.id) || typeof user.login !== "string" || !user.login) {
    throw new Error("GitHub user lookup failed.");
  }
  let primaryVerifiedEmail = null;
  try {
    const emails = await githubJson(fetchImpl, `${GITHUB_API_BASE}/user/emails`, { headers }, "GitHub email lookup failed.");
    if (Array.isArray(emails)) {
      const usable = emails.filter((entry) => entry && typeof entry.email === "string" && entry.email && entry.verified === true);
      const chosen = usable.find((entry) => entry.primary === true) ?? usable[0];
      primaryVerifiedEmail = chosen ? chosen.email.trim().toLowerCase() : null;
    }
  } catch {
    primaryVerifiedEmail = null;
  }
  return { id: user.id, login: user.login, primaryVerifiedEmail };
}

export async function createInstallationToken({ appJwt, installationId, fetchImpl = fetch } = {}) {
  if (typeof appJwt !== "string" || !appJwt) throw new Error("GitHub App JWT is required.");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("GitHub installation id is required.");
  const payload = await githubJson(fetchImpl, `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: githubApiHeaders(appJwt),
  }, "GitHub installation token request failed.");
  if (typeof payload.token !== "string" || !payload.token) throw new Error("GitHub installation token request failed.");
  return { token: payload.token, expiresAt: payload.expires_at };
}

function normalizeRepositories(repositories) {
  if (!Array.isArray(repositories)) return [];
  const seen = new Set();
  const normalized = [];
  for (const repository of repositories) {
    if (!repository || !Number.isSafeInteger(repository.id)) continue;
    if (seen.has(repository.id)) continue;
    seen.add(repository.id);
    normalized.push({ id: repository.id, fullName: typeof repository.full_name === "string" ? repository.full_name : typeof repository.fullName === "string" ? repository.fullName : "" });
  }
  return normalized;
}

// Applies one installation / installation_repositories webhook payload to
// the store. Returns { handled: false } for anything that is not an
// installation lifecycle event we track, so the route can 200 every
// validly signed delivery without inventing state.
export async function applyInstallationWebhook({ store, payload, now = Date.now } = {}) {
  if (!store || typeof store.putInstallation !== "function") throw new Error("GitHub installation store is required.");
  if (!payload || typeof payload !== "object") return { handled: false };
  const installation = payload.installation;
  const installationId = installation?.id;
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return { handled: false };
  const action = payload.action;
  const updatedAt = new Date(typeof now === "function" ? now() : now).toISOString();

  if (payload.repositories_added !== undefined || payload.repositories_removed !== undefined || action === "added" || action === "removed") {
    const existing = await store.getInstallation(installationId);
    if (!existing) return { handled: false };
    const byId = new Map(existing.repositories.map((repository) => [repository.id, repository]));
    for (const repository of normalizeRepositories(payload.repositories_added)) byId.set(repository.id, repository);
    for (const repository of normalizeRepositories(payload.repositories_removed)) byId.delete(repository.id);
    await store.putInstallation({ ...existing, repositories: [...byId.values()], updatedAt });
    return { handled: true, installationId };
  }

  const base = {
    installationId,
    accountLogin: typeof installation.account?.login === "string" ? installation.account.login : "",
    accountType: typeof installation.account?.type === "string" ? installation.account.type : "",
    updatedAt,
  };
  switch (action) {
    case "created": {
      await store.putInstallation({
        ...base,
        repositories: normalizeRepositories(payload.repositories ?? installation.repositories),
        suspended: Boolean(installation.suspended_at),
      });
      return { handled: true, installationId };
    }
    case "edited":
    case "new_permissions_accepted": {
      const existing = await store.getInstallation(installationId);
      await store.putInstallation({
        ...base,
        accountLogin: base.accountLogin || existing?.accountLogin || "",
        accountType: base.accountType || existing?.accountType || "",
        repositories: normalizeRepositories(payload.repositories ?? installation.repositories ?? existing?.repositories),
        suspended: installation.suspended_at ? true : existing?.suspended ?? false,
      });
      return { handled: true, installationId };
    }
    case "suspend": {
      const existing = await store.getInstallation(installationId);
      if (!existing) return { handled: false };
      await store.putInstallation({ ...existing, suspended: true, updatedAt });
      return { handled: true, installationId };
    }
    case "unsuspend": {
      const existing = await store.getInstallation(installationId);
      if (!existing) return { handled: false };
      await store.putInstallation({ ...existing, suspended: false, updatedAt });
      return { handled: true, installationId };
    }
    case "deleted": {
      await store.deleteInstallation(installationId);
      return { handled: true, installationId };
    }
    default:
      return { handled: false };
  }
}

// ---------------------------------------------------------------------------
// Install linking: the signed-in customer returns from GitHub's install
// screen with an installation id and the state nonce that beginInstall
// bound to their account. Linking trusts nothing the browser carried: the
// state is consumed single-use, the installation is fetched live from
// GitHub as the app, and only then is anything written.

export class GitHubApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export function buildInstallUrl({ slug, state } = {}) {
  if (typeof slug !== "string" || !slug) throw new Error("GitHub App slug is required.");
  if (typeof state !== "string" || !state) throw new Error("GitHub install state is required.");
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

async function githubApiJson(fetchImpl, url, options, failureMessage) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new GitHubApiError(response.status, failureMessage);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new GitHubApiError(0, failureMessage);
  return payload;
}

// The live installation record, fetched as the app itself. GitHub answers
// 404 both for unknown ids and for installations that belong to a
// different app, so a 404 is the not-found / not-ours signal.
export async function fetchInstallation({ appJwt, installationId, fetchImpl = fetch } = {}) {
  if (typeof appJwt !== "string" || !appJwt) throw new Error("GitHub App JWT is required.");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("GitHub installation id is required.");
  const payload = await githubApiJson(fetchImpl, `${GITHUB_API_BASE}/app/installations/${installationId}`, {
    headers: githubApiHeaders(appJwt),
  }, "GitHub installation lookup failed.");
  if (payload.id !== installationId) throw new GitHubApiError(0, "GitHub installation lookup failed.");
  return {
    installationId,
    appId: Number.isSafeInteger(payload.app_id) ? payload.app_id : undefined,
    accountLogin: typeof payload.account?.login === "string" ? payload.account.login : "",
    accountType: typeof payload.account?.type === "string" ? payload.account.type : "",
    suspended: Boolean(payload.suspended_at),
  };
}

// The repositories the installation can reach, read with an installation
// token. Paging is capped (default 3 pages x 100) so a huge installation
// cannot fan the link request out indefinitely; the webhook keeps the
// stored set complete afterwards.
export async function fetchInstallationRepositories({ token, fetchImpl = fetch, maxPages = 3 } = {}) {
  if (typeof token !== "string" || !token) throw new Error("GitHub installation token is required.");
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) throw new Error("GitHub repository page cap is invalid.");
  const headers = githubApiHeaders(token);
  const collected = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await githubApiJson(fetchImpl, `${GITHUB_API_BASE}/installation/repositories?per_page=100&page=${page}`, {
      headers,
    }, "GitHub installation repository lookup failed.");
    const batch = Array.isArray(payload.repositories) ? payload.repositories : [];
    collected.push(...batch);
    if (batch.length < 100) break;
  }
  return normalizeRepositories(collected);
}

// Links one installation to the signed-in SolveLang account. The state
// nonce is consumed FIRST and must be bound to this account with the
// install purpose — any mismatch is one generic state error, so the
// route is no oracle for other accounts' states. The installation is
// then verified live against GitHub; the link records are written only
// after every GitHub check has passed, so a failure leaves nothing
// half-written. GitHub-side failures surface as a generic 502.
export async function linkInstallationFromGitHub({ store, appId, privateKey, accountId, installationId, state, fetchImpl = fetch, now = Date.now } = {}) {
  if (!store || typeof store.consumeOAuthStateRecord !== "function" || typeof store.putInstallation !== "function"
    || typeof store.linkAccountInstallation !== "function") {
    throw new Error("GitHub installation store is required.");
  }
  if (typeof accountId !== "string" || !accountId
    || !Number.isSafeInteger(installationId) || installationId <= 0
    || typeof state !== "string" || !state) {
    throw new ApiAccessError(400, "github_link_invalid", "The installation link request is invalid.");
  }
  const consumed = await store.consumeOAuthStateRecord(state);
  if (!consumed || consumed.purpose !== "install" || consumed.accountId !== accountId) {
    throw new ApiAccessError(400, "github_link_state_invalid", "The installation link has expired. Start the install again.");
  }

  let installation;
  let repositories;
  try {
    const appJwt = createAppJwt({ appId, privateKey, now });
    try {
      installation = await fetchInstallation({ appJwt, installationId, fetchImpl });
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        throw new ApiAccessError(404, "github_installation_not_found", "That GitHub installation was not found for this app.");
      }
      throw error;
    }
    if (installation.appId !== Number(appId)) {
      throw new ApiAccessError(403, "github_installation_mismatch", "That installation does not belong to the SolveLang GitHub App.");
    }
    if (installation.suspended) {
      throw new ApiAccessError(403, "github_installation_suspended", "That GitHub installation is suspended.");
    }
    const { token } = await createInstallationToken({ appJwt, installationId, fetchImpl });
    repositories = await fetchInstallationRepositories({ token, fetchImpl });
  } catch (error) {
    if (error instanceof ApiAccessError) throw error;
    throw new ApiAccessError(502, "github_upstream_unavailable", "GitHub could not be reached to verify the installation.");
  }

  const record = {
    installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositories,
    suspended: false,
    accountId,
    updatedAt: new Date(typeof now === "function" ? now() : now).toISOString(),
  };
  await store.putInstallation(record);
  await store.linkAccountInstallation({ accountId, installationId });
  return {
    installationId,
    accountLogin: record.accountLogin,
    accountType: record.accountType,
    repositories,
    suspended: false,
    linked: true,
  };
}
