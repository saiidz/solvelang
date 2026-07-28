#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = {
  aws: ["AWS_REGION", "AWS_ROLE_ARN", "ENTITLEMENT_STACK_NAME"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  entitlement: ["ENTITLEMENT_MODE", "ENTITLEMENT_SIGNING_SECRET", "CHECKOUT_ENABLED", "TURNSTILE_SECRET_KEY"],
  site: ["SITE_ORIGIN", "NEXT_PUBLIC_ENTITLEMENT_API_BASE", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
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
  controls.push(configControl("stripe-configuration", "Stripe configuration", environment, REQUIRED.stripe));
  controls.push(configControl("entitlement-configuration", "Entitlement signing configuration", environment, REQUIRED.entitlement));
  controls.push(configControl("site-configuration", "Static site entitlement configuration", environment, REQUIRED.site));
  controls.push(configControl("webhook-configuration", "Stripe webhook configuration", environment, REQUIRED.webhook));
  if (probes.github?.ok) {
    controls.push(
      !probes.github.npmProductionEnvironment
        ? control("npm-configuration", "npm protected release configuration", "blocked", "GitHub confirms that npm-production is not configured.", "Create the protected npm-production environment with a required reviewer.")
        : probes.github.npmProductionProtected && probes.github.npmScopeOwnershipVerified
          ? control("npm-configuration", "npm protected release configuration", "pass", "GitHub confirms the protected npm environment and ownership variable without exposing values.")
          : control("npm-configuration", "npm protected release configuration", "blocked", "GitHub metadata is missing a required npm release control.", "Require an npm-production reviewer and set NPM_SCOPE_OWNERSHIP_VERIFIED=true before a release."),
    );
  } else {
    controls.push(configControl("npm-configuration", "npm protected release configuration", environment, REQUIRED.npm));
  }
  const entitlementEnvironmentName = environment.ENTITLEMENT_MODE === "production" ? "entitlement-production" : "entitlement-test";
  const entitlementEnvironmentPresent = environment.ENTITLEMENT_MODE === "production"
    ? probes.github?.entitlementProductionEnvironment
    : probes.github?.entitlementTestEnvironment;
  controls.push(
    entitlementEnvironmentPresent
      ? control("github-entitlement-environment", "GitHub entitlement environment", "pass", `The protected ${entitlementEnvironmentName} environment exists.`)
      : control(
          "github-entitlement-environment",
          "GitHub entitlement environment",
          "blocked",
          probes.github?.ok ? `GitHub confirms that ${entitlementEnvironmentName} is not configured.` : "GitHub environment metadata was not available.",
          `Create the protected ${entitlementEnvironmentName} environment and configure its required variables and secrets by name.`,
        ),
  );

  const expectedStripePrefix = environment.ENTITLEMENT_MODE === "production" ? "sk_live_" : "sk_test_";
  if (environment.STRIPE_SECRET_KEY && !environment.STRIPE_SECRET_KEY.startsWith(expectedStripePrefix)) {
    controls.push(control("stripe-mode", "Stripe mode", "fail", "The configured Stripe key does not match the selected entitlement mode.", "Use the protected Stripe credential for the selected environment."));
  } else if (environment.STRIPE_SECRET_KEY && environment.ENTITLEMENT_MODE) {
    controls.push(control("stripe-mode", "Stripe mode", "pass", `Stripe ${environment.ENTITLEMENT_MODE} mode is configured.`));
  } else {
    controls.push(control("stripe-mode", "Stripe mode", "blocked", "ENTITLEMENT_MODE or STRIPE_SECRET_KEY is missing.", "Configure the selected mode and its protected Stripe key."));
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
  controls.push(
    repository.entitlement.refundAware
      ? control("refund-revocation", "Refund revocation contract", "pass", "Full refunds deny entitlement renewal, partial refunds are explicit, and signed refund webhooks are covered.")
      : control("refund-revocation", "Refund revocation contract", "fail", "Refund-aware verification and webhook regression coverage are incomplete.", "Restore server-side refund checks and deterministic refund tests before launch."),
  );
  controls.push(
    repository.entitlement.checkoutGate
      ? control("production-checkout-gate", "Production checkout bootstrap gate", "pass", "Checkout defaults disabled in production and the service denies disabled checkout before Stripe access.")
      : control("production-checkout-gate", "Production checkout bootstrap gate", "fail", "The production checkout bootstrap gate is incomplete.", "Require an explicit disabled-by-default checkout setting, zero-Stripe-call denial coverage, and guarded deployment configuration."),
  );

  if (environment.ENTITLEMENT_MODE === "production") {
    const enabled = environment.CHECKOUT_ENABLED === "true";
    const signedWebhookVerified = environment.WEBHOOK_SIGNED_DELIVERY_VERIFIED === "true";
    const legalReviewVerified = environment.LEGAL_CHECKOUT_REVIEW_VERIFIED === "true";
    const legalIdentityVerified = environment.LEGAL_IDENTITY_VERIFIED === "true";
    const durableConfirmationApproved = environment.DURABLE_CONFIRMATION_PROVIDER === "aws-ses-sqs";
    controls.push(
      enabled && signedWebhookVerified && legalReviewVerified && legalIdentityVerified && durableConfirmationApproved
        ? control("production-checkout-enablement", "Production checkout enablement", "pass", "Production checkout is explicitly enabled after protected webhook, legal, identity, and durable-confirmation controls.")
        : control(
            "production-checkout-enablement",
            "Production checkout enablement",
            "blocked",
            enabled && !signedWebhookVerified
              ? "Production checkout cannot be enabled until signed webhook verification is confirmed."
              : enabled && !legalReviewVerified
                ? "Production checkout cannot be enabled until the legal checkout review is confirmed."
                : enabled && !legalIdentityVerified
                  ? "Production checkout cannot be enabled until the operator identity and final consumer price are verified."
                  : enabled && !durableConfirmationApproved
                    ? "Production checkout cannot be enabled until the aws-ses-sqs durable confirmation provider is configured."
                : "Production checkout remains disabled.",
            "After the real webhook secret is installed, the legal checklist and operator identity are complete, the aws-ses-sqs provider is configured, and Stripe-signed delivery returns HTTP 200, set WEBHOOK_SIGNED_DELIVERY_VERIFIED=true, LEGAL_CHECKOUT_REVIEW_VERIFIED=true, LEGAL_IDENTITY_VERIFIED=true, DURABLE_CONFIRMATION_PROVIDER=aws-ses-sqs, and CHECKOUT_ENABLED=true in entitlement-production, then deploy again.",
          ),
    );
  } else {
    controls.push(
      environment.CHECKOUT_ENABLED === "true"
        ? control("test-checkout-enablement", "Test checkout enablement", "pass", "Test checkout is explicitly enabled for the test Stripe account.")
        : control("test-checkout-enablement", "Test checkout enablement", "fail", "Test checkout is disabled.", "Set CHECKOUT_ENABLED=true for the entitlement-test deployment."),
    );
  }

  controls.push(probeControl("aws-stack", "AWS entitlement stack", probes.aws, "Run online launch control with authenticated test-account AWS access."));
  controls.push(probeControl("stripe-account", "Stripe account access", probes.stripe, "Run online launch control with the protected Stripe key for the selected mode."));
  controls.push(probeControl("entitlement-health", "Entitlement API health", probes.entitlementHealth, "Deploy the test stack, then rerun the public health probe."));
  controls.push(probeControl("stripe-webhook", "Stripe webhook endpoint", probes.webhook, "Register and verify payment_intent.succeeded and charge.refunded in the selected Stripe mode."));
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

export async function writeLaunchEvidence(root, report, outputPath = undefined) {
  const directory = path.join(root, "artifacts/launch-readiness");
  const jsonPath = path.join(directory, "launch-readiness.json");
  const markdownPath = path.join(directory, "launch-readiness.md");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownPath, renderMarkdown(report)),
  ]);
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderMarkdown(report));
  }
  return [jsonPath, markdownPath];
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

export async function collectPublicNpmVersion(fetchImpl = fetch) {
  try {
    const response = await fetchImpl("https://registry.npmjs.org/%40solvelang%2Fmcp-server/latest", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    const payload = await response.json();
    return typeof payload?.version === "string" ? payload.version : undefined;
  } catch {
    return undefined;
  }
}

function parseCommandJson(result) {
  if (!result?.ok || !result.stdout) return undefined;
  try {
    return readJson(result.stdout);
  } catch {
    return undefined;
  }
}

export function collectGitHubMetadata({ repository, runCommand = run }) {
  if (!repository || !runCommand("gh", ["auth", "status"]).ok) {
    return { ok: false, reason: "Authenticated GitHub CLI access is unavailable." };
  }

  const environment = (name) => parseCommandJson(runCommand("gh", ["api", `repos/${repository}/environments/${name}`]));
  const entitlementTest = environment("entitlement-test");
  const entitlementProduction = environment("entitlement-production");
  const npmProduction = environment("npm-production");
  const ownership = parseCommandJson(runCommand("gh", ["api", `repos/${repository}/actions/variables/NPM_SCOPE_OWNERSHIP_VERIFIED`]));
  const npmProductionProtected = Array.isArray(npmProduction?.protection_rules)
    && npmProduction.protection_rules.some((rule) => rule?.type === "required_reviewers");

  return {
    ok: true,
    entitlementTestEnvironment: Boolean(entitlementTest),
    entitlementProductionEnvironment: Boolean(entitlementProduction),
    npmProductionEnvironment: Boolean(npmProduction),
    npmProductionProtected,
    npmScopeOwnershipVerified: ownership?.value === "true",
  };
}

function githubRepository(root) {
  const remote = git(root, ["remote", "get-url", "origin"]);
  const match = remote.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/);
  return match?.[1];
}

export async function collectRepositoryState(root, { npmVersion } = {}) {
  const manifest = readJson(await readFile(path.join(root, "packages/mcp-server/package.json"), "utf8"));
  const lock = readJson(await readFile(path.join(root, "packages/mcp-server/package-lock.json"), "utf8"));
  const workflowText = await readFile(path.join(root, ".github/workflows/npm-release.yml"), "utf8");
  const packedScript = manifest.scripts?.["test:packed"];
  const packedScriptMatch = typeof packedScript === "string" ? packedScript.match(/^node\s+(.+)$/) : undefined;
  const packedSmoke = packedScriptMatch
    ? await readFile(path.join(root, "packages/mcp-server", packedScriptMatch[1]), "utf8")
    : "";
  const entitlementHandler = await readFile(path.join(root, "services/entitlements/src/handler.ts"), "utf8");
  const entitlementService = await readFile(path.join(root, "services/entitlements/src/service.ts"), "utf8");
  const entitlementConfig = await readFile(path.join(root, "services/entitlements/src/config.ts"), "utf8");
  const entitlementTemplate = await readFile(path.join(root, "services/entitlements/template.yaml"), "utf8");
  const entitlementDeployWorkflow = await readFile(path.join(root, ".github/workflows/deploy-entitlements.yml"), "utf8");
  const entitlementE2eTest = await readFile(path.join(root, "services/entitlements/test/e2e.test.ts"), "utf8");
  const confirmationWorkerTest = await readFile(path.join(root, "services/entitlements/test/confirmation-worker.test.ts"), "utf8");
  const confirmationDispatcherTest = await readFile(path.join(root, "services/entitlements/test/confirmation-dispatcher.test.ts"), "utf8");
  const entitlementPrivacyTest = await readFile(path.join(root, "services/entitlements/test/privacy.test.ts"), "utf8");
  const browserRecoveryTest = await readFile(path.join(root, "site/app/check/core/paidRecovery.test.ts"), "utf8");
  const checkoutGateTest = await readFile(path.join(root, "site/app/check/core/turnstileCheckout.test.ts"), "utf8");
  const preflightClient = await readFile(path.join(root, "site/app/check/WorkflowPreflight.tsx"), "utf8");
  const paymentClient = await readFile(path.join(root, "site/app/checkout/PaymentElementClient.tsx"), "utf8");
  const checkoutTerms = await readFile(path.join(root, "site/app/checkout/checkoutGate.ts"), "utf8");
  const entitlementTerms = await readFile(path.join(root, "services/entitlements/src/terms.ts"), "utf8");
  const termsPage = await readFile(path.join(root, "site/app/(english)/terms/page.tsx"), "utf8");
  const refundPolicyPage = await readFile(path.join(root, "site/app/(english)/refund-policy/page.tsx"), "utf8");
  const legalChecklist = await readFile(path.join(root, "docs/checkout-legal-owner-checklist.md"), "utf8");
  const turnstileGateway = await readFile(path.join(root, "services/entitlements/src/turnstile.ts"), "utf8");
  const healthRoute = /method\s*===\s*["']GET["'][\s\S]*\/health/.test(entitlementService)
    && /status:\s*["']ok["'],\s*service:\s*["']solvelang-entitlements["'],\s*mode:\s*config\.mode/.test(entitlementService)
    && /Path:\s*\/health[\s\S]*Method:\s*GET/.test(entitlementTemplate)
    && /health exposes only a fixed non-sensitive test-mode readiness contract/.test(entitlementE2eTest);
  const privacySafe = /body:\s*JSON\.stringify\(\{[\s\S]*scanId,[\s\S]*turnstileToken:\s*token,[\s\S]*customerEmail:[\s\S]*termsAccepted:\s*true,[\s\S]*immediatePerformanceRequested:\s*true,[\s\S]*withdrawalAcknowledged:\s*true,[\s\S]*termsVersion:\s*TERMS_VERSION/.test(paymentClient)
    && /body:\s*JSON\.stringify\(\{\s*name\s*\}\)/.test(preflightClient)
    && /receiptEmail:\s*customerEmail/.test(entitlementService)
    && /immediatePerformanceRequested:\s*"true"/.test(entitlementService)
    && /withdrawalAcknowledged:\s*"true"/.test(entitlementService)
    && /const termsAcceptedAt = consentTimestamp\(paymentIntent\.createdAt\)/.test(entitlementService)
    && /await stripe\.payments\.updateMetadata\([\s\S]*\{ termsAcceptedAt \},[\s\S]*preflight-\$\{scanId\}-consent-\$\{termsVersion\}/.test(entitlementService)
    && /workflow and secret material never reaches client errors or structured logs/.test(entitlementPrivacyTest)
    && /conversion logging accepts only allowlisted event names/.test(entitlementPrivacyTest)
    && !/logger\.(?:info|error)\([^\n]*(?:error\.message|event\.body|rawBody)/.test(entitlementService)
    && !/console\.error\([^\n]*(?:error\.message|event\.body)/.test(entitlementHandler);
  const requiredLifecycleEvidence = [
    /test-mode checkout remains operational and records server-derived consent metadata/,
    /a lost PaymentIntent create response retries with stable parameters and recovers the original client secret/,
    /a failed consent metadata update withholds the client secret until a stable retry succeeds/,
    /valid signed webhook atomically records one entitlement and durable outbox across late replays/,
    /Stripe gateway verifies a deterministic local test signature without network access/,
    /invalid webhook signatures are rejected without processing/,
    /paid payment recovery issues a verifiable short-lived entitlement/,
    /expired, invalid, and tampered entitlement tokens are rejected/,
  ];
  const testModeE2eHarness = requiredLifecycleEvidence.every((pattern) => pattern.test(entitlementE2eTest))
    && /outbox dispatch retries queue or update ambiguity without losing the committed confirmation/.test(confirmationDispatcherTest)
    && /confirmation delivery leases recover safely and never acknowledge active or ambiguous records/.test(confirmationWorkerTest)
    && /strict confirmation schemas reject missing consent fields and arbitrary payload fields/.test(confirmationWorkerTest)
    && /browser return verifies entitlement server-side and removes payment parameters/.test(browserRecoveryTest)
    && /browser recovery fails closed for mismatched scans and unverifiable payment/.test(browserRecoveryTest);
  const refundAware = /full refunds revoke entitlement renewal while partial refunds remain eligible/.test(entitlementE2eTest)
    && /signed refund webhook records verified full refund state idempotently/.test(entitlementE2eTest)
    && /charge\.refunded/.test(entitlementService)
    && /refundStatus === ["']full["']/.test(entitlementService);
  const checkoutGate = [
    entitlementConfig.includes('CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false")'),
    entitlementConfig.includes("TURNSTILE_SECRET_KEY: z.string().min(1)"),
    entitlementService.includes("termsAccepted: z.literal(true)"),
    entitlementService.includes("immediatePerformanceRequested: z.literal(true)"),
    entitlementService.includes("withdrawalAcknowledged: z.literal(true)"),
    entitlementService.includes("termsVersion: z.literal(TERMS_VERSION)"),
    entitlementService.includes('if (!config.checkoutEnabled)'),
    entitlementService.includes('RequestError(503, "Checkout is temporarily unavailable."'),
    entitlementService.indexOf("verified = await turnstile.verify") < entitlementService.indexOf("paymentIntent = await stripe.payments.create"),
    entitlementHandler.includes('checkoutEnabled: environment.CHECKOUT_ENABLED === "true"'),
    entitlementTemplate.includes('CheckoutEnabled:') && entitlementTemplate.includes('Default: "false"'),
    entitlementTemplate.includes('LegalIdentityVerified:') && entitlementTemplate.includes('DurableConfirmationProvider:'),
    entitlementTemplate.includes('Path: /withdraw'),
    entitlementDeployWorkflow.includes('LEGAL_IDENTITY_VERIFIED') && entitlementDeployWorkflow.includes('DURABLE_CONFIRMATION_PROVIDER'),
    entitlementE2eTest.includes("missing, false, and unsupported consent fields fail before Turnstile or Stripe"),
    entitlementE2eTest.includes("report recovery remains unavailable until the signed webhook queues durable confirmation"),
    entitlementE2eTest.includes("withdrawal requests require durable confirmation and record only a server timestamp"),
    turnstileGateway.includes("expectedHostname") && turnstileGateway.includes("idempotency_key"),
    paymentClient.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY") && paymentClient.includes('action: "checkout"'),
    checkoutGateTest.includes("Turnstile expiry after a client secret mounts preserves the payment form state"),
    checkoutTerms.includes('export const TERMS_VERSION = "2026-07-26-v2"'),
    entitlementTerms.includes('legal-content.json'),
    termsPage.includes("Terms of Use") && refundPolicyPage.includes("Refund Policy"),
    legalChecklist.includes("LEGAL_CHECKOUT_REVIEW_VERIFIED"),
  ].every(Boolean);
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
      tagValidation: /RELEASE_TAG/.test(workflowText) && /v\$\(node -p/.test(workflowText) && /package\.json/.test(workflowText),
      tests: /npm\s+(?:test|run\s+test)/.test(workflowText),
      packedInstall: /npm\s+run\s+test:packed/.test(workflowText)
        && /npm", \["pack"/.test(packedSmoke)
        && /npm", \["install"/.test(packedSmoke)
        && /npx", \["--no-install", "solvelang-mcp"\]/.test(packedSmoke),
      publicPublish: /npm\s+publish\s+--access\s+public/.test(workflowText),
      tokenSecret: /NPM_TOKEN|NODE_AUTH_TOKEN/.test(workflowText),
    },
    entitlement: { healthRoute, privacySafe, testModeE2eHarness, refundAware, checkoutGate },
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { ok: result.status === 0, stdout: result.stdout?.trim(), stderr: result.stderr?.trim() };
}

function probeUrl(url, init = {}, fetchImpl = fetch) {
  return fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), ...init })
    .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.text() }))
    .catch((error) => ({ ok: false, reason: error instanceof Error ? error.message : "Request failed." }));
}

export async function collectOnlineEvidence({ environment = process.env, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), fetchImpl = fetch, runCommand = run } = {}) {
  const repository = await collectRepositoryState(root, { npmVersion: await collectPublicNpmVersion(fetchImpl) });
  const probes = {};
  const repositorySlug = githubRepository(root);
  probes.github = repositorySlug
    ? collectGitHubMetadata({ repository: repositorySlug, runCommand })
    : { ok: false, reason: "GitHub repository metadata could not be resolved." };

  if (environment.AWS_REGION && environment.ENTITLEMENT_STACK_NAME) {
    const result = runCommand("aws", ["cloudformation", "describe-stacks", "--region", environment.AWS_REGION, "--stack-name", environment.ENTITLEMENT_STACK_NAME, "--output", "json"]);
    probes.aws = result.ok ? { ok: true } : { ok: false, reason: result.stderr || "AWS stack probe failed." };
  }

  if (environment.STRIPE_SECRET_KEY) {
    const response = await fetchImpl("https://api.stripe.com/v1/account", { headers: { authorization: `Bearer ${environment.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    probes.stripe = response?.ok ? { ok: true } : { ok: false, reason: "Stripe account probe failed." };
  }

  if (environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE) {
    probes.entitlementHealth = await probeUrl(`${environment.NEXT_PUBLIC_ENTITLEMENT_API_BASE.replace(/\/$/, "")}/health`, {}, fetchImpl);
  }

  if (environment.STRIPE_WEBHOOK_ENDPOINT) {
    const response = await probeUrl(environment.STRIPE_WEBHOOK_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, fetchImpl);
    probes.webhook = response.status === 400 ? { ok: true } : { ok: false, reason: `Expected signed-webhook rejection, received ${response.status ?? "no response"}.` };
  }

  if (environment.SITE_ORIGIN) {
    probes.site = await probeUrl(environment.SITE_ORIGIN, {}, fetchImpl);
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
  await writeLaunchEvidence(root, report, outputPath);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
