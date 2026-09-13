import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildContextPack,
  contextEntryHandle,
  sha256Text,
} from "../dist/src/context-pack.js";
import {
  createContextHandoff,
  validateContextHandoff,
} from "../dist/src/context-handoff.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, "..");
const suitePath = path.join(packageRoot, "benchmarks", "context-v0.json");
const suite = JSON.parse(await readFile(suitePath, "utf8"));

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function expandSource(source) {
  if (typeof source.path !== "string" || source.path.length === 0) throw new Error("Eval source path must be non-empty.");
  if (typeof source.text === "string") return { path: source.path, text: source.text };
  if (
    source.repeat
    && typeof source.repeat.text === "string"
    && Number.isInteger(source.repeat.count)
    && source.repeat.count >= 1
    && source.repeat.count <= 10_000
  ) {
    return { path: source.path, text: source.repeat.text.repeat(source.repeat.count) };
  }
  throw new Error(`Eval source ${source.path} must define text or a bounded repeat fixture.`);
}

function entryIntegrity(entry, sourceByPath) {
  const source = sourceByPath.get(entry.path);
  if (!source) return false;
  if (sha256Text(source.text) !== entry.sourceSha256) return false;
  if (sha256Text(entry.content) !== entry.excerptSha256) return false;
  const lines = source.text.replace(/\r\n/g, "\n").split("\n");
  const exactExcerpt = lines.slice(entry.startLine - 1, entry.endLine).join("\n");
  if (exactExcerpt !== entry.content) return false;
  return contextEntryHandle(
    entry.path,
    entry.sourceSha256,
    entry.startLine,
    entry.endLine,
    entry.excerptSha256,
  ) === entry.handle;
}

function evaluateCase(fixture, thresholds) {
  const sources = fixture.sources.map(expandSource);
  const sourceByPath = new Map(sources.map((source) => [source.path, source]));
  const pack = buildContextPack(fixture.task, sources, fixture.budgetBytes);
  const reversedPack = buildContextPack(fixture.task, [...sources].reverse(), fixture.budgetBytes);
  const selectedPaths = [...new Set(pack.entries.map((entry) => entry.path))].sort();
  const requiredPaths = Object.keys(fixture.requiredEvidence).sort();
  const requiredPathSet = new Set(requiredPaths);
  const forbiddenPathSet = new Set(fixture.forbiddenPaths ?? []);
  const selectedRequiredPaths = selectedPaths.filter((selectedPath) => requiredPathSet.has(selectedPath));
  const forbiddenSelectedPaths = selectedPaths.filter((selectedPath) => forbiddenPathSet.has(selectedPath));

  let evidenceFound = 0;
  let evidenceRequired = 0;
  const missingEvidence = [];
  for (const [requiredPath, needles] of Object.entries(fixture.requiredEvidence)) {
    const selectedText = pack.entries
      .filter((entry) => entry.path === requiredPath)
      .map((entry) => entry.content)
      .join("\n");
    for (const needle of needles) {
      evidenceRequired += 1;
      if (selectedText.includes(needle)) evidenceFound += 1;
      else missingEvidence.push({ path: requiredPath, needle });
    }
  }

  const corpusBytes = sources.reduce((total, source) => total + Buffer.byteLength(source.text, "utf8"), 0);
  const selectedBytes = pack.selectedBytes;
  const byteReductionPercent = corpusBytes === 0 ? 0 : 100 * (1 - selectedBytes / corpusBytes);
  const pathRecall = requiredPaths.length === 0 ? 1 : selectedRequiredPaths.length / requiredPaths.length;
  const pathPrecision = selectedPaths.length === 0 ? (requiredPaths.length === 0 ? 1 : 0) : selectedRequiredPaths.length / selectedPaths.length;
  const evidenceRecall = evidenceRequired === 0 ? 1 : evidenceFound / evidenceRequired;
  const deterministic = JSON.stringify(pack) === JSON.stringify(reversedPack);
  const exactIntegrity = pack.entries.every((entry) => entryIntegrity(entry, sourceByPath));
  const pass = pathRecall >= thresholds.minPathRecall
    && pathPrecision >= thresholds.minPathPrecision
    && evidenceRecall >= thresholds.minEvidenceRecall
    && forbiddenSelectedPaths.length === 0
    && (!thresholds.requireDeterminism || deterministic)
    && (!thresholds.requireExactIntegrity || exactIntegrity);

  return {
    id: fixture.id,
    category: fixture.category,
    pass,
    corpusBytes,
    selectedBytes,
    byteReductionPercent: round(byteReductionPercent),
    pathRecall: round(pathRecall, 4),
    pathPrecision: round(pathPrecision, 4),
    evidenceRecall: round(evidenceRecall, 4),
    requiredPaths,
    selectedPaths,
    missingRequiredPaths: requiredPaths.filter((requiredPath) => !selectedPaths.includes(requiredPath)),
    forbiddenSelectedPaths,
    missingEvidence,
    deterministic,
    exactIntegrity,
    packTruncated: pack.truncated,
    omittedCandidates: pack.omittedCandidates,
  };
}

async function writeWorkspace(root, sources) {
  for (const source of sources) {
    const absolutePath = path.join(root, ...source.path.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, source.text, "utf8");
  }
}

async function evaluateHandoff(fixture) {
  if (!fixture?.handoff) return { present: false, pass: false };
  const sources = fixture.sources.map(expandSource);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-eval-"));
  const previousWorkspaceRoot = process.env.SOLVELANG_WORKSPACE_ROOT;
  try {
    await writeWorkspace(temporaryRoot, sources);
    process.env.SOLVELANG_WORKSPACE_ROOT = temporaryRoot;
    const pack = buildContextPack(fixture.task, sources, fixture.budgetBytes);
    const handoff = await createContextHandoff({
      fromAgent: fixture.handoff.fromAgent,
      toAgent: fixture.handoff.toAgent,
      goal: fixture.task,
      decisions: ["Use the selected exact context references instead of rereading the full synthetic corpus."],
      unresolvedQuestions: ["Revalidate freshness before continuing the task."],
      changedPaths: fixture.handoff.changedPaths,
      tests: [{ label: "offline context eval", status: "passed", evidence: "selection gates passed before handoff creation" }],
      context: pack.entries,
    });

    const allowedReferenceKeys = ["endLine", "excerptSha256", "handle", "path", "sourceSha256", "startLine"];
    const sourceBodyFree = handoff.context.every((reference) => {
      const keys = Object.keys(reference).sort();
      return JSON.stringify(keys) === JSON.stringify(allowedReferenceKeys) && !("content" in reference);
    });
    const fresh = await validateContextHandoff(handoff);

    const changedPath = fixture.handoff.changedPaths[0];
    const changedSource = sources.find((source) => source.path === changedPath);
    if (!changedSource) throw new Error(`Handoff eval changed path ${changedPath} is missing from sources.`);
    const changedAbsolutePath = path.join(temporaryRoot, ...changedPath.split("/"));
    await writeFile(changedAbsolutePath, `${changedSource.text}\n// solve-context-eval-stale-change\n`, "utf8");
    const stale = await validateContextHandoff(handoff);

    const staleChangedPathDetected = stale.staleChangedSources.some((source) => source.path === changedPath);
    const staleContextDetected = stale.staleContextReferences.some((reference) => reference.path === changedPath);
    const pass = sourceBodyFree
      && fresh.valid
      && fresh.integrityValid
      && fresh.contentFresh
      && stale.integrityValid
      && !stale.contentFresh
      && !stale.valid
      && staleChangedPathDetected
      && staleContextDetected;

    return {
      present: true,
      pass,
      sourceBodyFree,
      freshValid: fresh.valid,
      staleDetected: !stale.contentFresh,
      integrityRetainedAfterWorkspaceChange: stale.integrityValid,
      staleChangedPathDetected,
      staleContextDetected,
    };
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previousWorkspaceRoot;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (suite.schema !== "solvelang.context.eval-suite.v0") throw new Error("Unsupported Solve Context eval suite schema.");
if (!Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error("Solve Context eval suite must contain cases.");

const cases = suite.cases.map((fixture) => evaluateCase(fixture, suite.thresholds));
const handoffFixture = suite.cases.find((fixture) => fixture.handoff);
const handoff = await evaluateHandoff(handoffFixture);
const meanByteReductionPercent = cases.reduce((total, current) => total + current.byteReductionPercent, 0) / cases.length;
const minPathRecall = Math.min(...cases.map((current) => current.pathRecall));
const minPathPrecision = Math.min(...cases.map((current) => current.pathPrecision));
const minEvidenceRecall = Math.min(...cases.map((current) => current.evidenceRecall));
const allCasesPass = cases.every((current) => current.pass);
const thresholdPass = meanByteReductionPercent >= suite.thresholds.minMeanByteReductionPercent;
const handoffPass = !suite.thresholds.requireHandoffFreshness || handoff.pass;

const report = {
  schema: "solvelang.context.eval-report.v0",
  suite: suite.schema,
  truth: {
    corpusBaseline: "synthetic full-corpus UTF-8 bytes",
    selectedMetric: "exact selected excerpt UTF-8 bytes",
    byteReductionIsNotTokenSavings: true,
    providerTokensMeasured: false,
    endToEndAgentTaskSuccessMeasured: false,
    externalCompetitorMeasured: false,
  },
  thresholds: suite.thresholds,
  cases,
  handoff,
  aggregate: {
    caseCount: cases.length,
    allCasesPass,
    minPathRecall: round(minPathRecall, 4),
    minPathPrecision: round(minPathPrecision, 4),
    minEvidenceRecall: round(minEvidenceRecall, 4),
    meanByteReductionPercent: round(meanByteReductionPercent),
    byteReductionThresholdPass: thresholdPass,
    handoffPass,
    pass: allCasesPass && thresholdPass && handoffPass,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.aggregate.pass) process.exitCode = 1;
