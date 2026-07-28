import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeRepositoryInventory,
  classifyRepositoryFile,
  normalizeRepositoryPath,
  type RepositoryFileInput,
  type RepositorySnapshot,
} from "./inventory";

const source = {
  kind: "github" as const,
  displayName: "example/automation-app",
  revision: "014c074e89f91e9bfb8ddf80b7998be040b8257a",
  fingerprint: `sha256:${"1".repeat(64)}`,
};

function snapshot(files: RepositoryFileInput[]): RepositorySnapshot {
  return { source, files };
}

function hash(character: string): string {
  return character.repeat(64);
}

test("normalizes safe repository paths and rejects traversal or platform-specific paths", () => {
  assert.equal(normalizeRepositoryPath("./src//index.ts"), "src/index.ts");
  assert.throws(() => normalizeRepositoryPath("../secret.txt"), /traverse/);
  assert.throws(() => normalizeRepositoryPath("src/../secret.txt"), /traverse/);
  assert.throws(() => normalizeRepositoryPath("/etc/passwd"), /relative/);
  assert.throws(() => normalizeRepositoryPath("C:\\Windows\\system.ini"), /relative|POSIX/);
  assert.throws(() => normalizeRepositoryPath("src\\index.ts"), /POSIX/);
  assert.throws(() => normalizeRepositoryPath(""), /non-empty/);
});

test("classifies source, tests, documentation, configuration, generated, vendor, assets, archives, and backups", () => {
  assert.equal(classifyRepositoryFile({ path: "src/index.ts" }), "source");
  assert.equal(classifyRepositoryFile({ path: "src/index.test.ts" }), "test");
  assert.equal(classifyRepositoryFile({ path: "docs/architecture.md" }), "documentation");
  assert.equal(classifyRepositoryFile({ path: ".github/workflows/ci.yml" }), "configuration");
  assert.equal(classifyRepositoryFile({ path: "dist/app.js" }), "generated");
  assert.equal(classifyRepositoryFile({ path: "node_modules/pkg/index.js" }), "vendor");
  assert.equal(classifyRepositoryFile({ path: "public/logo.svg" }), "asset");
  assert.equal(classifyRepositoryFile({ path: "release/source.zip" }), "archive");
  assert.equal(classifyRepositoryFile({ path: "src/index.backup.ts" }), "backup");
});

test("builds deterministic language, framework, package-manager, deployment, and file-class inventory", () => {
  const files: RepositoryFileInput[] = [
    {
      path: "package.json",
      byteSize: 180,
      sha256: hash("a"),
      text: JSON.stringify({ dependencies: { next: "16.2.7", react: "19.2.4" } }),
    },
    { path: "package-lock.json", byteSize: 400, sha256: hash("b") },
    { path: "src/page.tsx", byteSize: 120, sha256: hash("c") },
    { path: "src/page.test.tsx", byteSize: 90, sha256: hash("d") },
    { path: "README.md", byteSize: 70, sha256: hash("e") },
    { path: ".github/workflows/ci.yml", byteSize: 110, sha256: hash("f") },
    { path: "public/logo.svg", byteSize: 80, sha256: hash("0") },
  ];
  const report = analyzeRepositoryInventory(snapshot(files));

  assert.equal(report.schema, "solvelang.repository-audit.inventory.v0");
  assert.equal(report.mode, "analyze-only");
  assert.equal(report.execution.status, "complete");
  assert.equal(report.execution.networkAccess, false);
  assert.equal(report.execution.writeAccess, false);
  assert.equal(report.summary.filesScanned, files.length);
  assert.deepEqual(report.inventory.languages.map(({ name }) => name), ["TypeScript"]);
  assert.deepEqual(report.inventory.frameworks.map(({ name }) => name), ["Next.js", "React"]);
  assert.deepEqual(report.inventory.packageManagers.map(({ name }) => name), ["npm"]);
  assert.deepEqual(report.inventory.deploymentTargets.map(({ name }) => name), ["GitHub Actions"]);

  const classes = Object.fromEntries(report.inventory.fileClasses.map((entry) => [entry.class, entry.count]));
  assert.equal(classes.source, 1);
  assert.equal(classes.test, 1);
  assert.equal(classes.documentation, 1);
  assert.equal(classes.configuration, 3);
  assert.equal(classes.asset, 1);
});

test("detects exact duplicates and makes backup removal only an approval-based candidate", () => {
  const duplicateHash = hash("2");
  const report = analyzeRepositoryInventory(snapshot([
    { path: "src/config.ts", byteSize: 80, sha256: duplicateHash },
    { path: "src/config.backup.ts", byteSize: 80, sha256: duplicateHash },
  ]));

  assert.equal(report.detections.duplicates.length, 1);
  assert.equal(report.detections.backupCandidates.length, 1);
  const finding = report.findings.find(({ ruleId }) => ruleId === "RA012");
  assert.ok(finding);
  assert.equal(finding.recommendation, "delete-candidate");
  assert.equal(finding.destructive, true);
  assert.equal(finding.approvalRequired, true);
  assert.ok(finding.validation.length > 0);
  assert.ok(finding.rollback.length > 0);
});

test("reports non-backup exact duplicates for review without authorizing a mutation", () => {
  const duplicateHash = hash("3");
  const report = analyzeRepositoryInventory(snapshot([
    { path: "fixtures/a.json", byteSize: 40, sha256: duplicateHash },
    { path: "fixtures/b.json", byteSize: 40, sha256: duplicateHash },
  ]));
  const finding = report.findings.find(({ ruleId }) => ruleId === "RA010");
  assert.ok(finding);
  assert.equal(finding.recommendation, "review");
  assert.equal(finding.destructive, false);
  assert.equal(finding.approvalRequired, false);
});

test("classifies generated and large files without calling them safe to delete", () => {
  const report = analyzeRepositoryInventory(snapshot([
    { path: "dist/app.js", byteSize: 6 * 1024 * 1024, sha256: hash("4") },
  ]));
  assert.equal(report.detections.generatedCandidates.length, 1);
  assert.equal(report.inventory.largeFiles.length, 1);
  assert.ok(report.findings.some(({ ruleId, recommendation }) => ruleId === "RA020" && recommendation === "keep"));
  assert.ok(report.findings.some(({ ruleId, recommendation }) => ruleId === "RA023" && recommendation === "review"));
  assert.ok(report.findings.every(({ destructive }) => destructive === false));
});

test("produces identical output regardless of input file order", () => {
  const files: RepositoryFileInput[] = [
    { path: "src/b.ts", byteSize: 20, sha256: hash("5") },
    { path: "src/a.ts", byteSize: 20, sha256: hash("5") },
    { path: "README.md", byteSize: 10, sha256: hash("6") },
  ];
  const forward = analyzeRepositoryInventory(snapshot(files));
  const reverse = analyzeRepositoryInventory(snapshot([...files].reverse()));
  assert.deepEqual(reverse, forward);
});

test("fails closed on duplicate paths, invalid hashes, and invalid source fingerprints", () => {
  assert.throws(() => analyzeRepositoryInventory(snapshot([
    { path: "src/index.ts", byteSize: 1 },
    { path: "./src/index.ts", byteSize: 1 },
  ])), /Duplicate repository path/);
  assert.throws(() => analyzeRepositoryInventory(snapshot([{ path: "src/index.ts", byteSize: 1, sha256: "not-a-hash" }])), /Invalid SHA-256/);
  assert.throws(() => analyzeRepositoryInventory({ source: { ...source, fingerprint: "bad" }, files: [] }), /fingerprint/);
});

test("applies bounded file, size, depth, byte, and finding limits with explicit partial status", () => {
  const report = analyzeRepositoryInventory(snapshot([
    { path: "a.ts", byteSize: 10, sha256: hash("7") },
    { path: "b.ts", byteSize: 10, sha256: hash("7") },
    { path: "deep/one/two/three.ts", byteSize: 10, sha256: hash("8") },
    { path: "huge.bin", byteSize: 200, sha256: hash("9") },
  ]), {
    maxFiles: 4,
    maxTotalBytes: 25,
    maxFileBytes: 100,
    maxDepth: 3,
    maxFindings: 1,
    largeFileThresholdBytes: 20,
  });

  assert.equal(report.execution.status, "partial");
  assert.equal(report.execution.truncated, true);
  assert.ok(report.execution.truncationReasons.includes("depth"));
  assert.ok(report.execution.truncationReasons.includes("file-size"));
  assert.ok(report.execution.truncationReasons.includes("finding-count"));
  assert.equal(report.findings.length, 1);
  assert.equal(report.summary.filesSkipped, 2);
});

test("never serializes manifest text or secret-shaped values into inventory output", () => {
  const canary = "sk_test_DO_NOT_LEAK_REPOSITORY_AUDIT_CANARY";
  const report = analyzeRepositoryInventory(snapshot([
    {
      path: "package.json",
      byteSize: 200,
      sha256: hash("a"),
      text: JSON.stringify({ dependencies: { next: "16.2.7" }, privateToken: canary }),
    },
  ]));
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(canary));
  assert.ok(!serialized.includes("privateToken"));
  assert.ok(serialized.includes("Next.js"));
});
