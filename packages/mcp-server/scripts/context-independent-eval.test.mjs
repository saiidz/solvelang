import assert from "node:assert/strict";
import test from "node:test";
import { buildContextPack } from "../dist/src/context-pack.js";
import { validateCorpus } from "./run-context-repository-evals.mjs";
import {
  evaluateIndependentCorpora,
  loadIndependentCorpora,
} from "./run-context-independent-evals.mjs";

const selected = (path, text) => ({
  path,
  text,
  selection: { score: 64, reasons: ["graph:dependency:imports:fixture-edge"] },
});

test("loads distinct pinned external MIT corpora with exact snapshot identities", async () => {
  const loaded = await loadIndependentCorpora();
  assert.equal(loaded.length, 4);
  assert.deepEqual(
    loaded.map(({ corpus }) => corpus.repository).sort(),
    ["axios/axios", "chalk/chalk", "node-fetch/node-fetch", "preactjs/preact"],
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

  const axios = loaded.find(({ corpus }) => corpus.repository === "axios/axios");
  assert.ok(axios);
  assert.equal(axios.corpus.sources.length, 4);
  assert.equal(axios.corpus.cases.length, 3);

  const preact = loaded.find(({ corpus }) => corpus.repository === "preactjs/preact");
  assert.ok(preact);
  assert.equal(preact.corpus.sources.length, 13);
  assert.equal(preact.corpus.cases.length, 4);
});

test("selected lexical function hits retain bounded later implementation evidence", () => {
  const text = [
    "export function stringReplaceAll(string, substring, postfix) {",
    "  let index = string.indexOf(substring);",
    "  if (index === -1) return string;",
    "  const substringLength = substring.length;",
    "  let endIndex = 0;",
    "  let returnValue = '';",
    "  do {",
    "    returnValue += string.slice(endIndex, index) + substring + postfix;",
    "    endIndex = index + substringLength;",
    "    index = string.indexOf(substring, endIndex);",
    "  } while (index !== -1);",
    "  returnValue += string.slice(endIndex);",
    "  return returnValue;",
    "}",
  ].join("\n");
  const plain = buildContextPack("Review stringReplaceAll reopening", [{ path: "source/utilities.js", text }], 1024);
  const hinted = buildContextPack("Review stringReplaceAll reopening", [selected("source/utilities.js", text)], 1024);

  assert.ok(!plain.entries.some((entry) => entry.content.includes("index = string.indexOf(substring, endIndex);")));
  assert.ok(hinted.entries.some((entry) => entry.content.includes("index = string.indexOf(substring, endIndex);")));
  assert.ok(hinted.entries.some((entry) => entry.reasons.includes("selection:declaration-text-window")));
});

test("selected JSDoc hits reach the exported const declaration they describe", () => {
  const text = [
    "/**",
    " * Performs the operation extract a Content-Type value from object.",
    " * specified in the specification:",
    " * https://example.invalid/spec",
    " *",
    " * This function assumes body is present.",
    " *",
    " * @param {any} body Any body input",
    " * @returns {string | null}",
    " */",
    "export const extractContentType = (body, request) => {",
    "  if (body === null) return null;",
    "  return 'text/plain;charset=UTF-8';",
    "};",
  ].join("\n");
  const task = "Review response Content-Type extraction and header validation";
  const plain = buildContextPack(task, [{ path: "src/body.js", text }], 1024);
  const hinted = buildContextPack(task, [selected("src/body.js", text)], 1024);

  assert.ok(!plain.entries.some((entry) => entry.content.includes("export const extractContentType")));
  assert.ok(hinted.entries.some((entry) => entry.content.includes("export const extractContentType")));
  assert.ok(hinted.entries.some((entry) => entry.reasons.includes("selection:declaration-text-window")));
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

  assert.equal(report.aggregate.repositoryCount, 4);
  assert.equal(report.aggregate.sourceCount, 22);
  assert.equal(report.aggregate.caseCount, 11);
  assert.equal(report.aggregate.pass, true, JSON.stringify(failureSummary, null, 2));
  assert.equal(report.truth.wholeRepositoriesMeasured, false);
  assert.equal(report.truth.blindedHoldout, false);
  assert.equal(report.truth.annotationsVisibleToImplementation, true);
  assert.equal(report.truth.annotationsPassedToSelector, false);
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
