import { createHash, randomUUID } from "node:crypto";
import { ApiAccessError } from "./service.js";

// Platform connections for the repository audit's "connect a
// repository" doors (GitLab, Azure DevOps, Bitbucket, Forgejo /
// Gitea). GitHub keeps its own app-install flow and bindings read;
// these are the platforms whose connection is a set of identifiers
// the customer types by hand.
//
// What a connection is today — stated plainly, because the audit
// page repeats it to the customer: registering a connection saves
// its identifiers (and, when the customer supplies one, its access
// token, sealed with KMS — see platform-token-protector.js) under
// the customer's account so the connection is listed as theirs.
// The repository-audit summary itself is produced today only for
// GitHub-connected repositories; for these platforms the audit
// action answers with the honest awaiting-configuration status
// below. Nothing is ever run against the customer's repository at
// registration time, and no audit result is ever fabricated: the
// status text is the whole answer until a platform's live audit
// is configured.
//
// The token is optional at registration: a connection saved
// without one is listed as having no token stored, which the page
// shows as its own fact. When a token IS supplied, only its
// SHA-256 fingerprint (12 hex chars) and the sealed ciphertext
// are kept; the fingerprint is the only token-derived value any
// read ever returns.

export const PLATFORM_CONNECTION_PLATFORMS = ["gitlab", "azure", "bitbucket", "forge"];

export const PLATFORM_AUDIT_AWAITING_CONFIGURATION = "awaiting_configuration";

export const PLATFORM_AUDIT_AWAITING_MESSAGE =
  "Connection saved — the first live audit for this platform is enabled when its access is configured. Nothing has been run against your repository yet.";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MAX_REPOSITORIES = 25;
const MAX_TOKEN_LENGTH = 8192;

function invalid(message) {
  return new ApiAccessError(400, "invalid_request", message);
}

function cleanBaseUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) throw invalid(`A valid ${label} is required.`);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid(`A valid ${label} is required.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw invalid(`A valid ${label} is required.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function cleanSegment(value, label) {
  if (typeof value !== "string" || !SEGMENT.test(value.trim())) {
    throw invalid(`A valid ${label} is required.`);
  }
  return value.trim();
}

function cleanFreeName(value, label) {
  // Azure DevOps organization, project, and repository names may
  // contain spaces; they may not contain path separators, because
  // the name is one segment of the platform's own addressing.
  if (typeof value !== "string") throw invalid(`A valid ${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || /[/\\]/.test(trimmed)) {
    throw invalid(`A valid ${label} is required.`);
  }
  return trimmed;
}

function cleanRepositories(value, label, parse) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REPOSITORIES) {
    throw invalid(`Between one and ${MAX_REPOSITORIES} ${label} are required.`);
  }
  const seen = new Set();
  const repositories = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed === null) throw invalid(`A valid ${label} entry is required.`);
    if (!seen.has(parsed)) {
      seen.add(parsed);
      repositories.push(parsed);
    }
  }
  return repositories;
}

function parseProjectPath(value) {
  // GitLab project paths are slash-joined segments and may nest
  // groups: group/project, group/sub/project. At least two
  // segments — a bare group is not a project.
  if (typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length < 2) return null;
  if (!parts.every((part) => SEGMENT.test(part))) return null;
  return parts.join("/");
}

function parseRepoSlug(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  if (!SEGMENT.test(parts[0]) || !SEGMENT.test(parts[1])) return null;
  return `${parts[0]}/${parts[1]}`;
}

export function cleanPlatformConnectionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("A platform connection is required.");
  }
  const platform = typeof input.platform === "string" ? input.platform.trim() : "";
  if (!PLATFORM_CONNECTION_PLATFORMS.includes(platform)) {
    throw invalid("A valid platform is required.");
  }
  let token;
  if (input.token !== undefined && input.token !== null && input.token !== "") {
    if (typeof input.token !== "string" || input.token.length < 8 || input.token.length > MAX_TOKEN_LENGTH) {
      throw invalid("A valid access token is required.");
    }
    token = input.token;
  }
  const base = { platform, token };
  if (platform === "gitlab") {
    return {
      ...base,
      baseUrl: cleanBaseUrl(input.baseUrl, "GitLab instance URL"),
      repositories: cleanRepositories(input.repositories, "GitLab projects", parseProjectPath),
    };
  }
  if (platform === "forge") {
    return {
      ...base,
      baseUrl: cleanBaseUrl(input.baseUrl, "Forgejo / Gitea instance URL"),
      repositories: cleanRepositories(input.repositories, "repositories", parseRepoSlug),
    };
  }
  if (platform === "azure") {
    return {
      ...base,
      organization: cleanFreeName(input.organization, "Azure DevOps organization"),
      project: cleanFreeName(input.project, "Azure DevOps project"),
      repositories: cleanRepositories(input.repositories, "repositories", (value) => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed && trimmed.length <= 64 && !/[/\\]/.test(trimmed) ? trimmed : null;
      }),
    };
  }
  return {
    ...base,
    workspace: cleanSegment(input.workspace, "Bitbucket workspace"),
    repositories: cleanRepositories(input.repositories, "repositories", (value) => (
      typeof value === "string" && SEGMENT.test(value.trim()) ? value.trim() : null
    )),
  };
}

export function tokenFingerprint(token) {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12);
}

export function platformConnectionView(record) {
  // The ONLY shape a read ever returns: identifiers, the audit
  // state, and whether a token is stored (plus its fingerprint).
  // The sealed ciphertext never leaves the store through a view.
  const view = {
    connectionId: record.connectionId,
    platform: record.platform,
    repositories: record.repositories,
    tokenStored: typeof record.tokenCiphertext === "string" && record.tokenCiphertext.length > 0,
    tokenFingerprint: typeof record.tokenFingerprint === "string" ? record.tokenFingerprint : null,
    auditState: PLATFORM_AUDIT_AWAITING_CONFIGURATION,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.baseUrl) view.baseUrl = record.baseUrl;
  if (record.organization) view.organization = record.organization;
  if (record.project) view.project = record.project;
  if (record.workspace) view.workspace = record.workspace;
  return view;
}

export function createPlatformConnectionsService({ store, protector, now = () => new Date(), createId = randomUUID } = {}) {
  if (!store || typeof store.addConnection !== "function" || typeof store.listConnections !== "function") {
    throw new Error("A platform connections store is required.");
  }

  return {
    async register(accountId, input) {
      const cleaned = cleanPlatformConnectionInput(input);
      const timestamp = now().toISOString();
      const record = {
        connectionId: createId(),
        platform: cleaned.platform,
        repositories: cleaned.repositories,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (cleaned.baseUrl) record.baseUrl = cleaned.baseUrl;
      if (cleaned.organization) record.organization = cleaned.organization;
      if (cleaned.project) record.project = cleaned.project;
      if (cleaned.workspace) record.workspace = cleaned.workspace;
      if (cleaned.token !== undefined) {
        if (!protector || typeof protector.encrypt !== "function") {
          throw new ApiAccessError(503, "platform_connections_not_configured", "Platform connections are being switched on.");
        }
        record.tokenCiphertext = await protector.encrypt(accountId, cleaned.token);
        record.tokenFingerprint = tokenFingerprint(cleaned.token);
      }
      await store.addConnection(accountId, record);
      return platformConnectionView(record);
    },

    async list(accountId) {
      const records = await store.listConnections(accountId);
      return { connections: records.map(platformConnectionView) };
    },

    async audit(accountId, connectionId) {
      if (typeof connectionId !== "string" || !connectionId) {
        throw invalid("A valid connection is required.");
      }
      const records = await store.listConnections(accountId);
      const record = records.find((entry) => entry.connectionId === connectionId);
      if (!record) throw new ApiAccessError(404, "connection_not_found", "That connection does not exist for your account.");
      return {
        connectionId: record.connectionId,
        platform: record.platform,
        auditState: PLATFORM_AUDIT_AWAITING_CONFIGURATION,
        message: PLATFORM_AUDIT_AWAITING_MESSAGE,
      };
    },
  };
}
