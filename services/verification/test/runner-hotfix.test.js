// QA pins for the Nov 26, 2026 stranger-proof hotfix:
//   Defect 2 — a failed receipt comment must never destroy the
//     graded verdict (comment posts BEFORE check completion; its
//     failure is recorded + noted, never re-completed away), and an
//     audit failure after a finished run must not flip it either.
//   Defect 3 — the settle wait must cover check-run REGISTRATION:
//     an empty list is not "settled" until expected runs appear or
//     the registration grace window elapses.
// Every test here fails on the pre-hotfix runner.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createVerificationRunner } from "../src/runner.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

const event = {
  installationId: 555,
  owner: "octo",
  repo: "demo",
  prNumber: 7,
  headSha: HEAD,
  baseSha: BASE,
};

const BLOCKING_GATE = {
  status: "ran",
  summary: {
    policyPassed: false,
    policyVerdicts: [{ rule: "protected-paths", status: "fail" }],
    integrityVerified: true,
  },
};

function makeHarness(overrides = {}) {
  const calls = { completed: [], comments: [], audits: [], order: [], polls: 0, collectAtPoll: null };
  const client = {
    async createCheckRun() {
      return { id: 4242, html_url: "https://github.com/o/r/runs/4242" };
    },
    async getFileTextAtRef() {
      return overrides.configText ?? null;
    },
    async listCheckRuns() {
      calls.polls += 1;
      if (overrides.checkRunsScript) return overrides.checkRunsScript(calls.polls);
      return [
        { name: "Tests", status: "completed", conclusion: "success" },
        { name: "SolveLang Verification", status: "in_progress", conclusion: null },
      ];
    },
    async getPullRequest() {
      return { labels: [] };
    },
    async completeCheckRun(owner, repo, id, body) {
      calls.order.push("complete");
      calls.completed.push({ id, ...body });
      return {};
    },
    async upsertReceiptComment(owner, repo, pr, body) {
      calls.order.push("comment");
      calls.comments.push({ pr, body });
      if (overrides.commentError) throw overrides.commentError;
      return {};
    },
  };
  const deps = {
    getToken: async () => "ghs_fake",
    createClient: () => client,
    collectReceiptInput: async () => {
      calls.collectAtPoll = calls.polls;
      return {
        pr: { headSha: HEAD },
        prGate: overrides.prGate ?? {
          status: "ran",
          summary: {
            policyPassed: true,
            policyVerdicts: [{ rule: "protected-paths", status: "pass" }],
            integrityVerified: true,
          },
        },
        checkRuns: overrides.inputCheckRuns ?? [
          { name: "Tests", status: "completed", conclusion: "success" },
        ],
      };
    },
    buildReceipt: () => ({ grading: { verified: 4, failed: 1, unverified: 1 }, findings: [] }),
    renderReceiptMarkdown: () => "# Change Impact Receipt\n",
    runGate: async ({ outDir }) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "result.json"), JSON.stringify({ changedFiles: [], policy: { evaluation: { verdicts: [] } } }));
      return { exitCode: 0 };
    },
    fetchTree: async ({ destDir }) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(destDir, { recursive: true });
    },
    listChangedFiles: async () => ["src/calc.js"],
    matchGlob: () => false,
    postAudit: overrides.postAudit ?? (async (body) => {
      calls.audits.push(body);
      return { ok: true, decision: { id: "dec_1" } };
    }),
    workRoot: "/tmp/verification-qa-runs",
    settleTimeoutMs: overrides.settleTimeoutMs ?? 5000,
    settlePollMs: 1,
    settleRegistrationMs: overrides.settleRegistrationMs ?? 40,
    sleep: async () => {},
    log: () => {},
  };
  return { runner: createVerificationRunner(deps), calls };
}

test("defect 2: enforce verdict survives a 403 comment failure", async () => {
  const err = new Error("github_request_failed");
  err.name = "GitHubClientError";
  err.status = 403;
  const { runner, calls } = makeHarness({
    configText: JSON.stringify({ version: 1, mode: "enforce" }),
    prGate: BLOCKING_GATE,
    commentError: err,
  });
  const record = await runner.runVerification(event);
  // The graded verdict stands — exactly one completion, with the
  // blocking evidence, not the "run failed" erasure.
  assert.equal(record.conclusion, "failure");
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].conclusion, "failure");
  assert.doesNotMatch(calls.completed[0].title, /Verification run failed/);
  assert.match(calls.completed[0].summary, /Receipt comment not posted/);
  // The failure is recorded truthfully on the record and the audit.
  assert.equal(record.commentOk, false);
  assert.match(record.commentError, /403/);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].conclusion, "failure");
  assert.equal(calls.audits[0].commentOk, false);
});

test("defect 2: report-only verdict survives a comment failure too", async () => {
  const { runner, calls } = makeHarness({
    prGate: BLOCKING_GATE,
    commentError: new Error("github_request_failed"),
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].conclusion, "success");
  assert.equal(record.commentOk, false);
});

test("defect 2: the comment is posted BEFORE the check completes", async () => {
  const { runner, calls } = makeHarness();
  const record = await runner.runVerification(event);
  assert.equal(record.commentOk, true);
  assert.deepEqual(calls.order, ["comment", "complete"]);
});

test("defect 2: an audit failure after the verdict cannot flip the run", async () => {
  const { runner, calls } = makeHarness({
    postAudit: async () => {
      throw new Error("mgov_down");
    },
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  assert.equal(record.auditOk, false);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].conclusion, "success");
});

test("defect 3: settle waits for check runs to REGISTER, not just drain", async () => {
  const { runner, calls } = makeHarness({
    checkRunsScript: (poll) =>
      poll < 3
        ? []
        : [
            { name: "Tests", status: "completed", conclusion: "success" },
            { name: "SolveLang Verification", status: "in_progress", conclusion: null },
          ],
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  // Collection (which reads the CI evidence) must not start until a
  // poll actually saw the registered run — the old loop collected
  // after poll 1's empty list.
  assert.ok(calls.collectAtPoll >= 3, `collectAtPoll=${calls.collectAtPoll}`);
});

test("defect 3: settle awaits a requiredCheck by name even when others are done", async () => {
  const { runner, calls } = makeHarness({
    configText: JSON.stringify({ version: 1, mode: "enforce", requiredChecks: ["Tests"] }),
    checkRunsScript: (poll) =>
      poll < 2
        ? [{ name: "lint", status: "completed", conclusion: "success" }]
        : [
            { name: "lint", status: "completed", conclusion: "success" },
            { name: "Tests", status: "completed", conclusion: "success" },
          ],
  });
  const record = await runner.runVerification(event);
  assert.equal(record.conclusion, "success");
  assert.ok(calls.collectAtPoll >= 2, `collectAtPoll=${calls.collectAtPoll}`);
});

test("defect 3: a repo with no CI settles after the registration window, not instantly", async () => {
  const { runner, calls } = makeHarness({
    checkRunsScript: () => [],
    settleRegistrationMs: 80,
    settleTimeoutMs: 5000,
  });
  const started = Date.now();
  const record = await runner.runVerification(event);
  const elapsed = Date.now() - started;
  assert.equal(record.conclusion, "success");
  // Waited out the grace window (the old loop returned on poll 1)…
  assert.ok(elapsed >= 60, `elapsed=${elapsed}ms`);
  // …but did not burn the whole settle timeout.
  assert.ok(elapsed < 4000, `elapsed=${elapsed}ms`);
  assert.ok(calls.polls > 1, `polls=${calls.polls}`);
});
