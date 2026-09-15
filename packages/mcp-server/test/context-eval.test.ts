import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("offline Solve Context eval suite preserves evidence and reports measured byte reduction truthfully", async () => {
  const packageRoot = path.resolve(import.meta.dirname, "../..");
  const { stdout, stderr } = await execFileAsync(process.execPath, ["scripts/run-context-evals.mjs"], {
    cwd: packageRoot,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(stderr, "");
  const report = JSON.parse(stdout);

  assert.equal(report.schema, "solvelang.context.eval-report.v0");
  assert.equal(report.aggregate.pass, true);
  assert.equal(report.aggregate.allCasesPass, true);
  assert.equal(report.aggregate.caseCount, 6);
  assert.deepEqual(
    report.cases.map((result: { category: string }) => result.category).sort(),
    [
      "bug-fix",
      "ci-log-diagnosis",
      "cross-agent-handoff",
      "github-issue-triage",
      "json-heavy-tool-output",
      "multi-file-refactor",
    ],
  );
  assert.equal(report.aggregate.minPathRecall, 1);
  assert.equal(report.aggregate.minPathPrecision, 1);
  assert.equal(report.aggregate.minEvidenceRecall, 1);
  assert.ok(report.aggregate.meanByteReductionPercent >= 70);
  assert.equal(report.aggregate.handoffPass, true);

  assert.equal(report.truth.byteReductionIsNotTokenSavings, true);
  assert.equal(report.truth.providerTokensMeasured, false);
  assert.equal(report.truth.endToEndAgentTaskSuccessMeasured, false);
  assert.equal(report.truth.externalCompetitorMeasured, false);

  for (const result of report.cases) {
    assert.equal(result.pass, true, `${result.id} must pass the offline quality gates`);
    assert.equal(result.deterministic, true, `${result.id} must be deterministic`);
    assert.equal(result.exactIntegrity, true, `${result.id} must preserve exact source identities`);
    assert.equal(result.pathRecall, 1, `${result.id} must include every required path`);
    assert.equal(result.pathPrecision, 1, `${result.id} must avoid non-required paths`);
    assert.equal(result.evidenceRecall, 1, `${result.id} must preserve every required evidence needle`);
    assert.deepEqual(result.missingRequiredPaths, []);
    assert.deepEqual(result.forbiddenSelectedPaths, []);
    assert.deepEqual(result.missingEvidence, []);
  }

  assert.equal(report.handoff.sourceBodyFree, true);
  assert.equal(report.handoff.freshValid, true);
  assert.equal(report.handoff.staleDetected, true);
  assert.equal(report.handoff.integrityRetainedAfterWorkspaceChange, true);
  assert.equal(report.handoff.staleChangedPathDetected, true);
  assert.equal(report.handoff.staleContextDetected, true);
});
