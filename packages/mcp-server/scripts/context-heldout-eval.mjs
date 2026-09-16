import { buildContextPack, sha256Text } from "../dist/src/context-pack.js";
import { buildContextSelection, normalizeContextSelectionPath } from "../dist/src/context-selection.js";
import { gitBlobSha1, pinnedImportGraph, scorePack } from "./run-context-repository-evals.mjs";

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_CORPUS_BYTES = 2 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const byteLength = (text) => Buffer.byteLength(text, "utf8");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export const digest = (value) => sha256Text(JSON.stringify(canonical(value)));
export const answerKeyCommitment = (key) => `sha256:${digest(key)}`;

function exactKeys(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(extra.length === 0, `${label} contains unsupported fields: ${extra.join(", ")}.`);
}

function canonicalPath(value, label) {
  assert(typeof value === "string" && normalizeContextSelectionPath(value) === value, `${label} must be a canonical relative path.`);
  return value;
}

function validateSource(source, paths) {
  exactKeys(source, ["path", "text", "sha256", "gitBlobSha1"], "Holdout source");
  const p = canonicalPath(source.path, "Holdout source path");
  assert(!paths.has(p), "Duplicate holdout source path.");
  paths.add(p);
  assert(typeof source.text === "string" && byteLength(source.text) > 0 && byteLength(source.text) <= 128 * 1024, "Holdout source text is out of bounds.");
  assert(Buffer.from(source.text, "utf8").toString("utf8") === source.text, "Holdout source text must roundtrip through UTF-8.");
  assert(source.sha256 === sha256Text(source.text), "Holdout source SHA-256 mismatch.");
  assert(source.gitBlobSha1 === gitBlobSha1(source.text), "Holdout source Git blob mismatch.");
}

export function validatePublicHoldout(input) {
  exactKeys(input, ["schema", "evaluationId", "repository", "commit", "license", "scope", "answerKeyCommitment", "sources", "cases"], "Public holdout input");
  assert(input.schema === "solvelang.context.heldout-public.v1", "Unsupported public holdout schema.");
  assert(typeof input.evaluationId === "string" && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(input.evaluationId), "Invalid holdout evaluation ID.");
  assert(typeof input.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(input.repository), "Invalid holdout repository identity.");
  assert(typeof input.commit === "string" && /^[a-f0-9]{40}$/.test(input.commit), "Holdout needs an exact commit pin.");
  assert(input.license === "MIT", "Holdout corpus license must be reviewed as MIT.");
  assert(typeof input.scope === "string" && input.scope.length > 0 && input.scope.length <= 512, "Holdout scope is required.");
  assert(typeof input.answerKeyCommitment === "string" && /^sha256:[a-f0-9]{64}$/.test(input.answerKeyCommitment), "Invalid answer-key commitment.");
  assert(Array.isArray(input.sources) && input.sources.length > 0 && input.sources.length <= 32, "Invalid holdout source count.");
  const paths = new Set();
  let totalBytes = 0;
  for (const source of input.sources) {
    validateSource(source, paths);
    totalBytes += byteLength(source.text);
  }
  assert(totalBytes <= MAX_CORPUS_BYTES, "Holdout corpus exceeds the total byte bound.");
  assert(Array.isArray(input.cases) && input.cases.length > 0 && input.cases.length <= 32, "Invalid holdout case count.");
  const ids = new Set();
  for (const fixture of input.cases) {
    exactKeys(fixture, ["id", "task", "budgetBytes", "changedPaths"], "Public holdout case");
    assert(typeof fixture.id === "string" && /^[a-z0-9-]{1,80}$/.test(fixture.id) && !ids.has(fixture.id), "Invalid or duplicate holdout case ID.");
    ids.add(fixture.id);
    assert(typeof fixture.task === "string" && byteLength(fixture.task) > 0 && byteLength(fixture.task) <= 16 * 1024, "Invalid holdout task.");
    assert(Number.isSafeInteger(fixture.budgetBytes) && fixture.budgetBytes >= 1024 && fixture.budgetBytes <= 512 * 1024, "Invalid holdout budget.");
    assert(Array.isArray(fixture.changedPaths) && fixture.changedPaths.length > 0 && fixture.changedPaths.length <= 32, "Invalid holdout changed paths.");
    assert(new Set(fixture.changedPaths).size === fixture.changedPaths.length, "Duplicate holdout changed path.");
    for (const p of fixture.changedPaths) assert(paths.has(canonicalPath(p, "Holdout changed path")), "Holdout changed path is absent from the public corpus.");
  }
  return input;
}

function sourceCatalogSha256(sources) {
  return digest(sources.map(({ path, sha256, gitBlobSha1 }) => ({ path, sha256, gitBlobSha1 })).sort((a, b) => compare(a.path, b.path)));
}

export function runHeldoutSelection(rawInput) {
  const input = validatePublicHoldout(rawInput);
  const graph = pinnedImportGraph({ repository: input.repository, commit: input.commit, sources: input.sources });
  const cases = input.cases.map((fixture) => {
    const changed = buildContextSelection(fixture.changedPaths);
    const assisted = buildContextSelection(fixture.changedPaths, graph);
    const arms = {};
    for (const [name, selection] of [["lexical", undefined], ["changedPaths", changed], ["graphAssisted", assisted]]) {
      const sources = input.sources.map((source) => ({ path: source.path, text: source.text, ...(selection ? { selection: selection.hints.get(source.path) } : {}) }));
      const pack = buildContextPack(fixture.task, sources, fixture.budgetBytes);
      const reversed = buildContextPack(fixture.task, [...sources].reverse(), fixture.budgetBytes);
      arms[name] = {
        pack,
        deterministic: JSON.stringify(pack) === JSON.stringify(reversed),
      };
    }
    return { id: fixture.id, task: fixture.task, budgetBytes: fixture.budgetBytes, changedPaths: fixture.changedPaths, arms };
  });
  const body = {
    schema: "solvelang.context.heldout-selection-transcript.v1",
    evaluationId: input.evaluationId,
    repository: input.repository,
    commit: input.commit,
    scope: input.scope,
    answerKeyCommitment: input.answerKeyCommitment,
    publicInputSha256: digest(input),
    sourceCatalogSha256: sourceCatalogSha256(input.sources),
    sources: input.sources,
    graph: {
      sourceSha256: graph.sourceSha256,
      edges: graph.document.edges.length,
      unresolvedRelativeImports: graph.document.limits.unresolvedRelativeImports,
    },
    cases,
    truth: {
      answerKeyPresentInSelectorInput: false,
      answerKeyCommitmentPresentBeforeSelection: true,
      deterministicTranscript: true,
      providerRequests: 0,
      credentialsUsed: false,
      networkDuringSelection: false,
      sourceCodeExecuted: false,
      blindedEvidenceEstablishedByProtocolAlone: false,
    },
  };
  return { ...body, transcriptSha256: digest(body) };
}

export function validateAnswerKey(key, transcript) {
  exactKeys(key, ["schema", "evaluationId", "repository", "commit", "sourceCatalogSha256", "recordClass", "evaluatorId", "cases"], "Heldout answer key");
  assert(key.schema === "solvelang.context.heldout-answer-key.v1", "Unsupported heldout answer-key schema.");
  assert(key.evaluationId === transcript.evaluationId, "Answer key evaluation ID does not match transcript.");
  assert(key.repository === transcript.repository && key.commit === transcript.commit, "Answer key source pin does not match transcript.");
  assert(key.sourceCatalogSha256 === transcript.sourceCatalogSha256, "Answer key source catalog does not match transcript.");
  assert(key.recordClass === "external-heldout" || key.recordClass === "synthetic-test", "Invalid heldout answer-key record class.");
  assert(typeof key.evaluatorId === "string" && key.evaluatorId.length > 0 && key.evaluatorId.length <= 128, "Heldout evaluator ID is required.");
  assert(Array.isArray(key.cases) && key.cases.length === transcript.cases.length, "Answer key must score every holdout case exactly once.");
  const transcriptCases = new Map(transcript.cases.map((fixture) => [fixture.id, fixture]));
  const keyed = new Set();
  const sourceByPath = new Map(transcript.sources.map((source) => [source.path, source]));
  for (const fixture of key.cases) {
    exactKeys(fixture, ["id", "requiredEvidence", "minPathPrecision"], "Heldout answer-key case");
    assert(transcriptCases.has(fixture.id) && !keyed.has(fixture.id), "Unknown or duplicate answer-key case ID.");
    keyed.add(fixture.id);
    assert(fixture.requiredEvidence && typeof fixture.requiredEvidence === "object" && !Array.isArray(fixture.requiredEvidence), "Heldout required evidence must be an object.");
    const evidence = Object.entries(fixture.requiredEvidence);
    assert(evidence.length > 0 && evidence.length <= 32, "Heldout required evidence must not be empty.");
    for (const [p, needles] of evidence) {
      canonicalPath(p, "Heldout evidence path");
      const source = sourceByPath.get(p);
      assert(source, "Heldout evidence path is absent from the transcript corpus.");
      assert(Array.isArray(needles) && needles.length > 0 && needles.length <= 32 && new Set(needles).size === needles.length, "Invalid heldout evidence needles.");
      assert(needles.every((needle) => typeof needle === "string" && byteLength(needle) > 0 && byteLength(needle) <= 4096 && source.text.includes(needle)), "Heldout evidence must exist verbatim in the pinned source corpus.");
    }
    assert(Number.isFinite(fixture.minPathPrecision) && fixture.minPathPrecision > 0 && fixture.minPathPrecision <= 1, "Invalid heldout precision threshold.");
  }
  assert(answerKeyCommitment(key) === transcript.answerKeyCommitment, "Revealed answer key does not match the pre-selection commitment.");
  return key;
}

export function scoreHeldoutSelection(transcript, rawKey) {
  assert(transcript?.schema === "solvelang.context.heldout-selection-transcript.v1", "Unsupported heldout transcript schema.");
  const { transcriptSha256, ...body } = transcript;
  assert(typeof transcriptSha256 === "string" && transcriptSha256 === digest(body), "Heldout transcript identity mismatch.");
  assert(transcript.truth?.answerKeyPresentInSelectorInput === false && transcript.truth?.answerKeyCommitmentPresentBeforeSelection === true, "Heldout transcript does not prove key separation.");
  const key = validateAnswerKey(rawKey, transcript);
  const keyed = new Map(key.cases.map((fixture) => [fixture.id, fixture]));
  const cases = transcript.cases.map((fixture) => {
    const answer = keyed.get(fixture.id);
    const scoringFixture = { budgetBytes: fixture.budgetBytes, requiredEvidence: answer.requiredEvidence, minPathPrecision: answer.minPathPrecision };
    const arms = {};
    for (const [name, arm] of Object.entries(fixture.arms)) {
      const score = scorePack(arm.pack, scoringFixture, transcript.sources);
      arms[name] = { ...score, deterministic: arm.deterministic };
    }
    const qualityNonRegression = arms.graphAssisted.evidenceRecall >= arms.lexical.evidenceRecall
      && arms.graphAssisted.evidenceRecall >= arms.changedPaths.evidenceRecall;
    return {
      id: fixture.id,
      arms,
      qualityNonRegression,
      pass: arms.graphAssisted.pass && qualityNonRegression && Object.values(arms).every((arm) => arm.deterministic && arm.exactIntegrity && arm.budgetRespected),
    };
  });
  return {
    schema: "solvelang.context.heldout-score-report.v1",
    evaluationId: transcript.evaluationId,
    transcriptSha256,
    answerKeyCommitment: transcript.answerKeyCommitment,
    recordClass: key.recordClass,
    evaluatorId: key.evaluatorId,
    truth: {
      answerKeyMatchedPreSelectionCommitment: true,
      answerKeyAbsentFromSelectorInput: true,
      deterministicTranscript: transcript.truth.deterministicTranscript === true,
      syntheticEvidence: key.recordClass === "synthetic-test",
      externalHeldoutRecordClass: key.recordClass === "external-heldout",
      genuinelyBlindedEvidenceEstablished: false,
      independentEvaluatorAttestationRequired: true,
      providerTokens: null,
      agentTaskSuccess: null,
      externalCompetitorMeasured: false,
      publicationAuthorized: false,
    },
    cases,
    aggregate: {
      caseCount: cases.length,
      pass: cases.every((fixture) => fixture.pass),
    },
  };
}

async function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    assert(total <= MAX_STDIN_BYTES, "Heldout stdin exceeds the byte bound.");
    chunks.push(chunk);
  }
  assert(total > 0, "Heldout stdin is empty.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const mode = process.argv[2];
  assert(mode === "select" || mode === "score", "Usage: context-heldout-eval.mjs select|score");
  assert(process.argv.length === 3, "Heldout evaluator accepts no file, URL, or credential arguments.");
  const input = await readBoundedStdin();
  const result = mode === "select"
    ? runHeldoutSelection(input)
    : (() => {
        exactKeys(input, ["transcript", "answerKey"], "Heldout score input");
        return scoreHeldoutSelection(input.transcript, input.answerKey);
      })();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (mode === "score" && !result.aggregate.pass) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("context-heldout-eval.mjs")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
