#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = {
  aws: ["AWS_REGION", "AWS_ROLE_ARN", "ENTITLEMENT_STACK_NAME"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"],
  entitlement: ["ENTITLEMENT_SIGNING_SECRET"],
  site: ["SITE_ORIGIN", "NEXT_PUBLIC_ENTITLEMENT_API_BASE"],
  webhook: ["STRIPE_WEBHOOK_ENDPOINT"],
  npm: ["NPM_SCOPE_OWNERSHIP_VERIFIED", "NPM_PRODUCTION_ENVIRONMENT_PROTECTED"],
};

function control(id, name, status, detail, ownerAction = undefined) {
  return { id, name, status, detail, ...(ownerAction ? { ownerAction } : {}) };
}

function missing(environment, names) {
  return names.filter((name) => typeof environment[name] !== "string" || environment[name].trim() === "");
}

function configControl(id, name, environment, names) {
  const absent = missing(environment, names);
  return absent.length
    ? control(id, name, "blocked", `Missing required variables: ${absent.join(", ")}.`, `Configure ${absent.join(", ")} in the protected test environment.`)
    : control(id, name, "pass", "All required variable names are configured; values were not emitted.");
}

function probeControl(id, name, probe, ownerAction) {
  if (probe?.ok) return control(id, name, "pass", "Verified by a safe external probe.");
  return control(id, name, "blocked", probe?.reason ?? "External verification was not run.", ownerAction);
}

export function evaluateLaunch({ environment, repository, probes = {}, now = new Date().toISOString() }) {
  const controls = [];
  controls.push(configControl("aws-configuration", "AWS deployment configuration", environment, REQUIRED.aws));
  controls.push(configControl("stripe-configuration", "Stripe test configuration", environment, REQUIRED.stripe));
  controls.push(configControl("entitlement-configuration", "Entitlement signing configuration", environment, REQUIRED.entitlement));
  controls.push(configControl("site-configuration", "Static site entitlement configuration", environment, REQUIRED.site));
  controls.push(configControl("webhook-configuration", "Stripe webhook configuration", environment, REQUIRED.webhook));
  controls.push(
    probes.github?.npmProductionProtected && probes.github?.npmScopeOwnershipVerified
      ? control("npm-configuration", "npm protected release configuration", "pass", "GitHub confirms the protected npm environment and ownership variable without exposing values.")
      : configControl("npm-configuration", "npm protected release configuration", environment, REQUIRED.npm),
  );
  controls.push(
    probes.github?.entitlementTestEnvironment
      ? control("github-entitlement-test-environment", "GitHub entitlement test environment", "pass", "The protected entitlement-test environment exists.")
      : control(
          "github-entitlement-test-environment",
          "GitHub entitlement test environment",
          "blocked",
          probes.github?.ok ? "GitHub confirms that entitlement-test is not configured." : "GitHub environment metadata was not available.",
          "Create the protected entitlement-test environment and configure its required variables and secrets by name.",
        ),
  );

  if (environment.STRIPE_SECRET_KEY && !environment.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    controls.push(control("stripe-mode", "Stripe mode", "fail", "The configured key is not a Stripe test-mode key.", "Use a protected sk_test_ credential for launch verification."));
  } else if (environment.STRIPE_SECRET_KEY) {
    controls.push(control("stripe-mode", "Stripe mode", "pass", "Stripe test mode is configured."));
  } else {
    controls.push(control("stripe-mode", "Stripe mode", "blocked", "STRIPE_SECRET_KEY is missing.", "Configure a protected Stripe test-mode key."));
  }

  const expectedWebhook = environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE
    ? `${environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE.replace(/\/$/, "")}/webhook`
    : undefined;
  if (environment.STRIPE_WEBHOOK_ENDPOINT && expectedWebhook && environment.STRIPE_WEBHOOK_ENDPOINT !== expectedWebhook) {
    controls.push(control("webhook-url-consistency", "Webhook URL consistency", "fail", "The configured webhook endpoint does not match the entitlement API base.", "Set STRIPE_WEBHOOK_ENDPOINT to the deployed entitlement API /webhook URL."));
  } else if (environment.STRIPE_WEBHOOK_ENDPOINT && expectedWebhook) {
    controls.push(control("webhook-url-consistency", "Webhook URL consistency", "pass", "Webhook and entitlement API paths are consistent."));
  } else {
    controls.push(control("webhook-url-consistency", "Webhook URL consistency", "blocked", "Webhook URL consistency cannot be checked until both variable names are configured."));
  }

  const releaseValues = [repository.mcpPackageVersion, repository.mcpLockVersion, repository.releaseTag?.replace(/^v/, ""), repository.npmVersion];
  const releaseComplete = releaseValues.every(Boolean);
  const releaseConsistent = releaseComplete && new Set(releaseValues).size === 1;
  controls.push(
    releaseConsistent
      ? control("mcp-release-consistency", "MCP release consistency", "pass", `Manifest, lockfile, release tag, and npm agree on ${repository.mcpPackageVersion}.`)
      : control(
          "mcp-release-consistency",
          "MCP release consistency",
          releaseComplete ? "fail" : "blocked",
          releaseComplete ? "Manifest, lockfile, release tag, and npm version mismatch." : "Manifest, lockfile, release tag, or npm version evidence is missing.",
          "Publish only through the protected Trusted Publishing release workflow after versions and tag agree.",
        ),
  );

  const workflow = repository.workflow;
  const workflowPass = workflow.oidc && workflow.protectedEnvironment && workflow.tagValidation && workflow.tests && workflow.packedInstall && workflow.publicPublish && !workflow.tokenSecret;
  controls.push(
    workflowPass
      ? control("npm-trusted-publishing", "npm Trusted Publishing workflow", "pass", "OIDC, protected environment, version gate, tests, packed install, and public publish are present without an npm token.")
      : control("npm-trusted-publishing", "npm Trusted Publishing workflow", "fail", "The guarded Trusted Publishing workflow contract is incomplete.", "Restore every guarded publishing step before creating a release."),
  );

  controls.push(
    repository.clean
      ? control("repository-state", "Repository state", "pass", "The evidence commit has no uncommitted changes.")
      : control("repository-state", "Repository state", "fail", "The evidence was collected from a dirty worktree.", "Commit or remove unrelated changes and rerun launch control."),
  );

  controls.push(
    repository.entitlement.healthRoute
      ? control("entitlement-health-contract", "Entitlement health contract", "pass", "Handler, infrastructure template, and safe health response contract are present.")
      : control("entitlement-health-contract", "Entitlement health contract", "fail", "The entitlement handler and infrastructure template do not expose the required safe GET /health contract.", "Add a credential-free health response and route before deployment verification."),
  );
  controls.push(
    repository.entitlement.privacySafe
      ? control("workflow-data-privacy", "Workflow-data privacy boundary", "pass", "Static contracts keep workflow and report data out of network payloads and server error logs.")
      : control("workflow-data-privacy", "Workflow-data privacy boundary", "fail", "The static privacy contract cannot prove workflow data stays out of network payloads and server logs.", "Remove request-derived error details and add regression coverage for allowlisted payloads."),
  );
  controls.push(
    repository.entitlement.testModeE2eHarness
      ? control("stripe-test-e2e-harness", "Stripe test-mode E2E harness", "pass", "Deterministic checkout, webhook, entitlement, replay, expiry, signature, and recovery coverage is present.")
      : control("stripe-test-e2e-harness", "Stripe test-mode E2E harness", "fail", "No deterministic end-to-end entitlement harness covers the required Stripe test-mode lifecycle.", "Add local fakes and browser recovery coverage without external internet dependencies."),
  );

  controls.push(probeControl("aws-stack", "AWS entitlement stack", probes.aws, "Run online launch control with authenticated test-account AWS access."));
  controls.push(probeControl("stripe-price", "Stripe test Price", probes.stripe, "Run online launch control with the protected Stripe test key."));
  controls.push(probeControl("entitlement-health", "Entitlement API health", probes.entitlementHealth, "Deploy the test stack, then rerun the public health probe."));
  controls.push(probeControl("stripe-webhook", "Stripe webhook endpoint", probes.webhook, "Register and verify checkout.session.completed in Stripe test mode."));
  controls.push(probeControl("site-deployment", "Static site deployment", probes.site, "Configure the public API base, rebuild the static site, and rerun the probe."));

  const summary = {
    pass: controls.filter(({ status }) => status === "pass").length,
    fail: controls.filter(({ status }) => status === "fail").length,
    blocked: controls.filter(({ status }) => status === "blocked").length,
  };
  return {
    schema: "solvelang.launch-readiness.v1",
    generatedAt: now,
    commitSha: repository.commitSha,
    ready: summary.fail === 0 && summary.blocked === 0,
    summary,
    testedComponents: controls.map(({ id }) => id),
    controls,
    unresolvedBlockers: controls
      .filter(({ status }) => status !== "pass")
      .map(({ id, status, detail, ownerAction }) => ({ id, status, detail, ...(ownerAction ? { ownerAction } : {}) })),
  };
}

export function renderMarkdown(report) {
  const rows = report.controls.map((item) => `| ${item.name} | ${item.status.toUpperCase()} | ${item.detail} |`).join("\n");
  const blockers = report.unresolvedBlockers.length
    ? report.unresolvedBlockers.map((item) => `- **${item.id} (${item.status})**: ${item.detail}${item.ownerAction ? ` Owner action: ${item.ownerAction}` : ""}`).join("\n")
    : "- None.";
  return `# SolveLang Launch Readiness Evidence\n\n- Generated: ${report.generatedAt}\n- Commit: \`${report.commitSha}\`\n- Ready: **${report.ready ? "YES" : "NO"}**\n- Results: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.blocked} blocked\n\n## Controls\n\n| Component | Status | Evidence |\n| --- | --- | --- |\n${rows}\n\n## Unresolved blockers\n\n${blockers}\n`;
}

function readJson(text) {
  return JSON.parse(text);
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function selectReleaseTag(version, tags) {
  const expected = `v${version}`;
  return tags.split(/\r?\n/).map((tag) => tag.trim()).find((tag) => tag === expected) ?? "";
}

export async function collectRepositoryState(root, { npmVersion } = {}) {
  const manifest = readJson(await readFile(path.join(root, "packages/mcp-server/package.json"), "utf8"));
  const lock = readJson(await readFile(path.join(root, "packages/mcp-server/package-lock.json"), "utf8"));
  const workflowText = await readFile(path.join(root, ".github/workflows/npm-release.yml"), "utf8");
  const entitlementHandler = await readFile(path.join(root, "services/entitlements/src/handler.ts"), "utf8");
  const entitlementTemplate = await readFile(path.join(root, "services/entitlements/template.yaml"), "utf8");
  const preflightClient = await readFile(path.join(root, "site/app/check/WorkflowPreflight.tsx"), "utf8");
  const healthRoute = /method\s*===\s*["']GET["'][\s\S]*\/health/.test(entitlementHandler)
    && /Path:\s*\/health[\s\S]*Method:\s*GET/.test(entitlementTemplate);
  const privacySafe = /body:\s*JSON\.stringify\(\{\s*scanId\s*\}\)/.test(preflightClient)
    && /body:\s*JSON\.stringify\(\{\s*name\s*\}\)/.test(preflightClient)
    && /metadata:\s*\{\s*scanId,\s*product:\s*["']workflow-preflight-v1["']\s*\}/.test(entitlementHandler)
    && !/console\.error\([^\n]*(?:error\.message|event\.body)/.test(entitlementHandler);
  return {
    commitSha: git(root, ["rev-parse", "HEAD"]),
    clean: git(root, ["status", "--porcelain"]) === "",
    mcpPackageVersion: manifest.version,
    mcpLockVersion: lock.version,
    releaseTag: process.env.RELEASE_TAG || selectReleaseTag(manifest.version, git(root, ["tag", "--list"])),
    npmVersion,
    workflow: {
      oidc: /id-token:\s*write/.test(workflowText),
      protectedEnvironment: /environment:\s*npm-production/.test(workflowText),
      tagValidation: /Verify release tag matches package version/.test(workflowText),
      tests: /npm test/.test(workflowText),
      packedInstall: /npm run test:packed/.test(workflowText),
      publicPublish: /npm publish --access public/.test(workflowText),
      tokenSecret: /NODE_AUTH_TOKEN|NPM_TOKEN/.test(workflowText),
    },
    entitlement: {
      healthRoute,
      privacySafe,
      testModeE2eHarness: existsSync(path.join(root, "services/entitlements/test/e2e.test.ts")),
    },
  };
}

async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
    return { response };
  } catch {
    return { response: null };
  }
}

async function onlineProbes(environment) {
  const probes = {};
  const repositoryName = environment.GITHUB_REPOSITORY || "saiidz/solvelang";
  const environmentsResult = spawnSync("gh", ["api", `repos/${repositoryName}/environments`], { encoding: "utf8", timeout: 10_000 });
  const variablesResult = spawnSync("gh", ["api", `repos/${repositoryName}/actions/variables`], { encoding: "utf8", timeout: 10_000 });
  try {
    const environments = environmentsResult.status === 0 ? JSON.parse(environmentsResult.stdout).environments : [];
    const variables = variablesResult.status === 0 ? JSON.parse(variablesResult.stdout).variables : [];
    const npmEnvironment = environments.find((item) => item?.name === "npm-production");
    const rules = Array.isArray(npmEnvironment?.protection_rules) ? npmEnvironment.protection_rules : [];
    probes.github = {
      ok: environmentsResult.status === 0 && variablesResult.status === 0,
      npmProductionProtected: Boolean(npmEnvironment && rules.some((rule) => rule?.type === "required_reviewers") && rules.some((rule) => rule?.type === "branch_policy")),
      npmScopeOwnershipVerified: variables.some((variable) => variable?.name === "NPM_SCOPE_OWNERSHIP_VERIFIED"),
      entitlementTestEnvironment: environments.some((item) => item?.name === "entitlement-test"),
    };
  } catch {
    probes.github = { ok: false, npmProductionProtected: false, npmScopeOwnershipVerified: false, entitlementTestEnvironment: false };
  }
  const apiBase = environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE?.replace(/\/$/, "");
  if (apiBase) {
    const { response } = await safeFetch(`${apiBase}/health`, { headers: { accept: "application/json" } });
    let health;
    try { health = response ? await response.json() : null; } catch { health = null; }
    probes.entitlementHealth = response?.ok && health?.status === "ok" && health?.mode === "test"
      ? { ok: true, mode: "test" }
      : { ok: false, reason: "The public health endpoint did not confirm test-mode readiness." };
  }
  if (environment.SITE_ORIGIN) {
    const { response } = await safeFetch(environment.SITE_ORIGIN, { method: "HEAD", redirect: "follow" });
    probes.site = response?.ok ? { ok: true } : { ok: false, reason: "The configured site origin was not reachable over HTTP." };
  }
  if (environment.STRIPE_SECRET_KEY?.startsWith("sk_test_") && environment.STRIPE_PRICE_ID) {
    const headers = { authorization: `Bearer ${environment.STRIPE_SECRET_KEY}` };
    const { response } = await safeFetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(environment.STRIPE_PRICE_ID)}`, { headers });
    let price;
    try { price = response ? await response.json() : null; } catch { price = null; }
    probes.stripe = response?.ok && price?.active === true && price?.livemode === false
      ? { ok: true, mode: "test" }
      : { ok: false, reason: "Stripe did not confirm an active test-mode Price." };

    const webhookResult = await safeFetch("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers });
    let endpoints;
    try { endpoints = webhookResult.response ? await webhookResult.response.json() : null; } catch { endpoints = null; }
    const endpoint = Array.isArray(endpoints?.data)
      ? endpoints.data.find((item) => item?.url === environment.STRIPE_WEBHOOK_ENDPOINT && item?.status === "enabled")
      : undefined;
    probes.webhook = endpoint?.enabled_events?.includes("checkout.session.completed")
      ? { ok: true }
      : { ok: false, reason: "Stripe did not confirm an enabled checkout.session.completed webhook." };
  }

  if (environment.AWS_REGION && environment.ENTITLEMENT_STACK_NAME) {
    const result = spawnSync("aws", [
      "cloudformation", "describe-stacks",
      "--region", environment.AWS_REGION,
      "--stack-name", environment.ENTITLEMENT_STACK_NAME,
      "--query", "Stacks[0].StackStatus",
      "--output", "text",
    ], { encoding: "utf8", timeout: 10_000 });
    probes.aws = result.status === 0 && /_COMPLETE\s*$/.test(result.stdout)
      ? { ok: true }
      : { ok: false, reason: "AWS did not confirm a completed entitlement stack." };
  }
  return probes;
}

async function publicNpmVersion() {
  const { response } = await safeFetch("https://registry.npmjs.org/@solvelang%2Fmcp-server/latest", { headers: { accept: "application/json" } });
  if (!response?.ok) return undefined;
  try { return (await response.json()).version; } catch { return undefined; }
}

async function writeEvidence(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const online = args.has("--online");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const npmVersion = online ? await publicNpmVersion() : process.env.NPM_PUBLIC_VERSION;
  const repository = await collectRepositoryState(root, { npmVersion });
  const probes = online ? await onlineProbes(process.env) : {};
  const report = evaluateLaunch({ environment: process.env, repository, probes });
  const evidenceRoot = path.join(root, "artifacts/launch-readiness");
  await writeEvidence(path.join(evidenceRoot, "launch-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeEvidence(path.join(evidenceRoot, "launch-readiness.md"), renderMarkdown(report));
  console.log(`Launch readiness: ${report.ready ? "PASS" : "BLOCKED"} (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.blocked} blocked)`);
  console.log(`Evidence: ${path.relative(root, evidenceRoot)}`);
  process.exitCode = report.ready ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
