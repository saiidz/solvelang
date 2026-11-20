// SolveLang PR Gate — tests.
//
// The end-to-end tests build a real fixture repository on disk (a leaf
// module imported through a chain, a test file at the end of the chain, a
// protected directory, a workflow file) and run the real engines against
// it. The fixture's impact set is known by construction:
//   leaf.ts <- mid.ts <- top.ts <- top.test.ts
// so changing leaf.ts must impact exactly mid, top, and top.test, and the
// test file must surface as the affected validation.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runPrGate } from "../src/cli";
import { evaluatePolicy, matchGlob, parsePolicy } from "../src/policy";
import { REPORT_MARKER } from "../src/report";

let fixtureRoot = "";
let workRoot = "";
let policyPath = "";

const FIXTURE_POLICY = {
  version: 1,
  overrideLabel: "pr-gate:override",
  protectedPaths: [{ glob: "protected/**" }],
  maxImpactNodes: 50,
  requireAffectedValidations: true,
};

function writeFixtureFile(relative: string, content: string): void {
  const absolute = path.join(fixtureRoot, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

before(() => {
  workRoot = mkdtempSync(path.join(tmpdir(), "pr-gate-test-"));
  fixtureRoot = path.join(workRoot, "repo");
  mkdirSync(fixtureRoot, { recursive: true });
  writeFixtureFile("package.json", "{\"name\":\"fixture\",\"private\":true}\n");
  writeFixtureFile("src/leaf.ts", "export const leaf = 1;\n");
  writeFixtureFile("src/mid.ts", "import { leaf } from \"./leaf\";\nexport const mid = leaf + 1;\n");
  writeFixtureFile("src/top.ts", "import { mid } from \"./mid\";\nexport const top = mid + 1;\n");
  writeFixtureFile("src/top.test.ts", "import { top } from \"./top\";\nif (top !== 3) { throw new Error(\"bad top\"); }\n");
  writeFixtureFile("protected/config.ts", "export const configValue = \"protected\";\n");
  writeFixtureFile(".github/workflows/ci.yml", "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: fixtureRoot, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "pr-gate-tests@example.com"]);
  git(["config", "user.name", "PR Gate Tests"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  policyPath = path.join(workRoot, "policy.json");
  writeFileSync(policyPath, JSON.stringify(FIXTURE_POLICY), "utf8");
});

after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function outDir(name: string): string {
  return path.join(workRoot, `out-${name}`);
}

test("matchGlob supports **, *, and ? with segment semantics", () => {
  assert.equal(matchGlob("protected/**", "protected/config.ts"), true);
  assert.equal(matchGlob("protected/**", "protected/deep/nested/file.ts"), true);
  assert.equal(matchGlob("protected/**", "src/protected.ts"), false);
  assert.equal(matchGlob(".github/workflows/**", ".github/workflows/ci.yml"), true);
  assert.equal(matchGlob("src/*.ts", "src/leaf.ts"), true);
  assert.equal(matchGlob("src/*.ts", "src/deep/leaf.ts"), false);
  assert.equal(matchGlob("**/*.test.ts", "src/top.test.ts"), true);
  assert.equal(matchGlob("src/leaf.t?", "src/leaf.ts"), true);
  assert.equal(matchGlob("src/leaf.ts", "src/leaf.ts"), true);
  assert.equal(matchGlob("src/leaf.ts", "src/mid.ts"), false);
});

test("parsePolicy validates the versioned format", () => {
  assert.deepEqual(parsePolicy("{\"version\":1}"), { version: 1 });
  assert.throws(() => parsePolicy("{\"version\":2}"), /version must be 1/);
  assert.throws(() => parsePolicy("{\"version\":1,\"bogus\":true}"), /unknown key "bogus"/);
  assert.throws(() => parsePolicy("{\"version\":1,\"protectedPaths\":[{\"glob\":\"\"}]}"), /glob must be a non-empty string/);
  assert.throws(() => parsePolicy("not json"), /not valid JSON/);
  assert.throws(() => parsePolicy("{\"version\":1,\"maxImpactNodes\":-1}"), /non-negative integer/);
});

test("evaluatePolicy: per-entry override label beats the global one, ceiling override works", () => {
  const policy = parsePolicy(JSON.stringify({
    version: 1,
    overrideLabel: "global:override",
    protectedPaths: [{ glob: "a/**", overrideLabel: "a:override" }],
    maxImpactNodes: 1,
  }));
  const base = { changedPaths: ["a/x.ts"], impactNodeCount: 5, affectedValidationPaths: [], labels: [] as string[] };
  const failing = evaluatePolicy(policy, base);
  assert.equal(failing.passed, false);
  assert.deepEqual(failing.verdicts.map((v) => v.status), ["fail", "fail", "skipped"]);
  const overridden = evaluatePolicy(policy, { ...base, labels: ["a:override", "global:override"] });
  assert.equal(overridden.passed, true);
  assert.deepEqual(overridden.verdicts.map((v) => v.status), ["overridden", "overridden", "skipped"]);
  const partial = evaluatePolicy(policy, { ...base, labels: ["a:override"] });
  assert.equal(partial.passed, false);
  assert.deepEqual(partial.verdicts.map((v) => v.status), ["overridden", "fail", "skipped"]);
});

test("end-to-end: a leaf change reports the known blast radius and a full pack", async () => {
  const { exitCode, result } = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts"],
    mode: "enforce",
    outDir: outDir("leaf"),
  });
  assert.equal(exitCode, 0);
  assert.equal(result.schema, "solvelang.pr-gate.result.v1");
  assert.equal(result.graph.integrityVerified, true);
  assert.equal(result.graph.executionStatus, "complete");
  assert.deepEqual(result.changedFiles, [{ path: "src/leaf.ts", mappedToGraphNode: true }]);
  assert.equal(result.impact.impactedNodes, 3);
  const rowsByLabel = new Map(result.impact.rows.map((row) => [row.label, row]));
  assert.equal(rowsByLabel.get("mid.ts")?.depth, 1);
  assert.equal(rowsByLabel.get("top.ts")?.depth, 2);
  assert.equal(rowsByLabel.get("top.test.ts")?.depth, 3);
  assert.ok(result.pack, "pack must be generated");
  const packPaths = result.pack.files.map((file) => file.path).sort();
  assert.deepEqual(packPaths, ["src/leaf.ts", "src/mid.ts", "src/top.test.ts", "src/top.ts"]);
  assert.ok(result.pack.packId.length > 0);
  for (const file of result.pack.files) assert.match(file.sourceSha256, /^[a-f0-9]{64}$/);
  const report = readFileSync(path.join(outDir("leaf"), "report.md"), "utf8");
  assert.ok(report.startsWith(REPORT_MARKER));
  assert.ok(report.includes("Blast radius (Solve Graph impact)"));
  assert.ok(existsSync(path.join(outDir("leaf"), "pack.json")));
  assert.ok(existsSync(path.join(outDir("leaf"), "result.json")));
});

test("end-to-end: affected-validations rule fails an untouched test, passes when touched", async () => {
  const failing = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts"],
    mode: "enforce",
    policyPath,
    outDir: outDir("validations-fail"),
  });
  assert.equal(failing.exitCode, 1);
  assert.deepEqual(failing.result.affectedValidations.paths, ["src/top.test.ts"]);
  assert.deepEqual(failing.result.affectedValidations.touchedPaths, []);
  const verdict = failing.result.policy.evaluation.verdicts.find((v) => v.rule === "affected-validations");
  assert.equal(verdict?.status, "fail");

  const reportOnly = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts"],
    mode: "report-only",
    policyPath,
    outDir: outDir("validations-report-only"),
  });
  assert.equal(reportOnly.exitCode, 0, "report-only mode never fails the run");
  assert.equal(reportOnly.result.policy.evaluation.passed, false, "but the verdict is still recorded honestly");

  const passing = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts", "src/top.test.ts"],
    mode: "enforce",
    policyPath,
    outDir: outDir("validations-pass"),
  });
  assert.equal(passing.exitCode, 0);
  assert.deepEqual(passing.result.affectedValidations.touchedPaths, ["src/top.test.ts"]);
});

test("end-to-end: protected path fails, override label turns it into an overridden pass", async () => {
  const failing = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["protected/config.ts"],
    mode: "enforce",
    policyPath,
    outDir: outDir("protected-fail"),
  });
  assert.equal(failing.exitCode, 1);
  const failVerdict = failing.result.policy.evaluation.verdicts.find((v) => v.rule === "protected-paths");
  assert.equal(failVerdict?.status, "fail");

  const overridden = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["protected/config.ts"],
    mode: "enforce",
    policyPath,
    labels: ["pr-gate:override"],
    outDir: outDir("protected-override"),
  });
  assert.equal(overridden.exitCode, 0);
  const verdict = overridden.result.policy.evaluation.verdicts.find((v) => v.rule === "protected-paths");
  assert.equal(verdict?.status, "overridden");
  assert.equal(verdict?.overrideLabel, "pr-gate:override");
});

test("end-to-end: blast-radius ceiling fails above the cap and passes at it", async () => {
  const ceilingPolicy = path.join(workRoot, "ceiling-policy.json");
  writeFileSync(ceilingPolicy, JSON.stringify({ version: 1, maxImpactNodes: 2 }), "utf8");
  const failing = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts"],
    mode: "enforce",
    policyPath: ceilingPolicy,
    outDir: outDir("ceiling-fail"),
  });
  assert.equal(failing.exitCode, 1);
  const verdict = failing.result.policy.evaluation.verdicts.find((v) => v.rule === "blast-radius-ceiling");
  assert.equal(verdict?.status, "fail");

  writeFileSync(ceilingPolicy, JSON.stringify({ version: 1, maxImpactNodes: 3 }), "utf8");
  const passing = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/leaf.ts"],
    mode: "enforce",
    policyPath: ceilingPolicy,
    outDir: outDir("ceiling-pass"),
  });
  assert.equal(passing.exitCode, 0);
});
