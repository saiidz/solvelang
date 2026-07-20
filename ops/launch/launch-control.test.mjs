import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLaunch, renderMarkdown } from "./launch-control.mjs";

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
  },
};

const validEnvironment = {
  AWS_REGION: "us-east-1",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/launch",
  ENTITLEMENT_STACK_NAME: "solvelang-entitlements-test",
  SITE_ORIGIN: "https://www.solve-lang.com",
  STRIPE_SECRET_KEY: "sk_test_secret-never-print",
  STRIPE_WEBHOOK_SECRET: "whsec_secret-never-print",
  STRIPE_PRICE_ID: "price_test_123",
  STRIPE_WEBHOOK_ENDPOINT: "https://api.example.test/webhook",
  ENTITLEMENT_SIGNING_SECRET: "signing-secret-never-print-1234567890",
  NEXT_PUBLIC_ENTITLEMENT_API_BASE: "https://api.example.test",
  NPM_SCOPE_OWNERSHIP_VERIFIED: "true",
  NPM_PRODUCTION_ENVIRONMENT_PROTECTED: "true",
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
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.summary, { pass: report.controls.length, fail: 0, blocked: 0 });
  assert.ok(report.controls.every((control) => control.status === "pass"));
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
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, false);
  const release = report.controls.find((control) => control.id === "mcp-release-consistency");
  assert.equal(release?.status, "fail");
  assert.match(release?.detail ?? "", /version mismatch/i);
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
      entitlement: { healthRoute: false, privacySafe: false, testModeE2eHarness: false },
    },
    probes: {
      entitlementHealth: { ok: true, mode: "test" },
      site: { ok: true },
      webhook: { ok: true },
      aws: { ok: true },
      stripe: { ok: true, mode: "test" },
    },
    now: "2026-07-19T18:00:00.000Z",
  });

  assert.equal(report.ready, false);
  for (const id of ["entitlement-health-contract", "workflow-data-privacy", "stripe-test-e2e-harness"]) {
    assert.equal(report.controls.find((item) => item.id === id)?.status, "fail");
  }
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
