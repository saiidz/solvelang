// Merge-governance pilot — Lambda entry point.
//
// One function serves every trigger for the pilot skeleton (kept as a
// single function deliberately; splitting ingress/worker is a later
// step). Triggers:
//   - HttpApi:  GET  /tenants/{tenantId}/queue?owner=<o>&repo=<r>
//   - HttpApi:  POST /webhooks/github            (signed webhook ingress)
//   - SQS:      webhook worker queue             (state transitions)
//   - EventBridge schedule (rate 15 minutes): {"action":"reconcile"}
//
// Everything fails closed with sanitized errors:
//   - ADMIN_TOKEN unset            -> 503 (pilot admin auth not configured)
//   - x-admin-token header missing -> 401
//   - no GitHub credential resolves for a repo (no installation
//     token, no static GITHUB_TOKEN) -> 503 (reader not configured)
//   - MGOV_GITHUB_APP_ID / MGOV_GITHUB_APP_PRIVATE_KEY unset
//                                  -> GitHub App auth off; installation-
//                                     bound repos fall back, then fail closed
//   - GitHub App token mint fails  -> 502 (typed GitHubAppAuthError;
//                                     GitHub detail is never leaked)
//   - WEBHOOK_SECRET unset         -> 503 (webhook ingress not configured)
//   - bad webhook signature        -> 401
//
// The handler is built by a factory so tests can inject an in-memory
// store, config, fetch implementation, and SQS sender.

import { timingSafeEqual } from "node:crypto";
import { createAppAuth } from "./github-app-auth.js";
import { buildQueueSnapshot, readRepoQueue, resolveRepoToken } from "./queue-reader.js";
import { createDynamoStore } from "./state-store.js";
import { createWebhookHandler, defaultSqsSend } from "./webhook.js";
import { createWorker } from "./worker.js";

const RULES_VERSION = "pilot-0";

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// PILOT_REPOS entry shape: "owner/repo" or "owner/repo@<installationId>".
// The optional "@<installationId>" suffix binds the repo to a GitHub App
// installation, so reads for it mint an installation token instead of
// using the static token. A non-numeric suffix is ignored (the repo is
// treated as unbound) rather than failing the whole sweep.
export function parseRepoList(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("/"))
    .map((entry) => {
      const [repoPart, installationPart] = entry.split("@");
      const [owner, repo] = repoPart.split("/");
      const installationId = /^\d+$/.test(installationPart || "")
        ? Number(installationPart)
        : null;
      return { owner, repo, fullName: `${owner}/${repo}`, installationId };
    });
}

export function configFromEnv(env) {
  return {
    tableName: env.TABLE_NAME || "",
    githubToken: env.GITHUB_TOKEN || "",
    githubAppId: env.MGOV_GITHUB_APP_ID || "",
    githubAppPrivateKey: env.MGOV_GITHUB_APP_PRIVATE_KEY || "",
    adminToken: env.ADMIN_TOKEN || "",
    webhookSecret: env.WEBHOOK_SECRET || "",
    webhookQueueUrl: env.WEBHOOK_QUEUE_URL || "",
    pilotTenantId: env.PILOT_TENANT_ID || "",
    pilotRepos: parseRepoList(env.PILOT_REPOS || ""),
    rulesVersion: RULES_VERSION,
  };
}

export function createHandler({ store, config, fetchImpl = fetch, sqsSend, appAuth }) {
  // GitHub App auth is resolved once per handler: callers (tests, proof
  // runs) may inject their own; otherwise it is built from config and
  // stays off unless BOTH the app id and the private key are configured.
  const resolvedAppAuth =
    appAuth !== undefined
      ? appAuth
      : config.githubAppId && config.githubAppPrivateKey
        ? createAppAuth({
            appId: config.githubAppId,
            privateKeyPem: config.githubAppPrivateKey,
            fetchImpl,
          })
        : null;
  const handleWebhook = createWebhookHandler({
    config,
    sqsSend: sqsSend || defaultSqsSend,
  });
  const handleSqsEvent = createWorker({ store, config });

  async function handleQueueRead(event) {
    if (!config.adminToken) {
      return json(503, { error: "admin_auth_not_configured" });
    }
    const headers = event.headers || {};
    const provided = headers["x-admin-token"] || headers["X-Admin-Token"] || "";
    if (!tokenMatches(provided, config.adminToken)) {
      return json(401, { error: "unauthorized" });
    }
    const tenantId = event.pathParameters?.tenantId;
    const owner = event.queryStringParameters?.owner;
    const repo = event.queryStringParameters?.repo;
    if (!tenantId || !owner || !repo) {
      return json(400, { error: "tenant_owner_repo_required" });
    }

    // Credential resolution is per repo: the stored repo record may bind
    // the repo to a GitHub App installation; the pilot repo spec is the
    // fallback binding until such a record exists. Nothing resolvable
    // fails closed with 503; a failed installation-token mint throws the
    // typed GitHubAppAuthError, which the outer handler maps to a
    // sanitized 502.
    const repoRecord = await store.getRepoRecord(tenantId, `${owner}/${repo}`);
    const pilotEntry = (config.pilotRepos || []).find(
      (entry) => entry.fullName === `${owner}/${repo}`
    );
    const token = await resolveRepoToken({
      installationId: repoRecord?.installationId ?? pilotEntry?.installationId ?? null,
      staticToken: config.githubToken,
      appAuth: resolvedAppAuth,
    });
    if (!token) {
      return json(503, { error: "github_not_configured" });
    }

    const { prs } = await readRepoQueue({
      owner,
      repo,
      token,
      fetchImpl,
    });
    const snapshot = buildQueueSnapshot(tenantId, owner, repo, prs, new Date());
    snapshot.summary.paused = Boolean(repoRecord?.paused);

    await store.putQueueSnapshot(snapshot);
    await store.appendDecision({
      tenantId,
      repo: snapshot.repo,
      action: "queue_read",
      reason: `openPrs=${snapshot.summary.openPrs} drafts=${snapshot.summary.drafts}`,
      rulesVersion: config.rulesVersion,
    });
    await store.bumpUsage(tenantId, {
      queueReads: 1,
      prsObserved: snapshot.summary.openPrs,
    });

    return json(200, {
      tenantId,
      repo: snapshot.repo,
      summary: snapshot.summary,
      prs: snapshot.prs,
    });
  }

  // Shield guard: on the 15-minute sweep, any stored QUEUE entry in state
  // "merging" whose live head SHA no longer matches (or whose PR vanished)
  // pauses the repo automatically and writes a decision record. The pilot
  // never un-pauses on its own.
  async function handleReconcile() {
    const tenantId = config.pilotTenantId;
    if (!tenantId || config.pilotRepos.length === 0) {
      return { ok: true, skipped: "pilot_not_configured", paused: [] };
    }
    const paused = [];
    let readAny = false;
    for (const entry of config.pilotRepos) {
      const { owner, repo, fullName } = entry;
      // Same per-repo credential resolution as the queue-read route: a
      // stored record binding wins, then the pilot spec's own binding.
      // A repo with no resolvable credential is skipped; if none could
      // be read the sweep reports github_not_configured as before.
      const repoRecord = await store.getRepoRecord(tenantId, fullName);
      const token = await resolveRepoToken({
        installationId: repoRecord?.installationId ?? entry.installationId ?? null,
        staticToken: config.githubToken,
        appAuth: resolvedAppAuth,
      });
      if (!token) continue;
      readAny = true;
      const { prs } = await readRepoQueue({
        owner,
        repo,
        token,
        fetchImpl,
      });
      const liveByNumber = new Map(prs.map((pr) => [pr.number, pr]));
      const stored = await store.listQueueEntries(tenantId, fullName);
      for (const entry of stored) {
        if (entry.state !== "merging") continue;
        const live = liveByNumber.get(entry.prNumber);
        if (!live || live.headSha !== entry.headSha) {
          await store.setRepoPaused(tenantId, fullName, true, {
            reason: `head_mismatch pr=${entry.prNumber} stored=${entry.headSha} live=${live ? live.headSha : "missing"}`,
            rulesVersion: config.rulesVersion,
          });
          await store.appendDecision({
            tenantId,
            repo: fullName,
            pr: entry.prNumber,
            action: "auto_pause_mismatch",
            reason: "stored merging head does not match live head",
            rulesVersion: config.rulesVersion,
          });
          paused.push({ repo: fullName, pr: entry.prNumber });
        }
      }
    }
    if (!readAny) {
      return { ok: false, skipped: "github_not_configured", paused: [] };
    }
    return { ok: true, paused };
  }

  return async function mergeGovernanceHandler(event) {
    try {
      if (event && Array.isArray(event.Records) && event.Records.length > 0) {
        return await handleSqsEvent(event);
      }
      if (event && event.action === "reconcile") {
        return await handleReconcile();
      }
      const method = event?.requestContext?.http?.method;
      const rawPath = event?.rawPath || "";
      if (method === "POST" && rawPath === "/webhooks/github") {
        return await handleWebhook(event);
      }
      if (
        method === "GET" &&
        rawPath.startsWith("/tenants/") &&
        rawPath.endsWith("/queue")
      ) {
        return await handleQueueRead(event);
      }
      return json(404, { error: "not_found" });
    } catch (err) {
      // Sanitized: never leak upstream detail or internals to callers.
      console.error("merge_governance_error", err?.message || "unknown");
      return json(502, { error: "upstream_unavailable" });
    }
  };
}

let defaultHandler = null;

export async function handler(event) {
  if (!defaultHandler) {
    const config = configFromEnv(process.env);
    const store = createDynamoStore({ tableName: config.tableName });
    defaultHandler = createHandler({ store, config });
  }
  return defaultHandler(event);
}
