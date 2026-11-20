// Fixture proofs for solvelang-onboard: three repository shapes —
// (i) JS/TS with AGENTS.md, (ii) Python with CLAUDE.md, (iii) a bare repo
// with neither guidance file. For each: the command runs, the generated
// .solve files validate with the real solvec when a binary is available
// (onboard-ci builds solvec and sets SOLVEC_BIN), the context pack is
// built by the existing machinery, and attribution is exact — a fact
// stated only in a guidance file appears with that file as its source,
// and nothing unattributed is generated.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runOnboard } from "../src/cli";

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
}

function commitAll(cwd: string, message: string): void {
  git(cwd, ["add", "-A"]);
  git(cwd, [
    "-c",
    "user.email=onboard-test@example.com",
    "-c",
    "user.name=Onboard Test",
    "commit",
    "-qm",
    message,
  ]);
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "solvelang-onboard-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  git(dir, ["init", "-q"]);
  commitAll(dir, "init: fixture repository");
  return dir;
}

function editAndCommit(dir: string, rel: string, content: string, message: string): void {
  writeFileSync(path.join(dir, rel), content, "utf8");
  commitAll(dir, message);
}

function solvecBinary(): string | null {
  const candidate = process.env.SOLVEC_BIN || "solvec";
  try {
    execFileSync(candidate, ["version"], { stdio: "pipe" });
    return candidate;
  } catch {
    return null;
  }
}

function assertSolveFilesValid(t: test.TestContext, files: string[]): void {
  const bin = solvecBinary();
  if (!bin) {
    t.diagnostic(
      "solvec binary not available on this host — generated-file validation runs in onboard-ci, which builds solvec and sets SOLVEC_BIN.",
    );
    return;
  }
  for (const file of files) {
    execFileSync(bin, ["validate", file], { stdio: "pipe" });
  }
}

function solveFilesOf(outDir: string): string[] {
  return [
    "workflows/context-pack.solve",
    "workflows/validate.solve",
    "workflows/change-review.solve",
    "workflows/ci-triage.solve",
  ]
    .map((rel) => path.join(outDir, rel))
    .filter((full) => existsSync(full));
}

test("JS repo with AGENTS.md: command attributed to AGENTS.md, pack builds, nothing invented", async (t) => {
  const dir = makeRepo({
    "AGENTS.md":
      "# Demo\n\n## Testing\nRun the full check with `npm run verify` before pushing.\n",
    "package.json": '{\n  "name": "fixture-js",\n  "version": "1.0.0"\n}\n',
    "src/index.ts": "export const answer = 42;\n",
    "src/util.ts": "export const double = (n: number) => n * 2;\n",
  });
  editAndCommit(dir, "src/index.ts", "export const answer = 43;\n", "fix: bump answer");

  const result = await runOnboard(dir);

  const fact = result.signals.commands.find((entry) => entry.command === "npm run verify");
  assert.ok(fact, "the AGENTS.md-only command was extracted");
  assert.equal(fact.kind, "test");
  assert.equal(fact.source, "AGENTS.md:4", "attribution is the exact file and line");

  const validate = readFileSync(path.join(result.outDir, "workflows/validate.solve"), "utf8");
  assert.ok(validate.includes("npm run verify"));
  assert.ok(existsSync(path.join(result.outDir, "workflows/ci-triage.solve")));

  const pack = JSON.parse(readFileSync(path.join(result.outDir, "context-pack.json"), "utf8"));
  assert.equal(typeof pack.schema, "string");
  assert.ok(pack.pack.packId.startsWith("scp_"), "pack carries the real machinery's id");
  assert.ok(pack.pack.entries.length >= 1, "pack selected at least one source");

  const report = readFileSync(path.join(result.outDir, "onboard-report.md"), "utf8");
  assert.ok(report.includes("AGENTS.md:4"));
  assert.ok(!report.includes("npm run deploy"), "no unattributed command appears");
  assert.ok(!validate.includes("deploy"), "no invented command in the workflows");

  assertSolveFilesValid(t, solveFilesOf(result.outDir));
});

test("Python repo with CLAUDE.md: ecosystem from layout, command from CLAUDE.md", async (t) => {
  const dir = makeRepo({
    "CLAUDE.md": "# Notes\n\n## Commands\nTests: `pytest -q` for the whole suite.\n",
    "pyproject.toml": '[project]\nname = "fixture-py"\nversion = "0.1.0"\n',
    "app/main.py": "def main() -> None:\n    print('hello')\n",
    "app/__init__.py": "",
  });

  const result = await runOnboard(dir);

  const python = result.signals.ecosystems.find((eco) => eco.name === "Python");
  assert.ok(python, "Python ecosystem detected");
  assert.equal(python.source, "pyproject.toml");

  const fact = result.signals.commands.find((entry) => entry.command === "pytest -q");
  assert.ok(fact, "the CLAUDE.md command was extracted");
  assert.equal(fact.kind, "test");
  assert.equal(fact.source, "CLAUDE.md:4");

  const validate = readFileSync(path.join(result.outDir, "workflows/validate.solve"), "utf8");
  assert.ok(validate.includes("pytest -q"));

  const pack = JSON.parse(readFileSync(path.join(result.outDir, "context-pack.json"), "utf8"));
  assert.ok(pack.pack.entries.length >= 1);

  assertSolveFilesValid(t, solveFilesOf(result.outDir));
});

test("Bare repo: layout and history signals only, and no command is invented", async (t) => {
  const dir = makeRepo({
    "src/hot.ts": "export const hot = 1;\n",
    "src/cold.ts": "export const cold = 1;\n",
    "README.md": "# Bare fixture\n",
  });
  editAndCommit(dir, "src/hot.ts", "export const hot = 2;\n", "change hot once");
  editAndCommit(dir, "src/hot.ts", "export const hot = 3;\n", "change hot twice");

  const result = await runOnboard(dir);

  assert.equal(result.signals.guidanceFiles.length, 0);
  assert.equal(result.signals.commands.length, 0, "no command facts without a source");
  assert.ok(result.signals.hotPaths.length >= 1);
  assert.equal(result.signals.hotPaths[0].path, "src/hot.ts");
  assert.ok(result.signals.hotPaths[0].changes >= 3);

  assert.ok(
    !existsSync(path.join(result.outDir, "workflows/ci-triage.solve")),
    "ci-triage is not generated without a command signal",
  );
  const validate = readFileSync(path.join(result.outDir, "workflows/validate.solve"), "utf8");
  assert.ok(validate.includes("No test command was discovered"));

  const review = readFileSync(path.join(result.outDir, "workflows/change-review.solve"), "utf8");
  assert.ok(review.includes("src/hot.ts"), "hot path from history reaches the review workflow");

  const report = readFileSync(path.join(result.outDir, "onboard-report.md"), "utf8");
  assert.ok(report.includes("None discovered"));
  assert.ok(report.includes("src/hot.ts"));

  const pack = JSON.parse(readFileSync(path.join(result.outDir, "context-pack.json"), "utf8"));
  assert.ok(pack.pack.entries.length >= 1, "pack builds from layout alone");

  assertSolveFilesValid(t, solveFilesOf(result.outDir));
});
