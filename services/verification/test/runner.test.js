// QA pins for the verification run pipeline, driven end to end with
// fakes: report-only success, enforce failure on blocking evidence,
// the superseded-head path, and the operational-error path (check
// concludes failure, audit records "error").
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createVerificationRunner } from "../src/runner.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

function makeHarness(overrides = {}) {
  const calls = {
    completed: [],
    comments: [],
    audits: [],
    gateRuns: [],
  };
  const client = {
    async createCheckRun() {
      return { id: 4242, html_url: "https://github.com/o/r/runs/4242" };
    },
    async getFileTextAtRef() {
      return overrides.configText ?? null;
    },
    async listCheckRuns() {
      return [
        { name: "test", status: "completed", conclusion: "success" },
        { name: "SolveLang Verification", status: "in_progress", conclusion: null },
      ];
    },
    async getPullRequest() {
      return { labels: [] };
    },
    async completeCheckRun(owner, repo, id, body) {
      calls.completed.push({ id, ...body });
      return {};
    },
    async upsertReceiptComment(owner, repo, pr, body) {
      calls.comments.push({ pr, body });
      return {};
    },
  };
  const gateResultDoc = {
    changedFiles: [{ path: "src/calc.js" }],
    policy: { evaluation: { verdicts: [] } },
  };
  const input = {
    pr: { headSha: overrides.headSha ?? HEAD },
    prGate:
      overrides.prGate ??
      {
        status: "ran",
        summary: {
          policyPassed: true,
          policyVerdicts: [{ rule: "protected-paths", status: "pass" }],
          integrityVerified: true,
        },
      },
    checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    ...(overrides.inputExtra ?? {}),
  };
  const deps = {
    getToken: overrides.getToken ?? (async () => "ghs_fake"),
    createClient: () => client,
    collectReceiptInput: async () => input,
    buildReceipt: () => ({
      grading: { verified: 4, failed: 0, unverified: 1 },
      findings: [],
    }),
    renderReceiptMarkdown: () => "# Change Impact Receipt\n",
    runGate: async ({ outDir }) => {
      calls.gateRuns.push(outDir);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "result.json"), JSON.stringify(gateResultDoc));
      return { exitCode: 0 };
    },
    fetchTree: async ({ destDir }) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(destDir, { recursive: true });
    },
    listChangedFiles: async () => ["src/calc.js"],
    matchGlob: () => false,
    postAudit: async (body) => {
      calls.audits.push(body);
      return { ok: true, decision: { id: "dec_1" } };
    },
    workRoot: "/tmp/verification-qa-runs",
    settleTimeoutMs: 1000,
    settlePollMs: 1,
    sleep: async () => {},
    log: () => {},
  };
  return { runner: createVerificationRunner(deps), calls };
}

const event = {
  installationId: 555,
  owner: "octo",
  repo: "demo",
  prNumber: 7,
  headSha: HEAD,
  baseSha: BASE,
};

test("report-only clean run: check succeeds, comment posted, audit written", async () => {
  const { runner, calls } = makeHarness();
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  assert.equal(record.mode, "report-only");
  assert.equal(record.checkRunId, 4242);
  assert.equal(record.auditOk, true);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].conclusion, "success");
  assert.match(calls.completed[0].text, /Change Impact Receipt/);
  assert.equal(calls.comments.length, 1);
  assert.match(calls.comments[0].body, /solvelang-verification:report/);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].conclusion, "success");
  assert.equal(calls.audits[0].checkRunId, 4242);
  assert.deepEqual(calls.audits[0].grading, { verified: 4, failed: 0, unverified: 1 });
  assert.equal(existsSync("/tmp/verification-qa-runs/octo-demo-7-aaaaaaaaaaaa"), false);
});

test("enforce + policy failure: the check concludes failure (U2)", async () => {
  const { runner, calls } = makeHarness({
    configText: JSON.stringify({ version: 1, mode: "enforce" }),
    prGate: {
      status: "ran",
      summary: {
        policyPassed: false,
        policyVerdicts: [{ rule: "protected-paths", status: "fail" }],
        integrityVerified: true,
      },
    },
  });
  const record = await runner.runVerification(event);
  assert.equal(record.mode, "enforce");
  assert.equal(record.conclusion, "failure");
  assert.equal(calls.completed[0].conclusion, "failure");
  assert.match(record.blockedReasons.join(" "), /protected-paths/);
  assert.equal(calls.audits[0].conclusion, "failure");
});

test("report-only + same blocking evidence: check still succeeds, reasons recorded", async () => {
  const { runner, calls } = makeHarness({
    prGate: {
      status: "ran",
      summary: {
        policyPassed: false,
        policyVerdicts: [{ rule: "protected-paths", status: "fail" }],
        integrityVerified: true,
      },
    },
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  assert.equal(record.blockedReasons.length, 1);
  assert.equal(calls.completed[0].conclusion, "success");
});

test("superseded head: check completes neutral, audit records error", async () => {
  const { runner, calls } = makeHarness({ headSha: "c".repeat(40) });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "error");
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].conclusion, "neutral");
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.audits[0].conclusion, "error");
});

test("operational failure: audit records error; no comment, no false evidence", async () => {
  const { runner, calls } = makeHarness({
    getToken: async () => {
      throw new Error("token_mint_failed");
    },
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "error");
  assert.equal(record.checkRunId, null);
  assert.equal(calls.completed.length, 0);
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].conclusion, "error");
});

test("operational failure after check creation completes the check as failure", async () => {
  // A second harness whose collector throws after the check run was
  // created: the check must be completed as failure with no evidence
  // claimed, and the audit records the error.
  const harness2 = makeHarness();
  harness2.runner = createVerificationRunner({
    getToken: async () => "ghs_fake",
    createClient: () => ({
      async createCheckRun() {
        return { id: 99, html_url: "https://github.com/o/r/runs/99" };
      },
      async getFileTextAtRef() {
        return null;
      },
      async listCheckRuns() {
        return [];
      },
      async getPullRequest() {
        return { labels: [] };
      },
      async completeCheckRun(owner, repo, id, body) {
        harness2.calls.completed.push({ id, ...body });
        return {};
      },
      async upsertReceiptComment() {
        return {};
      },
    }),
    collectReceiptInput: async () => {
      throw new Error("collector_down");
    },
    buildReceipt: () => ({ grading: { verified: 0, failed: 0, unverified: 0 }, findings: [] }),
    renderReceiptMarkdown: () => "",
    runGate: async () => ({ exitCode: 2 }),
    fetchTree: async () => {},
    listChangedFiles: async () => [],
    matchGlob: () => false,
    postAudit: async (body) => {
      harness2.calls.audits.push(body);
      return { ok: true };
    },
    workRoot: "/tmp/verification-qa-runs",
    settleTimeoutMs: 10,
    settlePollMs: 1,
    sleep: async () => {},
    log: () => {},
  });
  const record = await harness2.runner.runVerification(event);
  assert.equal(record.conclusion, "error");
  assert.equal(harness2.calls.completed.length, 1);
  assert.equal(harness2.calls.completed[0].conclusion, "failure");
  assert.match(harness2.calls.completed[0].summary, /No graded evidence is claimed/);
  assert.equal(harness2.calls.audits[0].conclusion, "error");
});
