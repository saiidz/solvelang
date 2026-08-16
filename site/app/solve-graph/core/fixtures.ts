import type { SolveGraphScanFile, SolveGraphSource } from "./contracts";

export const solveGraphFixtureSource: SolveGraphSource = Object.freeze({
  kind: "repository",
  displayName: "fixture-repository",
  fingerprint: `sha256:${"a".repeat(64)}`,
  revision: "fixture-revision",
  private: false,
});

export const solveGraphFixtureFiles: readonly SolveGraphScanFile[] = Object.freeze([
  { path: "src/index.ts", byteSize: 320 },
  { path: "src/auth/login.ts", byteSize: 640 },
  { path: "tests/login.test.ts", byteSize: 480 },
  { path: "docs/architecture.md", byteSize: 220 },
]);

export const solveGraphReorderedFixtureFiles: readonly SolveGraphScanFile[] = Object.freeze([
  solveGraphFixtureFiles[2],
  solveGraphFixtureFiles[0],
  solveGraphFixtureFiles[3],
  solveGraphFixtureFiles[1],
]);
