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
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync, mkdirSync } from "node:fs";
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

test("end-to-end: a changed file over the context engine's 2 MB limit is excluded from the pack, not fatal", async () => {
  const bigRoot = path.join(workRoot, "big-repo");
  mkdirSync(path.join(bigRoot, "src"), { recursive: true });
  writeFileSync(path.join(bigRoot, "package.json"), "{\"name\":\"big-fixture\",\"private\":true}\n", "utf8");
  writeFileSync(path.join(bigRoot, "src", "leaf.ts"), "export const leaf = 1;\n", "utf8");
  const bigContent = "import { leaf } from \"./leaf\";\n// " + "x".repeat(2 * 1024 * 1024) + "\nexport const big = leaf + 1;\n";
  writeFileSync(path.join(bigRoot, "src", "big.ts"), bigContent, "utf8");
  const git = (args: string[]) => execFileSync("git", args, { cwd: bigRoot, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "pr-gate-tests@example.com"]);
  git(["config", "user.name", "PR Gate Tests"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "seed"]);
  const { exitCode, result } = await runPrGate({
    root: bigRoot,
    changedPaths: ["src/big.ts", "src/leaf.ts"],
    mode: "enforce",
    outDir: outDir("big"),
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(result.changedFiles, [
    { path: "src/big.ts", mappedToGraphNode: true },
    { path: "src/leaf.ts", mappedToGraphNode: true },
  ]);
  assert.ok(result.pack);
  assert.deepEqual(result.pack.skippedOversizePaths, ["src/big.ts"]);
  assert.deepEqual(result.pack.files.map((file) => file.path), ["src/leaf.ts"]);
  assert.equal(result.pack.graphInput, "provided");
  const report = readFileSync(path.join(outDir("big"), "report.md"), "utf8");
  assert.ok(report.includes("exceeds the context engine's 2 MB per-file limit"));
});

// A small binary file with the real WebAssembly magic header; its bytes
// contain NULs, which is the context engine's own binary signal.
const WASM_BYTES = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test("end-to-end: a binary changed file is skipped from the pack, not fatal", async () => {
  writeFileSync(path.join(fixtureRoot, "src", "blob.wasm"), WASM_BYTES);

  const reportOnly = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/blob.wasm", "src/leaf.ts"],
    mode: "report-only",
    outDir: outDir("binary-report-only"),
  });
  assert.equal(reportOnly.exitCode, 0);
  assert.ok(reportOnly.result.pack);
  assert.equal(reportOnly.result.pack.source, "explicit");
  assert.deepEqual(reportOnly.result.pack.skippedBinaryPaths, ["src/blob.wasm"]);
  assert.deepEqual(
    reportOnly.result.pack.files.map((file) => file.path).sort(),
    ["src/leaf.ts", "src/mid.ts", "src/top.test.ts", "src/top.ts"],
  );
  const report = readFileSync(path.join(outDir("binary-report-only"), "report.md"), "utf8");
  assert.ok(report.includes("is not a text file"));
  assert.ok(report.includes("`src/blob.wasm`"));

  // In enforce mode the verdict reflects only the text files: the leaf
  // change's untouched affected validation still fails the run...
  const enforceFail = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/blob.wasm", "src/leaf.ts"],
    mode: "enforce",
    policyPath,
    outDir: outDir("binary-enforce-fail"),
  });
  assert.equal(enforceFail.exitCode, 1);
  assert.deepEqual(enforceFail.result.pack?.skippedBinaryPaths, ["src/blob.wasm"]);
  const verdict = enforceFail.result.policy.evaluation.verdicts.find((v) => v.rule === "affected-validations");
  assert.equal(verdict?.status, "fail");

  // ...and touching the validation makes the same change set pass.
  const enforcePass = await runPrGate({
    root: fixtureRoot,
    changedPaths: ["src/blob.wasm", "src/leaf.ts", "src/top.test.ts"],
    mode: "enforce",
    policyPath,
    outDir: outDir("binary-enforce-pass"),
  });
  assert.equal(enforcePass.exitCode, 0);
  assert.deepEqual(enforcePass.result.pack?.skippedBinaryPaths, ["src/blob.wasm"]);
});

test("end-to-end: a PR consisting only of a binary file completes without error", async () => {
  writeFileSync(path.join(fixtureRoot, "src", "blob.wasm"), WASM_BYTES);
  for (const mode of ["report-only", "enforce"] as const) {
    const { exitCode, result } = await runPrGate({
      root: fixtureRoot,
      changedPaths: ["src/blob.wasm"],
      mode,
      outDir: outDir(`binary-only-${mode}`),
    });
    assert.equal(exitCode, 0);
    assert.ok(result.pack, "a discovery pack is still built from the rest of the checkout");
    assert.equal(result.pack.source, "discovery");
    assert.deepEqual(result.pack.skippedBinaryPaths, ["src/blob.wasm"]);
    assert.ok(result.pack.files.every((file) => file.path !== "src/blob.wasm"));
  }
});

test("end-to-end: a checkout with an oversize (>8 MB) file and a symlink still gets a verdict", async () => {
  // Regression: walkCheckout used to feed size-only entries (files over
  // the 8 MB walk cap) and symlink entries into the ingestion engine,
  // which throws on both — the whole gate run died with an operational
  // error and no report was written. The fixture is generated at test
  // time in a temp dir; the big file is sparse, so nothing large is
  // committed or stored.
  const giantWork = mkdtempSync(path.join(tmpdir(), "pr-gate-giant-"));
  try {
    const repo = path.join(giantWork, "repo");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
    writeFileSync(path.join(repo, "src", "leaf.ts"), "export const leaf = 1;\n");
    writeFileSync(path.join(repo, "src", "top.ts"), "import { leaf } from \"./leaf\";\nexport const top = leaf + 1;\n");
    const bigPath = path.join(repo, "assets-big.bin");
    writeFileSync(bigPath, Buffer.alloc(64));
    truncateSync(bigPath, 9 * 1024 * 1024);
    symlinkSync(path.join(repo, "src", "leaf.ts"), path.join(repo, "src", "leaf-link.ts"));
    const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git(["init", "-q"]);
    git(["config", "user.email", "pr-gate-tests@example.com"]);
    git(["config", "user.name", "PR Gate Tests"]);
    git(["add", "-A"]);
    git(["commit", "-qm", "seed"]);

    const { exitCode, result } = await runPrGate({
      root: repo,
      changedPaths: ["assets-big.bin", "src/leaf.ts"],
      mode: "report-only",
      outDir: path.join(giantWork, "out"),
    });
    assert.equal(exitCode, 0);
    assert.equal(result.graph.integrityVerified, true);
    assert.equal(result.graph.executionStatus, "complete");
    // The oversize file contributes no graph node; the text file does.
    assert.deepEqual(result.changedFiles, [
      { path: "assets-big.bin", mappedToGraphNode: false },
      { path: "src/leaf.ts", mappedToGraphNode: true },
    ]);
    // ...and the oversize file is still reported honestly through the
    // pack's skipped-oversize list.
    assert.ok(result.pack);
    assert.deepEqual(result.pack.skippedOversizePaths, ["assets-big.bin"]);
    // The report artifacts were written (pre-fix, the run died first).
    assert.ok(existsSync(path.join(giantWork, "out", "report.md")));
    assert.ok(existsSync(path.join(giantWork, "out", "result.json")));
    const report = readFileSync(path.join(giantWork, "out", "report.md"), "utf8");
    assert.ok(report.includes(REPORT_MARKER));
  } finally {
    rmSync(giantWork, { recursive: true, force: true });
  }
});
