import assert from "node:assert/strict";
import test from "node:test";
import { solveGraphFixtureFiles, solveGraphReorderedFixtureFiles } from "./fixtures";
import {
  defaultSolveGraphScanLimits,
  normalizeSolveGraphPath,
  planBoundedSolveGraphScan,
} from "./limits";

test("bounded scan planning is deterministic regardless of input order", () => {
  const left = planBoundedSolveGraphScan(solveGraphFixtureFiles);
  const right = planBoundedSolveGraphScan(solveGraphReorderedFixtureFiles);
  assert.deepEqual(left, right);
  assert.deepEqual(left.accepted.map((item) => item.path), [
    "docs/architecture.md",
    "src/auth/login.ts",
    "src/index.ts",
    "tests/login.test.ts",
  ]);
  assert.equal(left.status, "complete");
});

test("bounded scan planning reports deterministic truncation reasons without reading skipped content", () => {
  const plan = planBoundedSolveGraphScan([
    { path: "a.ts", byteSize: 4 },
    { path: "b.ts", byteSize: 9 },
    { path: "deep/a/b/c.ts", byteSize: 2 },
    { path: "z.ts", byteSize: 4 },
  ], {
    ...defaultSolveGraphScanLimits,
    maxFiles: 2,
    maxTotalBytes: 8,
    maxFileBytes: 8,
    maxDepth: 3,
  });
  assert.equal(plan.status, "partial");
  assert.deepEqual(plan.accepted, [
    { path: "a.ts", byteSize: 4 },
    { path: "z.ts", byteSize: 4 },
  ]);
  assert.deepEqual(plan.skipped, [
    { path: "b.ts", byteSize: 9, reason: "file-size" },
    { path: "deep/a/b/c.ts", byteSize: 2, reason: "depth" },
  ]);
  assert.deepEqual(plan.truncationReasons, ["depth", "file-size"]);
});

test("path normalization fails closed on traversal, absolute paths, platform separators, and duplicates", () => {
  assert.equal(normalizeSolveGraphPath("./src//index.ts"), "src/index.ts");
  assert.throws(() => normalizeSolveGraphPath("../secret.txt"), /cannot traverse/);
  assert.throws(() => normalizeSolveGraphPath("/etc/passwd"), /repository-relative/);
  assert.throws(() => normalizeSolveGraphPath("C:\\secret.txt"), /POSIX separators|repository-relative/);
  assert.throws(() => planBoundedSolveGraphScan([
    { path: "src/a.ts", byteSize: 1 },
    { path: "./src/a.ts", byteSize: 1 },
  ]), /duplicate path/);
});
