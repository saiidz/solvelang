import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryInventory, type RepositoryFileInput, type RepositorySnapshot } from "./inventory";

const source = {
  kind: "github" as const,
  displayName: "example/review-regressions",
  revision: "125718d1ce372b78ab58b8478bc880700e1ab99f",
  fingerprint: `sha256:${"1".repeat(64)}`,
};

function snapshot(files: RepositoryFileInput[]): RepositorySnapshot {
  return { source, files };
}

function hash(character: string): string {
  return character.repeat(64);
}

test("omits authenticated dependency specifications from framework output", () => {
  const canary = "REPOSITORY_AUDIT_DEPENDENCY_TOKEN_CANARY";
  const report = analyzeRepositoryInventory(snapshot([
    {
      path: "package.json",
      byteSize: 200,
      sha256: hash("a"),
      text: JSON.stringify({ dependencies: { next: `git+https://user:${canary}@github.com/example/next.git` } }),
    },
  ]));

  const next = report.inventory.frameworks.find(({ name }) => name === "Next.js");
  assert.ok(next);
  assert.equal(next.version, undefined);
  assert.ok(!JSON.stringify(report).includes(canary));
});

test("reports active duplicates as well as the matching backup candidate", () => {
  const duplicateHash = hash("b");
  const report = analyzeRepositoryInventory(snapshot([
    { path: "src/a.ts", byteSize: 20, sha256: duplicateHash },
    { path: "src/b.ts", byteSize: 20, sha256: duplicateHash },
    { path: "src/b.backup.ts", byteSize: 20, sha256: duplicateHash },
  ]));

  const duplicate = report.findings.find(({ ruleId }) => ruleId === "RA010");
  const backup = report.findings.find(({ ruleId }) => ruleId === "RA012");
  assert.ok(duplicate);
  assert.ok(backup);
  assert.deepEqual(duplicate.evidence.map(({ path }) => path), ["src/a.ts", "src/b.ts"]);
  assert.equal(backup.evidence[0].path, "src/b.backup.ts");
  assert.deepEqual(report.findings.map(({ ruleId }) => ruleId), ["RA010", "RA012"]);
});

test("uses locale-independent ordering for non-ASCII repository paths", () => {
  const files: RepositoryFileInput[] = [
    { path: "src/é.ts", byteSize: 1, sha256: hash("c") },
    { path: "src/z.ts", byteSize: 1, sha256: hash("c") },
    { path: "src/ä.ts", byteSize: 1, sha256: hash("c") },
  ];
  const forward = analyzeRepositoryInventory(snapshot(files));
  const reverse = analyzeRepositoryInventory(snapshot([...files].reverse()));
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward.detections.duplicates[0].members.map(({ path }) => path), ["src/z.ts", "src/ä.ts", "src/é.ts"]);
});

test("caps materialized findings and marks the report partial", () => {
  const files = Array.from({ length: 100 }, (_, index): RepositoryFileInput => ({
    path: `dist/generated-${String(index).padStart(3, "0")}.js`,
    byteSize: 1,
    sha256: index.toString(16).padStart(64, "0"),
  }));
  const report = analyzeRepositoryInventory(snapshot(files), { maxFindings: 3 });
  assert.equal(report.findings.length, 3);
  assert.deepEqual(report.execution.truncationReasons, ["finding-count"]);
  assert.equal(report.execution.status, "partial");
});
