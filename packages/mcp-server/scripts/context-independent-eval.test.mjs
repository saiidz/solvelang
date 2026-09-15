import assert from "node:assert/strict";
import test from "node:test";
import { validateCorpus } from "./run-context-repository-evals.mjs";
import {
  evaluateIndependentCorpora,
  loadIndependentCorpora,
} from "./run-context-independent-evals.mjs";

test("loads distinct pinned external MIT corpora with exact snapshot identities", async () => {
  const loaded = await loadIndependentCorpora();
  assert.equal(loaded.length, 2);
  assert.deepEqual(
    loaded.map(({ corpus }) => corpus.repository).sort(),
    ["chalk/chalk", "node-fetch/node-fetch"],
  );

  for (const { corpus, licenseNoticeSha256 } of loaded) {
    assert.equal(corpus.license, "MIT");
    assert.match(corpus.commit, /^[a-f0-9]{40}$/);
    assert.match(licenseNoticeSha256, /^[a-f0-9]{64}$/);
    assert.ok(corpus.sources.length >= 2);
    for (const source of corpus.sources) {
      assert.match(source.gitBlobSha1, /^[a-f0-9]{40}$/);
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(source.text.length > 0);
    }
  }
});

test("independent corpus report remains offline and claim-bounded", async () => {
  const report = evaluateIndependentCorpora(await loadIndependentCorpora());
  const failureSummary = report.corpora.flatMap((item) =>
    item.report.cases
      .filter((caseReport) => !caseReport.pass)
      .map((caseReport) => ({
        repository: item.repository,
        id: caseReport.id,
        qualityNonRegression: caseReport.qualityNonRegression,
        lexical: {
          selectedPaths: caseReport.arms.lexical.selectedPaths,
          missingEvidence: caseReport.arms.lexical.missingEvidence,
          evidenceRecall: caseReport.arms.lexical.evidenceRecall,
          pathPrecision: caseReport.arms.lexical.pathPrecision,
        },
        changedPaths: {
          selectedPaths: caseReport.arms.changedPaths.selectedPaths,
          missingEvidence: caseReport.arms.changedPaths.missingEvidence,
          evidenceRecall: caseReport.arms.changedPaths.evidenceRecall,
          pathPrecision: caseReport.arms.changedPaths.pathPrecision,
        },
        graphAssisted: {
          selectedPaths: caseReport.arms.graphAssisted.selectedPaths,
          missingEvidence: caseReport.arms.graphAssisted.missingEvidence,
          evidenceRecall: caseReport.arms.graphAssisted.evidenceRecall,
          pathPrecision: caseReport.arms.graphAssisted.pathPrecision,
          pass: caseReport.arms.graphAssisted.pass,
        },
      })),
  );

  assert.equal(report.aggregate.repositoryCount, 2);
  assert.ok(report.aggregate.sourceCount >= 5);
  assert.ok(report.aggregate.caseCount >= 4);
  assert.equal(report.aggregate.pass, true, JSON.stringify(failureSummary, null, 2));
  assert.equal(report.truth.wholeRepositoriesMeasured, false);
  assert.equal(report.truth.blindedHoldout, false);
  assert.equal(report.truth.annotationsVisibleToImplementation, true);
  assert.equal(report.truth.byteReductionIsNotTokenSavings, true);
  assert.equal(report.truth.providerTokens, null);
  assert.equal(report.truth.providerCacheReuse, null);
  assert.equal(report.truth.agentTaskSuccess, null);
  assert.equal(report.truth.externalCompetitorMeasured, false);
  assert.equal(report.truth.credentialsUsed, false);
  assert.equal(report.truth.providerRequests, 0);
  assert.equal(report.truth.networkDuringEvaluation, false);
  assert.equal(report.truth.snapshotCodeExecuted, false);
  assert.equal(report.truth.publicationAuthorized, false);

  for (const item of report.corpora) {
    assert.equal(item.report.aggregate.pass, true, `${item.repository} independent corpus failed`);
    assert.equal(item.report.truth.credentialsUsed, false);
    assert.equal(item.report.truth.providerRequests, 0);
    assert.equal(item.report.truth.snapshotCodeExecuted, false);
  }
});

test("snapshot byte tampering fails the existing corpus integrity contract", async () => {
  const [{ corpus }] = await loadIndependentCorpora();
  const tampered = structuredClone(corpus);
  tampered.sources[0].text += "\n// tampered\n";
  assert.throws(() => validateCorpus(tampered), /Corpus source hash mismatch/);
});
