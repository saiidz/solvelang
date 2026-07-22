#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
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
      ? control("entitlement-health-contract", "Entitlement health contract", "pass", "Service, infrastructure template, and safe health response contract are present.")
      : control("entitlement-health-contract", "Entitlement health contract", "fail", "The entitlement service and infrastructure template do not expose the required safe GET /health contract.", "Add a credential-free health response and route before deployment verification."),
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
  controls.push(probeControl("stripe-webhook", "Stripe webhook endpoint", probes.webhook, "Register and verify payment_intent.succeeded in Stripe test mode."));
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
  const entitlementService = await readFile(path.join(root, "services/entitlements/src/service.ts"), "utf8");
  const entitlementTemplate = await readFile(path.join(root, "services/entitlements/template.yaml"), "utf8");
  const entitlementE2eTest = await readFile(path.join(root, "services/entitlements/test/e2e.test.ts"), "utf8");
  const entitlementPrivacyTest = await readFile(path.join(root, "services/entitlements/test/privacy.test.ts"), "utf8");
  const browserRecoveryTest = await readFile(path.join(root, "site/app/check/core/paidRecovery.test.ts"), "utf8");
  const preflightClient = await readFile(path.join(root, "site/app/check/WorkflowPreflight.tsx"), "utf8");
  const healthRoute = /method\s*===\s*["']GET["'][\s\S]*\/health/.test(entitlementService)
    && /status:\s*["']ok["'],\s*service:\s*["']solvelang-entitlements["'],\s*mode:\s*config\.mode/.test(entitlementService)
    && /Path:\s*\/health[\s\S]*Method:\s*GET/.test(entitlementTemplate)
    && /health exposes only a fixed non-sensitive test-mode readiness contract/.test(entitlementE2eTest);
  const privacySafe = /body:\s*JSON\.stringify\(\{\s*scanId\s*\}\)/.test(preflightClient)
    && /body:\s*JSON\.stringify\(\{\s*name\s*\}\)/.test(preflightClient)
    && /metadata:\s*\{\s*scanId,\s*product:\s*PRODUCT\s*\}/.test(entitlementService)
    && /workflow and secret material never reaches client errors or structured logs/.test(entitlementPrivacyTest)
    && /conversion logging accepts only allowlisted event names/.test(entitlementPrivacyTest)
    && !/logger\.(?:info|error)\([^\n]*(?:error\.message|event\.body|rawBody)/.test(entitlementService)
    && !/console\.error\([^\n]*(?:error\.message|event\.body)/.test(entitlementHandler);
  const requiredLifecycleEvidence = [
    /checkout creation (?:uses minimal metadata and a deterministic idempotency key|returns a custom checkout client secret with minimal metadata)/,
    /valid signed webhook records one entitlement and replay or duplicate delivery remains idempotent/,
    /Stripe gateway verifies a deterministic local test signature without network access/,
    /invalid webhook signatures are rejected without processing/,
    /paid checkout recovery issues a verifiable short-lived entitlement/,
    /expired, invalid, and tampered entitlement tokens are rejected/,
  ];
  const testModeE2eHarness = requiredLifecycleEvidence.every((pattern) => pattern.test(entitlementE2eTest))
    && /browser return verifies entitlement server-side and removes checkout parameters/.test(browserRecoveryTest)
    && /browser recovery fails closed for mismatched scans and unverifiable payment/.test(browserRecoveryTest);
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
      tagValidation: /refs\/tags\/v/.test(workflowText) && /package\.json/.test(workflowText),
      tests: /npm\s+(?:test|run\s+test)/.test(workflowText),
      packedInstall: /npm\s+pack/.test(workflowText) && /npm\s+install/.test(workflowText),
      publicPublish: /npm\s+publish\s+--access\s+public/.test(workflowText),
      tokenSecret: /NPM_TOKEN|NODE_AUTH_TOKEN/.test(workflowText),
    },
    entitlement: { healthRoute, privacySafe, testModeE2eHarness },
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { ok: result.status === 0, stdout: result.stdout?.trim(), stderr: result.stderr?.trim() };
}

function probeUrl(url, init = {}) {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), ...init })
    .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.text() }))
    .catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : "Request failed." }));
}

export async function collectOnlineEvidence({ environment = process.env, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..") } = {}) {
  const repository = await collectRepositoryState(root);
  const probes = {};

  if (environment.AWS_REGION && environment.ENTITLEMENT_STACK_NAME) {
    const result = run("aws", ["cloudformation", "describe-stacks", "--region", environment.AWS_REGION, "--stack-name", environment.ENTITLEMENT_STACK_NAME, "--output", "json"]);
    probes.aws = result.ok ? { ok: true } : { ok: false, reason: result.stderr || "AWS stack probe failed." };
  }

  if (environment.STRIPE_SECRET_KEY && environment.STRIPE_PRICE_ID) {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(environment.STRIPE_PRICE_ID)}`, { headers: { authorization: `Bearer ${environment.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    probes.stripe = response?.ok ? { ok: true } : { ok: false, reason: "Stripe Price lookup failed." };
  }

  if (environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE) {
    probes.entitlementHealth = await probeUrl(`${environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE.replace(/\/$/, "")}/health`);
  }

  if (environment.STRIPE_WEBHOOK_ENDPOINT) {
    const response = await probeUrl(environment.STRIPE_WEBHOOK_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    probes.webhook = response.status === 400 ? { ok: true } : { ok: false, reason: `Expected signed-webhook rejection, received ${response.status ?? "no response"}.` };
  }

  if (environment.SITE_ORIGIN) {
    probes.site = await probeUrl(environment.SITE_ORIGIN);
  }

  return { repository, probes };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const online = process.argv.includes("--online");
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const environment = process.env;
  const evidence = online ? await collectOnlineEvidence({ environment, root }) : { repository: await collectRepositoryState(root), probes: {} };
  const report = evaluateLaunch({ environment, repository: evidence.repository, probes: evidence.probes });
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderMarkdown(report));
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
