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
