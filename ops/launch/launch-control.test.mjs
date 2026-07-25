import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { collectRepositoryState, evaluateLaunch, renderMarkdown, selectReleaseTag, writeLaunchEvidence } from "./launch-control.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const repository = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  clean: true,
  mcpPackageVersion: "0.1.0",
  mcpLockVersion: "0.1.0",
  releaseTag: "v0.1.0",
  npmVersion: "0.1.0",
  workflow: {
    oidc: true,
    protectedEnvironment: true,
    tagValidation: true,
    tests: true,
    packedInstall: true,
    publicPublish: true,
    tokenSecret: false,
  },
  entitlement: {
    healthRoute: true,
    privacySafe: true,
    testModeE2eHarness: true,
    refundAware: true,
    checkoutGate: true,
  },
};

const validEnvironment = {
  ENTITLEMENT_MODE: "test",
  AWS_REGION: "us-east-1",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/launch",
  ENTITLEMENT_STACK_NAME: "solvelang-entitlements-test",
  SITE_ORIGIN: "https://www.solve-lang.com",
  STRIPE_SECRET_KEY: "sk_test_secret-never-print",
  STRIPE_WEBHOOK_SECRET: "whsec_secret-never-print",
  STRIPE_WEBHOOK_ENDPOINT: "https://api.example.test/webhook",
  ENTITLEMENT_SIGNING_SECRET: "signing-secret-never-print-1234567890",
  NEXT_PUBLIC_ENTITLEMENT_API_BASE: "https://api.example.test",
  NPM_SCOPE_OWNERSHIP_VERIFIED: "true",
  NPM_PRODUCTION_ENVIRONMENT_PROTECTED: "true",
  CHECKOUT_ENABLED: "true",
  WEBHOOK_SIGNED_DELIVERY_VERIFIED: "true",
};

test("missing launch prerequisites fail closed using names only", () => {
  const report = evaluateLaunch({
    environment: { STRIPE_SECRET_KEY: "sk_test_secret-never-print" },
    repository,
    probes: {},
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, false);
  assert.ok(report.summary.blocked > 0);
  assert.match(JSON.stringify(report), /STRIPE_WEBHOOK_SECRET/);
  assert.doesNotMatch(JSON.stringify(report), /secret-never-print/);
});

test("a complete test-mode launch passes every control", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository,
    probes: {
      entitlementHealth: { ok: true, mode: "test" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "test" },
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementTestEnvironment: true },
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.summary, { pass: report.controls.length, fail: 0, blocked: 0 });
  assert.ok(report.controls.every((control) => control.status === "pass"));
});

test("a complete production launch requires live keys and the protected production environment", () => {
  const report = evaluateLaunch({
    environment: {
      ...validEnvironment,
      ENTITLEMENT_MODE: "production",
      STRIPE_SECRET_KEY: "sk_live_secret-never-print",
      ENTITLEMENT_STACK_NAME: "solvelang-entitlements-production",
    },
    repository,
    probes: {
      entitlementHealth: { ok: true, mode: "production" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "production" },
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementProductionEnvironment: true },
    },
    now: "2026-07-22T00:00:00.000Z",
  });

  assert.equal(report.ready, true);
  assert.equal(report.controls.find((control) => control.id === "stripe-mode")?.status, "pass");
});

test("production launch rejects test keys without exposing their values", () => {
  const report = evaluateLaunch({
    environment: { ...validEnvironment, ENTITLEMENT_MODE: "production" },
    repository,
    probes: {},
    now: "2026-07-22T00:00:00.000Z",
  });
  const stripeMode = report.controls.find((control) => control.id === "stripe-mode");
  assert.equal(stripeMode?.status, "fail");
  assert.doesNotMatch(JSON.stringify(report), /secret-never-print/);
});

test("production checkout cannot be enabled before signed webhook verification is confirmed", () => {
  const report = evaluateLaunch({
    environment: {
      ...validEnvironment,
      ENTITLEMENT_MODE: "production",
      STRIPE_SECRET_KEY: "sk_live_secret-never-print",
      ENTITLEMENT_STACK_NAME: "solvelang-entitlements-production",
      WEBHOOK_SIGNED_DELIVERY_VERIFIED: "false",
    },
    repository,
    probes: {},
    now: "2026-07-22T00:00:00.000Z",
  });

  assert.equal(report.controls.find((control) => control.id === "production-checkout-enablement")?.status, "blocked");
});

test("package, lock, release tag, and npm drift is a hard failure", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository: { ...repository, mcpLockVersion: "0.2.0", npmVersion: "0.0.9" },
    probes: {
      entitlementHealth: { ok: true, mode: "test" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "test" },
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementTestEnvironment: true },
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, false);
  const release = report.controls.find((control) => control.id === "mcp-release-consistency");
  assert.equal(release?.status, "fail");
  assert.match(release?.detail ?? "", /version mismatch/i);
});

test("release consistency selects the manifest version tag even after later commits", () => {
  assert.equal(selectReleaseTag("0.2.0", "v0.1.0\nv0.2.0\nv0.3.0-beta.1"), "v0.2.0");
  assert.equal(selectReleaseTag("0.2.1", "v0.1.0\nv0.2.0"), "");
});

test("release workflow must use OIDC and retain every guarded publish step", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository: { ...repository, workflow: { ...repository.workflow, tokenSecret: true, packedInstall: false } },
    probes: {
      entitlementHealth: { ok: true, mode: "test" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "test" },
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementTestEnvironment: true },
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  const workflow = report.controls.find((control) => control.id === "npm-trusted-publishing");
  assert.equal(workflow?.status, "fail");
});

test("missing health, privacy, and Stripe E2E safeguards are hard failures", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository: {
      ...repository,
      entitlement: { healthRoute: false, privacySafe: false, testModeE2eHarness: false, refundAware: false },
    },
    probes: {
      entitlementHealth: { ok: true, mode: "test" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "test" },
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementTestEnvironment: true },
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, false);
  for (const id of ["entitlement-health-contract", "workflow-data-privacy", "stripe-test-e2e-harness", "refund-revocation"]) {
    assert.equal(report.controls.find((item) => item.id === id)?.status, "fail");
  }
});

test("current repository proves all entitlement code gates with implementation and regression contracts", async () => {
  const state = await collectRepositoryState(repositoryRoot, { npmVersion: "0.2.0" });
  assert.deepEqual(state.entitlement, {
    healthRoute: true,
    privacySafe: true,
    testModeE2eHarness: true,
    refundAware: true,
    checkoutGate: true,
  });
  assert.equal(state.workflow.packedInstall, true);
  assert.equal(state.workflow.tagValidation, true);
});

test("launch control collects the public MCP npm version without credentials", async () => {
  const module = await import("./launch-control.mjs");
  const collectPublicNpmVersion = module.collectPublicNpmVersion ?? (async () => undefined);
  const version = await collectPublicNpmVersion(async (url) => {
    assert.equal(url, "https://registry.npmjs.org/%40solvelang%2Fmcp-server/latest");
    return new Response(JSON.stringify({ version: "0.2.0" }), { status: 200 });
  });

  assert.equal(version, "0.2.0");
});

test("launch control collects safe GitHub environment metadata and fails closed without authentication", async () => {
  const module = await import("./launch-control.mjs");
  const collectGitHubMetadata = module.collectGitHubMetadata ?? (() => ({ ok: false, reason: "missing" }));
  const calls = [];
  const metadata = collectGitHubMetadata({
    repository: "saiidz/solvelang",
    runCommand(command, args) {
      calls.push([command, args]);
      if (args[0] === "auth") return { ok: true };
      if (args.at(-1)?.endsWith("NPM_SCOPE_OWNERSHIP_VERIFIED")) return { ok: true, stdout: JSON.stringify({ value: "true" }) };
      return { ok: true, stdout: JSON.stringify({ protection_rules: [{ type: "required_reviewers" }] }) };
    },
  });
  assert.deepEqual(metadata, {
    ok: true,
    entitlementTestEnvironment: true,
    entitlementProductionEnvironment: true,
    npmProductionEnvironment: true,
    npmProductionProtected: true,
    npmScopeOwnershipVerified: true,
  });
  assert.equal(calls.length, 5);
  assert.deepEqual(
    collectGitHubMetadata({ repository: "saiidz/solvelang", runCommand: () => ({ ok: false }) }),
    { ok: false, reason: "Authenticated GitHub CLI access is unavailable." },
  );
});

test("production runbook preserves the disabled checkout bootstrap sequence", async () => {
  const runbook = await readFile(path.join(repositoryRoot, "docs/launch-owner-runbook.md"), "utf8");
  const requiredSteps = [
    "`CHECKOUT_ENABLED` to `false`",
    "first production deployment with checkout disabled",
    "Capture the non-secret `WebhookUrl`",
    "`payment_intent.succeeded`",
    "`charge.refunded`",
    "Replace the bootstrap value",
    "checkout still disabled",
    "Stripe-signed event returns HTTP 200",
    "`WEBHOOK_SIGNED_DELIVERY_VERIFIED=true`",
    "`CHECKOUT_ENABLED=true`",
    "third production deployment",
    "only then point or activate the live frontend",
  ];

  let previousIndex = -1;
  for (const step of requiredSteps) {
    const index = runbook.indexOf(step, previousIndex + 1);
    assert.ok(index > previousIndex, `missing or out-of-order production bootstrap step: ${step}`);
    previousIndex = index;
  }
});

test("SAM rejects production checkout enablement without signed-webhook verification", async () => {
  const template = await readFile(path.join(repositoryRoot, "services/entitlements/template.yaml"), "utf8");
  assert.match(template, /WebhookSignedDeliveryVerified:/);
  assert.match(template, /ProductionCheckoutRequiresVerifiedWebhook:/);
  assert.match(template, /!Equals \[!Ref CheckoutEnabled, "false"\]/);
  assert.match(template, /!Equals \[!Ref WebhookSignedDeliveryVerified, "true"\]/);
});

test("GitHub metadata satisfies npm gates and reports a missing entitlement test environment", () => {
  const environment = { ...validEnvironment };
  delete environment.NPM_SCOPE_OWNERSHIP_VERIFIED;
  delete environment.NPM_PRODUCTION_ENVIRONMENT_PROTECTED;
  const report = evaluateLaunch({
    environment,
    repository,
    probes: {
      github: { ok: true, npmProductionEnvironment: true, npmProductionProtected: true, npmScopeOwnershipVerified: true, entitlementTestEnvironment: false },
    },
    now: "2026-07-19T18:00:00.000Z",
  });
  assert.equal(report.controls.find((item) => item.id === "npm-configuration")?.status, "pass");
  const entitlementEnvironment = report.controls.find((item) => item.id === "github-entitlement-environment");
  assert.equal(entitlementEnvironment?.status, "blocked");
  assert.match(entitlementEnvironment?.ownerAction ?? "", /entitlement-test/);
});

test("authenticated GitHub metadata cannot be bypassed when npm-production is missing", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository,
    probes: {
      github: {
        ok: true,
        npmProductionEnvironment: false,
        npmProductionProtected: false,
        npmScopeOwnershipVerified: false,
        entitlementTestEnvironment: true,
      },
    },
    now: "2026-07-24T00:00:00.000Z",
  });

  assert.equal(report.controls.find((item) => item.id === "npm-configuration")?.status, "blocked");
});

test("JSON and Markdown evidence contain provenance but never environment values", () => {
  const report = evaluateLaunch({
    environment: validEnvironment,
    repository,
    probes: {
      entitlementHealth: { ok: false, reason: "health endpoint unavailable" },
      site: { ok: true },
      webhook: { ok: false, reason: "owner verification required" },
      aws: { ok: false, reason: "owner verification required" },
      stripe: { ok: false, reason: "owner verification required" },
    },
    now: "2026-07-19T18:00:00.000Z",
  });
  const markdown = renderMarkdown(report);
  const combined = `${JSON.stringify(report)}\n${markdown}`;
  assert.match(combined, /0123456789abcdef/);
  assert.match(combined, /2026-07-19T18:00:00.000Z/);
  assert.match(markdown, /Unresolved blockers/);
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ENTITLEMENT_SIGNING_SECRET", "AWS_ROLE_ARN"]) {
    const value = validEnvironment[name];
    assert.doesNotMatch(combined, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("launch evidence writes deterministic JSON and Markdown artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "solvelang-launch-evidence-"));
  try {
    const report = evaluateLaunch({ environment: validEnvironment, repository, probes: {}, now: "2026-07-22T00:00:00.000Z" });
    const paths = await writeLaunchEvidence(root, report);
    assert.deepEqual(paths.map((value) => path.relative(root, value)), [
      "artifacts/launch-readiness/launch-readiness.json",
      "artifacts/launch-readiness/launch-readiness.md",
    ]);
    assert.deepEqual(JSON.parse(await readFile(paths[0], "utf8")), report);
    assert.equal(await readFile(paths[1], "utf8"), renderMarkdown(report));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
