import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text } from "../dist/src/context-pack.js";
import { gitBlobSha1 } from "./run-context-repository-evals.mjs";
import {
  answerKeyCommitment,
  digest,
  runHeldoutSelection,
  scoreHeldoutSelection,
  validatePublicHoldout,
} from "./context-heldout-eval.mjs";

const source = (path, text) => ({ path, text, sha256: sha256Text(text), gitBlobSha1: gitBlobSha1(text) });

function fixture() {
  const sources = [
    source("src/request.js", "import { normalizeHeaders } from './headers.js';\nexport function prepareRequest(headers) {\n  return normalizeHeaders(headers);\n}\n"),
    source("src/headers.js", "export function normalizeHeaders(headers) {\n  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));\n}\n"),
  ];
  const sourceCatalogSha256 = digest(sources.map(({ path, sha256, gitBlobSha1 }) => ({ path, sha256, gitBlobSha1 })).sort((a, b) => a.path.localeCompare(b.path)));
  const answerKey = {
    schema: "solvelang.context.heldout-answer-key.v1",
    evaluationId: "synthetic-holdout-contract-v1",
    repository: "example/heldout-fixture",
    commit: "1111111111111111111111111111111111111111",
    sourceCatalogSha256,
    recordClass: "synthetic-test",
    evaluatorId: "ci-contract-fixture",
    cases: [{
      id: "request-header-normalization",
      requiredEvidence: {
        "src/request.js": ["return normalizeHeaders(headers);"],
        "src/headers.js": ["return Object.fromEntries"],
      },
      minPathPrecision: 1,
    }],
  };
  const publicInput = {
    schema: "solvelang.context.heldout-public.v1",
    evaluationId: answerKey.evaluationId,
    repository: answerKey.repository,
    commit: answerKey.commit,
    license: "MIT",
    scope: "synthetic CI-only protocol fixture; not real heldout evidence",
    answerKeyCommitment: answerKeyCommitment(answerKey),
    sources,
    cases: [{
      id: "request-header-normalization",
      task: "Trace prepareRequest header normalization through normalizeHeaders.",
      budgetBytes: 4096,
      changedPaths: ["src/request.js"],
    }],
  };
  return { publicInput, answerKey };
}

test("selection input structurally excludes answer-key and grading fields", () => {
  const { publicInput } = fixture();
  assert.equal(validatePublicHoldout(publicInput), publicInput);
  assert.throws(() => validatePublicHoldout({ ...publicInput, answerKey: {} }), /unsupported fields/);
  assert.throws(() => validatePublicHoldout({
    ...publicInput,
    cases: [{ ...publicInput.cases[0], requiredEvidence: { "src/request.js": ["prepareRequest"] } }],
  }), /unsupported fields/);
});

test("selection transcript is deterministic for the same public input", () => {
  const { publicInput } = fixture();
  const first = runHeldoutSelection(publicInput);
  const second = runHeldoutSelection(structuredClone(publicInput));
  assert.deepEqual(second, first);
  assert.equal(first.truth.deterministicTranscript, true);
});

test("precommitted synthetic key scores only after selection and stays claim-bounded", () => {
  const { publicInput, answerKey } = fixture();
  const transcript = runHeldoutSelection(publicInput);
  assert.equal(transcript.truth.answerKeyPresentInSelectorInput, false);
  assert.equal(transcript.truth.answerKeyCommitmentPresentBeforeSelection, true);
  assert.equal(transcript.truth.blindedEvidenceEstablishedByProtocolAlone, false);

  const report = scoreHeldoutSelection(transcript, answerKey);
  assert.equal(report.aggregate.pass, true);
  assert.equal(report.recordClass, "synthetic-test");
  assert.equal(report.truth.answerKeyMatchedPreSelectionCommitment, true);
  assert.equal(report.truth.syntheticEvidence, true);
  assert.equal(report.truth.genuinelyBlindedEvidenceEstablished, false);
  assert.equal(report.truth.independentEvaluatorAttestationRequired, true);
  assert.equal(report.truth.publicationAuthorized, false);
});

test("revealed key cannot be changed after selection", () => {
  const { publicInput, answerKey } = fixture();
  const transcript = runHeldoutSelection(publicInput);
  const tampered = structuredClone(answerKey);
  tampered.cases[0].minPathPrecision = 0.5;
  assert.throws(() => scoreHeldoutSelection(transcript, tampered), /does not match the pre-selection commitment/);
});

test("transcript tampering fails before hidden-key scoring", () => {
  const { publicInput, answerKey } = fixture();
  const transcript = runHeldoutSelection(publicInput);
  const tampered = structuredClone(transcript);
  tampered.cases[0].arms.graphAssisted.pack.selectedBytes += 1;
  assert.throws(() => scoreHeldoutSelection(tampered, answerKey), /transcript identity mismatch/);
});
