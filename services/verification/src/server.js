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
//                                 immediately, the run proceeds async
//
// The app itself is created by the manifest flow, so its permission
// set is exactly the manifest's — locked minimal at creation
// (teardown U4 / move M3). The published set:
//   checks: write, contents: read, pull_requests: read,
//   issues: write, metadata: read. Events: pull_request only.

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
import { createGitHubClient } from "./github.js";
import {
  createChangedFilesReader,
  createGateCliRunner,
  createTarballTreeFetcher,
  createVerificationRunner,
} from "./runner.js";

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
  mgovBase: (process.env.VERIFICATION_MGOV_BASE ||
    "https://2l346svz17.execute-api.us-east-2.amazonaws.com").replace(/\/$/, ""),
  mgovAdminToken: process.env.VERIFICATION_MGOV_ADMIN_TOKEN || "",
  settleTimeoutMs: Number(process.env.VERIFICATION_CHECKS_SETTLE_TIMEOUT_MS || 180_000),
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

export function buildManifest(publicBase) {
  return {
    name: "SolveLang Verification",
    url: "https://www.solve-lang.com/change-impact-receipt/",
    hook_attributes: {
      url: `${publicBase}/webhooks/github`,
      active: true,
    },
    redirect_url: `${publicBase}/app-manifest-callback`,
    description:
      "Independent verification for pull requests: graded change-impact receipts (verified / failed / unverified), Solve Graph blast-radius and policy evidence, posted as a check run with inline annotations and a receipt comment. Report-only by default; enforce mode is an in-repo setting.",
    public: true,
    default_permissions: {
      checks: "write",
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "read",
    },
    default_events: ["pull_request"],
  };
}

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
    html(
      res,
      200,
      `<!doctype html><title>SolveLang Verification — app created</title><h1>SolveLang Verification</h1><p>The GitHub App <strong>${credentials.name || credentials.slug}</strong> is created and this service holds its credentials.</p><p><a href="https://github.com/apps/${credentials.slug}/installations/new">Install it on a repository</a></p>`
    );
    return;
  }
  const manifest = JSON.stringify(buildManifest(config.publicBase));
  html(
    res,
    200,
    `<!doctype html><title>SolveLang Verification — create the app</title><h1>Create the SolveLang Verification GitHub App</h1><p>One click, signed in as the app owner. The manifest requests only: checks write, contents read, pull requests read, issues write, metadata read — and the pull_request event.</p><form action="https://github.com/settings/apps/new?state=${setupState}" method="post"><input type="hidden" name="manifest" value='${manifest.replace(/'/g, "&#39;")}'><button type="submit">Create GitHub App</button></form>`
  );
}

async function handleManifestCallback(req, res, url) {
  const code = url.searchParams.get("code");
  if (!code) {
    html(res, 400, "<h1>Missing manifest code</h1>");
    return;
  }
  try {
    const credentials = await exchangeManifestCode(code);
    await sealCredentials(credentials);
    html(
      res,
      200,
      `<!doctype html><title>SolveLang Verification — app created</title><h1>App created</h1><p><strong>${credentials.name}</strong> (${credentials.slug}, id ${credentials.id}) is created and its credentials are sealed on this service.</p><p><a href="https://github.com/apps/${credentials.slug}/installations/new">Install it on a repository</a></p>`
    );
  } catch (err) {
    console.error("manifest_callback_failed", err?.name || "Error");
    html(res, 502, "<h1>App creation exchange failed</h1><p>The manifest code could not be exchanged. It is valid for a few minutes only — restart from /setup.</p>");
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
