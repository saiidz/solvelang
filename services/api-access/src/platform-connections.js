import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiAccessError } from "./service.js";
import { readPlatformRepository } from "./platform-repo-reader.js";

// Platform connections for the repository audit's "connect a
// repository" doors (GitLab, Azure DevOps, Bitbucket, Forgejo /
// Gitea). GitHub keeps its own app-install flow and bindings read;
// these are the platforms whose connection is a set of identifiers
// the customer types by hand.
//
// What a connection is — stated plainly, because the audit page
// repeats it to the customer: registering a connection saves its
// identifiers (and, when the customer supplies one, its access
// token, sealed with KMS — see platform-token-protector.js) under
// the customer's account so the connection is listed as theirs.
// Nothing is ever run against the customer's repository at
// registration time, and no audit result is ever fabricated.
//
// The audit action RUNS a live repository read for the platforms
// in PLATFORM_AUDIT_LIVE_PLATFORMS when the connection has a
// stored token: the token is unsealed, each repository in the
// connection is read through its platform's own API
// (platform-repo-reader.js) into the same manifest the GitHub
// leg produces, and one run record per repository is stored —
// read_complete with the manifest facts, or read_failed when the
// platform could not be read. A failed read never masquerades as
// a completed audit, and when every repository fails the action
// answers with an error, mirroring the GitHub read. A platform
// joins the live list only after its leg has run end-to-end in
// proof; until then — and whenever a live platform's connection
// has no stored token — the audit action answers with the honest
// awaiting-configuration status below.
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

// Platforms whose live audit leg has run end-to-end in proof and
// may therefore run for real connections. Every other platform
// keeps the awaiting-configuration answer, verbatim, until its
// own proof exists. Forge (the Forgejo / Gitea /api/v1 family)
// was proven end-to-end against a self-hosted Gitea instance on
// 2026-11-28; GitLab, Azure DevOps, and Bitbucket readers are
// implemented but unproven against a live workspace, so they are
// deliberately NOT in this list.
export const PLATFORM_AUDIT_LIVE_PLATFORMS = ["forge"];

export const PLATFORM_AUDIT_READ_COMPLETE = "read_complete";
export const PLATFORM_AUDIT_READ_PARTIAL = "read_partial";
export const PLATFORM_AUDIT_READ_FAILED = "read_failed";

export const PLATFORM_AUDIT_READ_COMPLETE_MESSAGE =
  "Audit read complete — every repository in this connection was read and its run record stored.";

export const PLATFORM_AUDIT_READ_PARTIAL_MESSAGE =
  "Audit read finished — some repositories in this connection were read and stored; the rest could not be read.";

const PLATFORM_LABELS = {
  gitlab: "GitLab",
  azure: "Azure DevOps",
  bitbucket: "Bitbucket",
  forge: "the Forgejo / Gitea instance",
};

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

export function platformConnectionView(record, auditState = PLATFORM_AUDIT_AWAITING_CONFIGURATION) {
  // The ONLY shape a read ever returns: identifiers, the audit
  // state, and whether a token is stored (plus its fingerprint).
  // The sealed ciphertext never leaves the store through a view.
  // The audit state is the connection's latest run state when the
  // caller resolved one from stored run records, and the honest
  // awaiting-configuration state otherwise.
  const view = {
    connectionId: record.connectionId,
    platform: record.platform,
    repositories: record.repositories,
    tokenStored: typeof record.tokenCiphertext === "string" && record.tokenCiphertext.length > 0,
    tokenFingerprint: typeof record.tokenFingerprint === "string" ? record.tokenFingerprint : null,
    auditState,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (record.baseUrl) view.baseUrl = record.baseUrl;
  if (record.organization) view.organization = record.organization;
  if (record.project) view.project = record.project;
  if (record.workspace) view.workspace = record.workspace;
  return view;
}

// Derives a connection's audit state from its stored run
// records: the latest run per repository decides — all complete
// is read_complete, a mix is read_partial, runs that all failed
// are read_failed, and no runs at all leaves the connection in
// the awaiting-configuration state.
export function latestAuditState(runs, connectionId) {
  const latestByRepository = new Map();
  for (const run of runs ?? []) {
    if (!run || run.connectionId !== connectionId || typeof run.repository !== "string") continue;
    const previous = latestByRepository.get(run.repository);
    if (!previous || String(run.createdAt ?? "") >= String(previous.createdAt ?? "")) {
      latestByRepository.set(run.repository, run);
    }
  }
  if (latestByRepository.size === 0) return PLATFORM_AUDIT_AWAITING_CONFIGURATION;
  const statuses = [...latestByRepository.values()].map((run) => run.status);
  const completed = statuses.filter((status) => status === PLATFORM_AUDIT_READ_COMPLETE).length;
  if (completed === statuses.length) return PLATFORM_AUDIT_READ_COMPLETE;
  if (completed > 0) return PLATFORM_AUDIT_READ_PARTIAL;
  return PLATFORM_AUDIT_READ_FAILED;
}

export function createPlatformConnectionsService({
  store,
  protector,
  readers,
  fetchImpl = fetch,
  now = () => new Date(),
  createId = randomUUID,
  createRunId = () => `run_${randomBytes(12).toString("hex")}`,
} = {}) {
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
      const runs = typeof store.listAuditRuns === "function" ? await store.listAuditRuns(accountId) : [];
      return {
        connections: records.map((record) => platformConnectionView(record, latestAuditState(runs, record.connectionId))),
      };
    },

    async audit(accountId, connectionId) {
      if (typeof connectionId !== "string" || !connectionId) {
        throw invalid("A valid connection is required.");
      }
      const records = await store.listConnections(accountId);
      const record = records.find((entry) => entry.connectionId === connectionId);
      if (!record) throw new ApiAccessError(404, "connection_not_found", "That connection does not exist for your account.");

      const hasToken = typeof record.tokenCiphertext === "string" && record.tokenCiphertext.length > 0;
      if (!PLATFORM_AUDIT_LIVE_PLATFORMS.includes(record.platform) || !hasToken) {
        // Not a live-proven platform yet, or a live platform whose
        // connection carries no access token: the honest answer is
        // the awaiting-configuration status, unchanged.
        return {
          connectionId: record.connectionId,
          platform: record.platform,
          auditState: PLATFORM_AUDIT_AWAITING_CONFIGURATION,
          message: PLATFORM_AUDIT_AWAITING_MESSAGE,
        };
      }
      if (!protector || typeof protector.decrypt !== "function" || typeof store.putAuditRun !== "function") {
        throw new ApiAccessError(503, "platform_connections_not_configured", "Platform connections are being switched on.");
      }

      const token = await protector.decrypt(accountId, record.tokenCiphertext);
      const readRepository = readers?.[record.platform]
        ?? ((repository) => readPlatformRepository({
          platform: record.platform,
          token,
          connection: record,
          repository,
          fetchImpl,
        }));

      const runs = [];
      for (const repository of record.repositories) {
        const runId = createRunId();
        const createdAt = now().toISOString();
        try {
          const manifest = await readRepository(repository);
          await store.putAuditRun(accountId, {
            runId,
            connectionId: record.connectionId,
            platform: record.platform,
            repository,
            status: PLATFORM_AUDIT_READ_COMPLETE,
            manifest: {
              defaultBranch: manifest.defaultBranch,
              commitSha: manifest.commitSha,
              totals: manifest.totals,
            },
            createdAt,
          });
          runs.push({
            repository,
            runId,
            status: PLATFORM_AUDIT_READ_COMPLETE,
            defaultBranch: manifest.defaultBranch,
            commitSha: manifest.commitSha,
            totals: manifest.totals,
          });
        } catch {
          // A failed read is recorded as exactly that — never as a
          // completed audit — and the run continues with the next
          // repository in the connection.
          await store.putAuditRun(accountId, {
            runId,
            connectionId: record.connectionId,
            platform: record.platform,
            repository,
            status: PLATFORM_AUDIT_READ_FAILED,
            createdAt,
          });
          runs.push({ repository, runId, status: PLATFORM_AUDIT_READ_FAILED });
        }
      }

      const completed = runs.filter((run) => run.status === PLATFORM_AUDIT_READ_COMPLETE);
      if (completed.length === 0) {
        throw new ApiAccessError(
          502,
          "platform_repo_read_failed",
          `The repositories could not be read from ${PLATFORM_LABELS[record.platform] ?? "the platform"}.`,
        );
      }
      const auditState = completed.length === runs.length ? PLATFORM_AUDIT_READ_COMPLETE : PLATFORM_AUDIT_READ_PARTIAL;
      return {
        connectionId: record.connectionId,
        platform: record.platform,
        auditState,
        message: auditState === PLATFORM_AUDIT_READ_COMPLETE
          ? PLATFORM_AUDIT_READ_COMPLETE_MESSAGE
          : PLATFORM_AUDIT_READ_PARTIAL_MESSAGE,
        runs,
      };
    },
  };
}
