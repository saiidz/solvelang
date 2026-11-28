// SolveLang Verification service — HTTP wiring.
//
// Routes:
//   GET  /health                  liveness + app-configured state
//   GET  /setup                   the App Manifest bootstrap page
//                                 (owner opens it once, in a browser
//                                 signed in to GitHub; the form posts
//                                 the manifest to GitHub, GitHub
//                                 redirects back with a code)
//   GET  /app-manifest-callback   exchanges the manifest code for the
//                                 created app's credentials and seals
//                                 them to the credentials file (0600)
//   GET  /install                 redirect to the app's install page
//   POST /webhooks/github         signed pull_request ingress: 202
//                                 immediately, the run proceeds async;
//                                 also the `/solvelang verify` comment
//                                 command (issue_comment events)
//   POST /backtest                start a public-repo backtest job
//   GET  /backtest/<id>           poll a backtest job / report
//
// The app itself is created by the manifest flow, so its permission
// set is exactly the manifest's — locked minimal at creation
// (teardown U4 / move M3). The published set:
//   checks: write, contents: read, pull_requests: write,
//   issues: write, metadata: read. Events: pull_request, and — for
//   apps created from the current manifest — issue_comment.
//   (pull_requests is write because GitHub gates an app token's PR
//   conversation comments on it — see src/manifest.js.)

import { randomBytes } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAppAuth,
  exchangeManifestCode,
  verifyWebhookSignature,
} from "./app-auth.js";
import {
  BACKTEST_DEFAULT_COUNT,
  BACKTEST_MAX_COUNT,
  createBacktestGrader,
  createBacktestJobs,
  createFileBacktestStore,
  createPublicGithubReader,
  createPublicTreeFetcher,
  isValidRepoSlug,
} from "./backtest.js";
import { createGitHubClient, CHECK_RUN_NAME } from "./github.js";
import { buildManifest } from "./manifest.js";
import { parseIssueCommentTrigger } from "./trigger.js";
import {
  createChangedFilesReader,
  createGateCliRunner,
  createTarballTreeFetcher,
  createVerificationRunner,
} from "./runner.js";
import {
  renderManifestCallbackFailurePage,
  renderManifestCallbackMissingCodePage,
  renderManifestCallbackSuccessPage,
  renderSetupAppCreatedPage,
  renderSetupCreatePage,
} from "./pages.js";

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.VERIFICATION_REPO_ROOT
  ? path.resolve(process.env.VERIFICATION_REPO_ROOT)
  : path.resolve(serviceDir, "..", "..", "..");

const config = {
  port: Number(process.env.VERIFICATION_PORT || 8080),
  publicBase: (process.env.VERIFICATION_PUBLIC_BASE || "https://verify.solve-lang.com").replace(/\/$/, ""),
  credentialsPath:
    process.env.VERIFICATION_APP_CREDENTIALS || "/data/app.json",
  workRoot: process.env.VERIFICATION_WORK_ROOT || "/tmp/verification-runs",
  backtestDir: process.env.VERIFICATION_BACKTEST_DIR || "/data/backtests",
  mgovBase: (process.env.VERIFICATION_MGOV_BASE ||
    "https://2l346svz17.execute-api.us-east-2.amazonaws.com").replace(/\/$/, ""),
  mgovAdminToken: process.env.VERIFICATION_MGOV_ADMIN_TOKEN || "",
  settleTimeoutMs: Number(process.env.VERIFICATION_CHECKS_SETTLE_TIMEOUT_MS || 180_000),
  settleRegistrationMs: Number(
    process.env.VERIFICATION_CHECKS_SETTLE_REGISTRATION_MS || 60_000
  ),
};

const require = createRequire(import.meta.url);
const kit = {
  collector: require(path.join(
    repoRoot,
    "packages/pr-gate/dist/packages/pr-gate/src/github-receipt.js"
  )),
  policy: require(path.join(
    repoRoot,
    "packages/pr-gate/dist/packages/pr-gate/src/policy.js"
  )),
  receiptCore: require(path.join(serviceDir, "..", "dist-receipt", "receipt.cjs")),
};

// --- App credentials (created by the manifest flow) ---

let credentialsCache = null;
async function loadCredentials() {
  try {
    const info = await stat(config.credentialsPath);
    if (credentialsCache && credentialsCache.mtimeMs === info.mtimeMs) {
      return credentialsCache.value;
    }
    const value = JSON.parse(await readFile(config.credentialsPath, "utf8"));
    if (!value || !Number.isSafeInteger(value.id) || typeof value.pem !== "string") {
      return null;
    }
    credentialsCache = { mtimeMs: info.mtimeMs, value };
    return value;
  } catch {
    return null;
  }
}

async function sealCredentials(value) {
  const tmp = `${config.credentialsPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, config.credentialsPath);
  credentialsCache = null;
}

// --- Manifest ---

// --- Audit client (governance decision log, via MGOV) ---

async function postAudit(body) {
  if (!config.mgovAdminToken) {
    console.error("verification_audit_unconfigured");
    return { ok: false };
  }
  try {
    const response = await fetch(`${config.mgovBase}/verification/audit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": config.mgovAdminToken,
        "user-agent": "solvelang-verification",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error("verification_audit_failed", `status=${response.status}`);
      return { ok: false };
    }
    const payload = await response.json().catch(() => null);
    return { ok: true, decision: payload?.decision ?? null };
  } catch {
    console.error("verification_audit_failed", "status=0");
    return { ok: false };
  }
}

// --- Run assembly ---

const inFlight = new Set();

async function startRun(payload) {
  const credentials = await loadCredentials();
  if (!credentials) return;
  const appAuth = createAppAuth({
    appId: credentials.id,
    privateKeyPem: credentials.pem,
  });
  const runner = createVerificationRunner({
    getToken: (installationId) => appAuth.getInstallationToken(installationId),
    createClient: (token) => createGitHubClient({ token }),
    collectReceiptInput: (options) => kit.collector.collectGithubReceiptInput(options),
    buildReceipt: (input) => kit.receiptCore.buildChangeImpactReceipt(input),
    renderReceiptMarkdown: (receipt) =>
      kit.receiptCore.renderChangeImpactReceiptMarkdown(receipt),
    runGate: createGateCliRunner({
      cliPath: path.join(
        repoRoot,
        "packages/pr-gate/dist/packages/pr-gate/src/cli.js"
      ),
    }),
    fetchTree: createTarballTreeFetcher(),
    listChangedFiles: createChangedFilesReader(),
    matchGlob: kit.policy.matchGlob,
    postAudit,
    workRoot: config.workRoot,
    settleTimeoutMs: config.settleTimeoutMs,
    settleRegistrationMs: config.settleRegistrationMs,
    log: (event, detail) => console.error(event, detail),
  });
  const repository = payload.repository || {};
  const pr = payload.pull_request || {};
  const run = runner
    .runVerification({
      installationId: payload.installation?.id ?? null,
      owner: repository.owner?.login,
      repo: repository.name,
      prNumber: pr.number,
      headSha: pr.head?.sha,
      baseSha: pr.base?.sha,
    })
    .then((record) => {
      console.error(
        "verification_run_complete",
        `${record.repo}#${record.pr} conclusion=${record.conclusion} mode=${record.mode} check=${record.checkRunId} audit=${record.auditOk}`
      );
    })
    .catch((err) => {
      console.error("verification_run_crashed", err?.name || "Error");
    })
    .finally(() => inFlight.delete(run));
  inFlight.add(run);
}

// --- `/solvelang verify` comment trigger ---
//
// The comment carries no SHAs, so resolve the PR's current head/base
// with an installation-token client, then hand startRun a payload in
// the pull_request shape it already understands. The fresh run posts
// a NEW check run on the head and updates the sticky receipt comment
// in place — the new evidence supersedes the old visibly.
async function startVerifyRun(trigger) {
  const credentials = await loadCredentials();
  if (!credentials) return;
  const appAuth = createAppAuth({
    appId: credentials.id,
    privateKeyPem: credentials.pem,
  });
  const token = await appAuth.getInstallationToken(trigger.installationId);
  const client = createGitHubClient({ token });
  const pr = await client.getPullRequest(trigger.owner, trigger.repo, trigger.prNumber);
  if (!pr?.head?.sha || !pr?.base?.sha) return;
  startRun({
    installation: { id: trigger.installationId },
    repository: { name: trigger.repo, owner: { login: trigger.owner } },
    pull_request: {
      number: trigger.prNumber,
      head: { sha: pr.head.sha },
      base: { sha: pr.base.sha },
    },
  });
}

// --- Backtest (public, read-only) ---
//
// The site calls these routes cross-origin from the backtest page;
// CORS is allowlisted to the site's own origins. Jobs are started
// under a fixed-window per-IP limit (the unauthenticated upstream
// GitHub budget is shared) and completed reports are cached per repo
// for 24h on the data volume.

const BACKTEST_ALLOWED_ORIGINS = new Set([
  "https://www.solve-lang.com",
  "https://solve-lang.com",
]);
const BACKTEST_START_LIMIT = 3;
const BACKTEST_START_WINDOW_MS = 60 * 60_000;
const backtestStarts = new Map();

function backtestCorsHeaders(req) {
  const origin = req.headers.origin || "";
  if (!BACKTEST_ALLOWED_ORIGINS.has(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

function backtestStartAllowed(ip) {
  const nowMs = Date.now();
  const entry = backtestStarts.get(ip);
  if (!entry || nowMs - entry.windowStart >= BACKTEST_START_WINDOW_MS) {
    backtestStarts.set(ip, { windowStart: nowMs, count: 1 });
    return true;
  }
  if (entry.count >= BACKTEST_START_LIMIT) return false;
  entry.count += 1;
  return true;
}

let backtestJobs = null;
function getBacktestJobs() {
  if (backtestJobs) return backtestJobs;
  const reader = createPublicGithubReader({});
  const grader = createBacktestGrader({
    reader,
    collectReceiptInput: (options) => kit.collector.collectGithubReceiptInput(options),
    buildReceipt: (input) => kit.receiptCore.buildChangeImpactReceipt(input),
    runGate: createGateCliRunner({
      cliPath: path.join(
        repoRoot,
        "packages/pr-gate/dist/packages/pr-gate/src/cli.js"
      ),
    }),
    fetchTree: createPublicTreeFetcher({}),
    workRoot: config.workRoot,
    matchGlob: kit.policy.matchGlob,
    ownCheckName: CHECK_RUN_NAME,
  });
  backtestJobs = createBacktestJobs({
    store: createFileBacktestStore({ dir: config.backtestDir }),
    reader,
    grader,
    makeId: () => `bt_${randomBytes(8).toString("hex")}`,
    log: (event, detail) => console.error(event, detail),
  });
  return backtestJobs;
}

async function handleBacktestStart(req, res) {
  const cors = backtestCorsHeaders(req);
  const ip = req.socket?.remoteAddress || "unknown";
  if (!backtestStartAllowed(ip)) {
    res.writeHead(429, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)) || "{}");
  } catch {
    res.writeHead(400, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }
  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!isValidRepoSlug(owner, repo)) {
    res.writeHead(400, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "invalid_repository" }));
    return;
  }
  const requested = Number(body.count);
  const count =
    Number.isInteger(requested) && requested >= 1
      ? Math.min(requested, BACKTEST_MAX_COUNT)
      : BACKTEST_DEFAULT_COUNT;
  const started = await getBacktestJobs().start({ owner, repo, count });
  res.writeHead(started.cached ? 200 : 202, {
    "content-type": "application/json",
    ...cors,
  });
  res.end(JSON.stringify(started));
}

async function handleBacktestGet(req, res, id) {
  const cors = backtestCorsHeaders(req);
  const job = await getBacktestJobs().get(id);
  if (!job) {
    res.writeHead(404, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(job));
}

// --- HTTP ---

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(body);
}

function html(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const setupState = randomBytes(16).toString("hex");

async function handleSetup(res) {
  const credentials = await loadCredentials();
  if (credentials) {
    html(res, 200, renderSetupAppCreatedPage(credentials));
    return;
  }
  const manifest = JSON.stringify(buildManifest(config.publicBase));
  html(res, 200, renderSetupCreatePage({ state: setupState, manifest }));
}

async function handleManifestCallback(req, res, url) {
  const code = url.searchParams.get("code");
  if (!code) {
    html(res, 400, renderManifestCallbackMissingCodePage());
    return;
  }
  try {
    const credentials = await exchangeManifestCode(code);
    await sealCredentials(credentials);
    html(res, 200, renderManifestCallbackSuccessPage(credentials));
  } catch (err) {
    console.error("manifest_callback_failed", err?.name || "Error");
    html(res, 502, renderManifestCallbackFailurePage());
  }
}

async function handleWebhook(req, res) {
  const credentials = await loadCredentials();
  if (!credentials) {
    json(res, 503, { error: "app_not_configured" });
    return;
  }
  const rawBody = await readBody(req);
  const signature = req.headers["x-hub-signature-256"] || "";
  if (!verifyWebhookSignature(credentials.webhookSecret, rawBody, signature)) {
    json(res, 401, { error: "invalid_signature" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    json(res, 400, { error: "invalid_json" });
    return;
  }
  const eventName = req.headers["x-github-event"] || "";
  const action = payload.action || "";
  if (eventName === "issue_comment" && action === "created") {
    const trigger = parseIssueCommentTrigger(payload);
    if (trigger && trigger.installationId) {
      json(res, 202, { accepted: true });
      startVerifyRun(trigger).catch((err) => {
        console.error("verify_trigger_failed", err?.name || "Error");
      });
      return;
    }
    json(res, 200, { ok: true, skipped: `issue_comment:${action}` });
    return;
  }
  if (
    eventName === "pull_request" &&
    ["opened", "reopened", "synchronize"].includes(action) &&
    payload.pull_request?.head?.sha &&
    payload.repository?.name &&
    payload.repository?.owner?.login
  ) {
    json(res, 202, { accepted: true });
    startRun(payload);
    return;
  }
  json(res, 200, { ok: true, skipped: `${eventName}:${action}` });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", config.publicBase);
    if (req.method === "GET" && url.pathname === "/health") {
      const credentials = await loadCredentials();
      json(res, 200, {
        status: "ok",
        service: "solvelang-verification",
        appConfigured: Boolean(credentials),
        appSlug: credentials?.slug ?? null,
        inFlight: inFlight.size,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/setup") {
      await handleSetup(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/app-manifest-callback") {
      await handleManifestCallback(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/install") {
      const credentials = await loadCredentials();
      if (!credentials) {
        json(res, 503, { error: "app_not_configured" });
        return;
      }
      res.writeHead(302, {
        location: `https://github.com/apps/${credentials.slug}/installations/new`,
      });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/webhooks/github") {
      await handleWebhook(req, res);
      return;
    }
    if (req.method === "OPTIONS" && url.pathname.startsWith("/backtest")) {
      res.writeHead(204, {
        ...backtestCorsHeaders(req),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/backtest") {
      await handleBacktestStart(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/backtest/")) {
      await handleBacktestGet(req, res, url.pathname.slice("/backtest/".length));
      return;
    }
    json(res, 404, { error: "not_found" });
  } catch (err) {
    console.error("verification_http_error", err?.name || "Error");
    if (!res.headersSent) json(res, 500, { error: "internal_error" });
  }
});

if (process.env.VERIFICATION_NO_LISTEN !== "1") {
  server.listen(config.port, () => {
    console.error(`solvelang-verification listening on ${config.port}`);
  });
}

export { server };
