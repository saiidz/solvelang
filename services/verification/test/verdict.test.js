// QA pins for the verification service's pure layers: config parsing
// (U3), the blocking rules (U2), annotations (U1), the check summary,
// webhook signature verification, and the app-auth JWT/credential
// exchange.
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  createAppAuth,
  createAppJwt,
  exchangeManifestCode,
  GitHubAppAuthError,
  normalizePrivateKey,
  verifyWebhookSignature,
} from "../src/app-auth.js";
import {
  computeAnnotations,
  computeBlocking,
  composeCheckSummary,
  isTestPath,
  parseVerificationConfig,
} from "../src/verdict.js";

const OWN = "SolveLang Verification";

// --- config ---

test("config: absent file yields defaults, not invalid", () => {
  const { config, invalid, present } = parseVerificationConfig(null);
  assert.equal(invalid, false);
  assert.equal(present, false);
  assert.deepEqual(config, {
    version: 1,
    mode: "report-only",
    requiredChecks: [],
    ignorePaths: [],
  });
});

test("config: a full valid config parses", () => {
  const { config, invalid } = parseVerificationConfig(
    JSON.stringify({
      version: 1,
      mode: "enforce",
      requiredChecks: ["test"],
      ignorePaths: ["docs/**"],
    })
  );
  assert.equal(invalid, false);
  assert.equal(config.mode, "enforce");
  assert.deepEqual(config.requiredChecks, ["test"]);
  assert.deepEqual(config.ignorePaths, ["docs/**"]);
});

test("config: any defect yields defaults + invalid", () => {
  for (const text of [
    "{not json",
    JSON.stringify({ version: 2, mode: "enforce" }),
    JSON.stringify({ version: 1, mode: "strict" }),
    JSON.stringify({ version: 1, requiredChecks: ["ok", 7] }),
    JSON.stringify({ version: 1, ignorePaths: "docs/**" }),
    JSON.stringify(["version", 1]),
  ]) {
    const { config, invalid } = parseVerificationConfig(text);
    assert.equal(invalid, true, text);
    assert.equal(config.mode, "report-only", text);
  }
});

// --- test-path classifier (mirrors the receipt builder) ---

test("isTestPath matches the receipt builder's classifier on samples", () => {
  assert.equal(isTestPath("src/foo.test.ts"), true);
  assert.equal(isTestPath("test/foo.js"), true);
  assert.equal(isTestPath("tests/unit/foo.py"), true);
  assert.equal(isTestPath("pkg/__tests__/x.js"), true);
  assert.equal(isTestPath("src/foo.spec.rb"), true);
  assert.equal(isTestPath("src/foo.ts"), false);
  assert.equal(isTestPath("src/contest.ts"), false);
  assert.equal(isTestPath("docs/guide.md"), false);
});

// --- blocking rules ---

const ranGate = (overrides = {}) => ({
  status: "ran",
  summary: {
    policyPassed: true,
    policyVerdicts: [{ rule: "protected-paths", status: "pass" }],
    integrityVerified: true,
    ...overrides,
  },
});

test("blocking: a policy FAIL blocks and names the rule", () => {
  const { blocked, reasons } = computeBlocking({
    gateRoute: ranGate({
      policyPassed: false,
      policyVerdicts: [{ rule: "protected-paths", status: "fail" }],
    }),
    checkRuns: [],
    requiredChecks: [],
    ownCheckName: OWN,
  });
  assert.equal(blocked, true);
  assert.match(reasons.join(" "), /PR Gate policy failed: protected-paths/);
});

test("blocking: an overridden verdict does not block", () => {
  const { blocked } = computeBlocking({
    gateRoute: ranGate({
      policyPassed: true,
      policyVerdicts: [{ rule: "protected-paths", status: "overridden" }],
    }),
    checkRuns: [],
    requiredChecks: [],
    ownCheckName: OWN,
  });
  assert.equal(blocked, false);
});

test("blocking: failed or missing gate route blocks; broken graph integrity blocks", () => {
  assert.equal(
    computeBlocking({ gateRoute: { status: "failed" }, checkRuns: [], requiredChecks: [], ownCheckName: OWN }).blocked,
    true
  );
  assert.equal(
    computeBlocking({ gateRoute: { status: "not-run" }, checkRuns: [], requiredChecks: [], ownCheckName: OWN }).blocked,
    true
  );
  assert.equal(
    computeBlocking({ gateRoute: ranGate({ integrityVerified: false }), checkRuns: [], requiredChecks: [], ownCheckName: OWN }).blocked,
    true
  );
});

test("blocking: failing head CI blocks; our own check never counts as evidence", () => {
  const { blocked, reasons } = computeBlocking({
    gateRoute: ranGate(),
    checkRuns: [
      { name: "test", status: "completed", conclusion: "failure" },
      { name: OWN, status: "in_progress", conclusion: null },
    ],
    requiredChecks: [],
    ownCheckName: OWN,
  });
  assert.equal(blocked, true);
  assert.match(reasons.join(" "), /test \(failure\)/);
});

test("blocking: required checks must be present, completed, successful", () => {
  const base = { gateRoute: ranGate(), ownCheckName: OWN, requiredChecks: ["build"] };
  assert.equal(computeBlocking({ ...base, checkRuns: [] }).blocked, true);
  assert.equal(
    computeBlocking({ ...base, checkRuns: [{ name: "build", status: "in_progress", conclusion: null }] }).blocked,
    true
  );
  assert.equal(
    computeBlocking({ ...base, checkRuns: [{ name: "build", status: "completed", conclusion: "failure" }] }).blocked,
    true
  );
  assert.equal(
    computeBlocking({ ...base, checkRuns: [{ name: "build", status: "completed", conclusion: "success" }] }).blocked,
    false
  );
});

test("blocking: a clean run does not block", () => {
  const { blocked, reasons } = computeBlocking({
    gateRoute: ranGate(),
    checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    requiredChecks: [],
    ownCheckName: OWN,
  });
  assert.equal(blocked, false);
  assert.deepEqual(reasons, []);
});

// --- annotations ---

test("annotations: protected-path failures land on the offending files", () => {
  const annotations = computeAnnotations({
    receipt: { findings: [] },
    gateResult: {
      changedFiles: [{ path: "src/core/calc.js" }],
      policy: {
        evaluation: {
          verdicts: [
            {
              rule: "protected-paths",
              status: "fail",
              detail: "Changed protected path(s): src/core/calc.js.",
            },
          ],
        },
      },
    },
  });
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].path, "src/core/calc.js");
  assert.equal(annotations[0].annotation_level, "failure");
});

test("annotations: the no-tests finding warns on changed non-test files only", () => {
  const annotations = computeAnnotations({
    receipt: {
      findings: [
        {
          label: "verified",
          text: "No tests in the diff: 2 changed file(s), 0 test file(s).",
        },
      ],
    },
    gateResult: {
      changedFiles: [{ path: "src/a.js" }, { path: "src/a.test.js" }],
      policy: { evaluation: { verdicts: [] } },
    },
  });
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].path, "src/a.js");
  assert.equal(annotations[0].annotation_level, "warning");
});

test("annotations: failures sort before warnings and the total caps at 50", () => {
  const files = Array.from({ length: 60 }, (_, i) => `src/f${i}.js`);
  const annotations = computeAnnotations({
    receipt: {
      findings: [
        { label: "verified", text: "No tests in the diff: 60 changed file(s), 0 test file(s)." },
      ],
    },
    gateResult: {
      changedFiles: files.map((path) => ({ path })),
      policy: {
        evaluation: {
          verdicts: [
            {
              rule: "protected-paths",
              status: "fail",
              detail: `Changed protected path(s): ${files[0]}.`,
            },
          ],
        },
      },
    },
  });
  assert.equal(annotations.length, 50);
  assert.equal(annotations[0].annotation_level, "failure");
});

// --- summary ---

test("summary: enforce + blocked reads as a failure; report-only says so", () => {
  const grading = { verified: 3, failed: 1, unverified: 2 };
  const enforce = composeCheckSummary({
    mode: "enforce",
    blocked: true,
    reasons: ["PR Gate policy failed: protected-paths."],
    grading,
    configInvalid: false,
    ignoredCount: 0,
    durationMs: 4200,
  });
  assert.match(enforce.title, /Verification failed/);
  assert.match(enforce.summary, /3 verified · 1 failed · 2 unverified/);
  assert.match(enforce.summary, /falseVerifiedLabel: false/);
  const reportOnly = composeCheckSummary({
    mode: "report-only",
    blocked: true,
    reasons: ["x"],
    grading,
    configInvalid: true,
    ignoredCount: 2,
    durationMs: 1000,
  });
  assert.match(reportOnly.title, /report-only/);
  assert.match(reportOnly.summary, /does not block merging/);
  assert.match(reportOnly.summary, /invalid/);
  assert.match(reportOnly.summary, /2 changed file\(s\) were excluded/);
});

// --- webhook signature ---

test("webhook signature: valid passes, tampered and malformed fail", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ action: "opened" });
  // Build the expected signature the same way GitHub does.
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(secret, body, good), true);
  assert.equal(verifyWebhookSignature(secret, body + " ", good), false);
  assert.equal(verifyWebhookSignature(secret, body, "sha1=abc"), false);
  assert.equal(verifyWebhookSignature(secret, body, ""), false);
  assert.equal(verifyWebhookSignature("", body, good), false);
});

// --- app auth ---

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

test("app JWT: RS256, iss is the app id, iat backdated 60s, exp +540s", () => {
  const jwt = createAppJwt({ appId: 12345, privateKey: pem, now: 1_700_000_000_000 });
  const [header, payload] = jwt.split(".").slice(0, 2).map((part) =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
  );
  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, 1_700_000_000 - 60);
  assert.equal(payload.exp - payload.iat, 600);
});

test("normalizePrivateKey accepts raw, escaped, and base64 forms", () => {
  // The normalizer is deliberately lenient (it mirrors the governance
  // ingress): it unwraps base64 and escaped-newline forms and passes
  // anything else through untouched for the signer to reject.
  assert.equal(normalizePrivateKey(pem), pem);
  assert.equal(normalizePrivateKey(pem.replace(/\n/g, "\\n")), pem);
  assert.equal(normalizePrivateKey(Buffer.from(pem).toString("base64")), pem);
  assert.equal(normalizePrivateKey("not a key"), "not a key");
});

test("installation token: fetched once, cached inside the margin", async () => {
  let calls = 0;
  const auth = createAppAuth({
    appId: 999,
    privateKeyPem: pem,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          token: "ghs_test",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    },
  });
  assert.equal(await auth.getInstallationToken(42), "ghs_test");
  assert.equal(await auth.getInstallationToken(42), "ghs_test");
  assert.equal(calls, 1);
});

test("manifest exchange: returns the sealed credential shape", async () => {
  const credentials = await exchangeManifestCode("code-123", async (url, init) => {
    assert.match(url, /\/app-manifests\/code-123\/conversions$/);
    assert.equal(init.method, "POST");
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: 777,
        slug: "solvelang-verification",
        name: "SolveLang Verification",
        pem,
        webhook_secret: "whsec",
        client_id: "Iv1.x",
        client_secret: "sekret",
        html_url: "https://github.com/apps/solvelang-verification",
      }),
    };
  });
  assert.equal(credentials.id, 777);
  assert.equal(credentials.slug, "solvelang-verification");
  assert.equal(credentials.webhookSecret, "whsec");
  await assert.rejects(
    () =>
      exchangeManifestCode("code-123", async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })),
    GitHubAppAuthError
  );
});
