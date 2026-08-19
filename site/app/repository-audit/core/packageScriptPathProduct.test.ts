import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";
import { createRepositoryPackageScriptPathProductBundle } from "./packageScriptPathProduct";

function fixture(): RepositoryPackageScriptPathEvidenceAnalysis {
  return {
    schema: "solvelang.repository-audit.package-script-path-evidence.v0",
    mode: "analyze-only",
    graphId: "sg_package_script_product_fixture",
    status: "complete",
    relationships: [
      {
        evidenceId: "package-script:node-entrypoint:package.json:scripts.start:src/index.js",
        kind: "node-entrypoint",
        fromPath: "package.json",
        scriptName: "start",
        rawReference: "src/index.js",
        targetPath: "src/index.js",
        targetState: "present",
        evidence: { path: "package.json", field: "scripts.start" },
      },
      {
        evidenceId: "package-script:tsc-project:package.json:scripts.build:tsconfig.build.json",
        kind: "tsc-project",
        fromPath: "package.json",
        scriptName: "build",
        rawReference: "tsconfig.build.json",
        targetPath: "tsconfig.build.json",
        targetState: "present",
        evidence: { path: "package.json", field: "scripts.build" },
      },
    ],
    skipped: {
      missingText: 0,
      oversizedPackageText: 0,
      oversizedScript: 0,
      invalidJson: 0,
      dynamicScript: 0,
      invalidTarget: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxPackageTextBytes: 1024 * 1024,
      maxScriptTextBytes: 4096,
      relationshipsTruncated: false,
      acceptedFiles: 3,
      packageFilesExamined: 1,
      graphTruncated: false,
    },
  };
}

test("composes deterministic package-script artifact and browser presentation", async () => {
  const first = await createRepositoryPackageScriptPathProductBundle("sample repo.zip", fixture());
  const second = await createRepositoryPackageScriptPathProductBundle("sample repo.zip", structuredClone(fixture()));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.package-script-path-product.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.equal(first.download.artifact.graphId, first.graphId);
  assert.equal(first.presentation.graphId, first.graphId);
  assert.equal(first.presentation.summary.relationships, 2);
  assert.match(first.download.filename, /sample-repo-solvelang-repository-audit-package-script-paths\.json$/);
  assert.match(first.download.artifact.integrity.canonicalJsonSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("presentation row bounds participate in product partial truth without mutating source evidence", async () => {
  const analysis = fixture();
  const before = structuredClone(analysis);
  const result = await createRepositoryPackageScriptPathProductBundle("repo.zip", analysis, { maxRows: 1 });

  assert.deepEqual(analysis, before);
  assert.equal(result.status, "partial");
  assert.equal(result.execution.sourcePartial, false);
  assert.equal(result.execution.presentationRowsTruncated, true);
  assert.equal(result.presentation.summary.rowsShown, 1);
  assert.equal(result.presentation.summary.rowsHidden, 1);
  assert.equal(result.download.artifact.relationships.length, 2);
});

test("source partial state is preserved independently from presentation bounds", async () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.graphTruncated = true;
  const result = await createRepositoryPackageScriptPathProductBundle("repo.zip", analysis, { maxRows: 10 });

  assert.equal(result.status, "partial");
  assert.equal(result.execution.sourcePartial, true);
  assert.equal(result.execution.presentationRowsTruncated, false);
  assert.match(result.presentation.notices.join(" "), /underlying repository graph is partial/i);
});

test("fails closed when runtime input claims mutable capabilities", async () => {
  const runtimeAnalysis = structuredClone(fixture()) as unknown as {
    mode: string;
    execution: { networkAccess: boolean; writeAccess: boolean } & Record<string, unknown>;
  };
  runtimeAnalysis.execution.networkAccess = true;

  await assert.rejects(
    createRepositoryPackageScriptPathProductBundle(
      "repo.zip",
      runtimeAnalysis as unknown as RepositoryPackageScriptPathEvidenceAnalysis,
    ),
    /requires analyze-only input/,
  );
});
