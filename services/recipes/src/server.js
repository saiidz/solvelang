// SolveLang Recipes service — HTTP wiring (Stage 0).
//
// Routes:
//   GET  /health               liveness + catalog state (recipes
//                              registered, proven count — 0 in Stage 0)
//   POST /dispatch/manual      admin-gated manual firing of one recipe
//   POST /dispatch/pull-request admin-gated pull_request firing
//   POST /register             admin-gated schedule registration for a
//                              repo (config supplied by the caller is
//                              parsed and its cadence-enabled recipes
//                              are registered; the base-SHA read for
//                              each firing happens in the runner)
//   POST /tick                 admin-gated scheduler tick (the same
//                              tick the internal timer runs)
//
// Stage 0 honesty: there are NO recipe executors yet. The default
// executor produces a single unverified finding saying the recipe's
// executor is not built — an enabled recipe therefore records a run
// and a graded receipt, and claims nothing. Admin routes fail closed
// exactly like MGOV's: 503 when no token is configured, 401 on
// mismatch. The internal timer follows the digest/runners precedent
// (service-internal timer, RECIPES_TICK_MS, default 60s, 0 disables).

import { createServer } from "node:http";

import { readFileSync } from "node:fs";

import { createRecipesAuditClient } from "./audit.js";
import { enabledRecipes, parseRecipesConfig } from "./config.js";
import { createRecipesGitHubClient, splitRepo } from "./github.js";
import { createLicenseHeadersExecutor } from "./license-headers.js";
import { defaultRegistry } from "./registry.js";
import { createRecipesRunner } from "./runner.js";
import { createScheduleRegistry, createScheduler } from "./scheduler.js";

const config = {
  port: Number(process.env.RECIPES_PORT || 8080),
  adminToken: process.env.RECIPES_ADMIN_TOKEN || "",
  mgovBase: (process.env.RECIPES_MGOV_BASE ||
    "https://2l346svz17.execute-api.us-east-2.amazonaws.com").replace(/\/$/, ""),
  mgovAdminToken: process.env.RECIPES_MGOV_ADMIN_TOKEN || "",
  tickMs: Number(process.env.RECIPES_TICK_MS || 60_000),
  // The token every GitHub read/write of this service runs under.
  // In production this must be a SolveLang Process Solution App
  // installation token (the license-headers identity class); the
  // service never mints one itself and never logs the value. Supply
  // RECIPES_GITHUB_TOKEN or RECIPES_GITHUB_TOKEN_FILE.
  githubToken:
    process.env.RECIPES_GITHUB_TOKEN ||
    (process.env.RECIPES_GITHUB_TOKEN_FILE
      ? readFileSync(process.env.RECIPES_GITHUB_TOKEN_FILE, "utf8").trim()
      : ""),
};

export function createRecipesService(overrides = {}) {
  const registry = overrides.registry ?? defaultRegistry;
  const scheduleRegistry = createScheduleRegistry();
  const postAudit =
    overrides.postAudit ??
    createRecipesAuditClient({
      mgovBase: config.mgovBase,
      adminToken: config.mgovAdminToken,
      log: (event, detail) => console.error(event, detail),
    });
  const githubSource =
    overrides.githubSource ??
    (config.githubToken
      ? createRecipesGitHubClient({ token: config.githubToken })
      : null);
  const licenseHeadersExecutor = githubSource
    ? createLicenseHeadersExecutor({ source: githubSource })
    : null;
  const runner = createRecipesRunner({
    registry,
    readConfigTextAtRef:
      overrides.readConfigTextAtRef ??
      (async ({ repo, path, ref }) => {
        if (!githubSource) return null;
        const { owner, name } = splitRepo(repo);
        return githubSource.getFileTextAtRef(owner, name, path, ref);
      }),
    executeRecipe:
      overrides.executeRecipe ??
      (async (args) => {
        if (args.definition.id === "license-headers") {
          if (!licenseHeadersExecutor) {
            return {
              conclusion: "failure",
              findings: [
                {
                  label: "unverified",
                  text: "license-headers: no GitHub token configured for this service (RECIPES_GITHUB_TOKEN / RECIPES_GITHUB_TOKEN_FILE), so the executor could not run. In production the token is a SolveLang Process Solution App installation token.",
                },
              ],
            };
          }
          return licenseHeadersExecutor(args);
        }
        return {
          conclusion: "success",
          findings: [
            {
              label: "unverified",
              text: `Stage 0: the executor for ${args.definition.id} is not built yet. This run proves the packaging machinery only; no recipe work is claimed.`,
            },
          ],
        };
      }),
    postAudit,
    log: (event, detail) => console.error(event, detail),
  });
  const scheduler = createScheduler({
    registry: scheduleRegistry,
    dispatch: (args) => runner.runRecipe(args).then(({ record }) => record),
    log: (event, detail) => console.error(event, detail),
  });

  function adminGate(req) {
    if (!config.adminToken && !overrides.adminToken) {
      return { status: 503, error: "admin_not_configured" };
    }
    const expected = overrides.adminToken ?? config.adminToken;
    if ((req.headers["x-admin-token"] || "") !== expected) {
      return { status: 401, error: "unauthorized" };
    }
    return null;
  }

  function json(res, statusCode, payload) {
    res.writeHead(statusCode, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  function readBody(req, limitBytes = 1024 * 1024) {
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

  async function parseJsonBody(req, res) {
    try {
      return JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return null;
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        const catalog = registry.catalog();
        json(res, 200, {
          status: "ok",
          service: "solvelang-recipes",
          recipesRegistered: catalog.length,
          recipesProven: catalog.filter((recipe) => recipe.proven).length,
          scheduledRepos: new Set(scheduleRegistry.list().map((entry) => entry.repo)).size,
        });
        return;
      }
      const gated = [
        "/dispatch/manual",
        "/dispatch/pull-request",
        "/register",
        "/tick",
      ];
      if (req.method === "POST" && gated.includes(url.pathname)) {
        const gate = adminGate(req);
        if (gate) {
          json(res, gate.status, { error: gate.error });
          return;
        }
        const body = await parseJsonBody(req, res);
        if (body === null) return;
        if (url.pathname === "/tick") {
          const records = await scheduler.tick(Date.now());
          json(res, 200, { fired: records.length, records });
          return;
        }
        if (url.pathname === "/register") {
          if (typeof body.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(body.repo)) {
            json(res, 400, { error: "repo_required" });
            return;
          }
          const parsed = parseRecipesConfig(
            typeof body.configText === "string" ? body.configText : null,
            registry
          );
          scheduleRegistry.registerRepo({
            repo: body.repo,
            installationId: body.installationId ?? null,
            baseSha: body.baseSha ?? null,
            scheduled: enabledRecipes(parsed.config, registry),
            registeredAt: Date.now(),
          });
          json(res, 200, {
            registered: scheduleRegistry.list().filter((entry) => entry.repo === body.repo).length,
            configInvalid: parsed.invalid,
            note: parsed.note,
          });
          return;
        }
        if (typeof body.repo !== "string" || typeof body.recipeId !== "string") {
          json(res, 400, { error: "repo_and_recipe_required" });
          return;
        }
        if (url.pathname === "/dispatch/manual") {
          const { record, receipt } = await runner.runRecipe({
            repo: body.repo,
            recipeId: body.recipeId,
            trigger: "manual",
            baseSha: body.baseSha ?? null,
            installationId: body.installationId ?? null,
          });
          json(res, 200, { record, receipt });
          return;
        }
        const result = await scheduler.dispatchPullRequest({
          registry,
          repo: body.repo,
          recipeId: body.recipeId,
          baseSha: body.baseSha ?? null,
          headSha: body.headSha ?? null,
          prNumber: body.prNumber ?? null,
          installationId: body.installationId ?? null,
        });
        json(res, 200, result);
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch (err) {
      console.error("recipes_http_error", err?.name || "Error");
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
    }
  });

  return { server, registry, scheduleRegistry, scheduler, runner };
}

if (process.env.RECIPES_NO_LISTEN !== "1") {
  const { server, scheduler } = createRecipesService();
  server.listen(config.port, () => {
    console.error(`solvelang-recipes listening on ${config.port}`);
  });
  if (config.tickMs > 0) {
    const timer = setInterval(() => {
      scheduler.tick(Date.now()).catch((err) =>
        console.error("recipes_tick_failed", err?.name || "Error")
      );
    }, config.tickMs);
    timer.unref();
  }
}
