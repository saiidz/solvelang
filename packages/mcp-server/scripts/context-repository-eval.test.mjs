import assert from "node:assert/strict";
import test from "node:test";
import { buildContextPack, sha256Text } from "../dist/src/context-pack.js";
import { evaluateRepositoryCorpus, gitBlobSha1, pinnedImportGraph, scorePack, validateCorpus, loadRepositoryCorpus } from "./run-context-repository-evals.mjs";

const original = await loadRepositoryCorpus();
const copy = () => structuredClone(original);
const selected = (path, text) => ({ path, text, selection: { score: 64, reasons: ["graph:dependency:imports:fixture-edge"] } });

// These assertions pin the reviewed benchmark, rather than trusting editable thresholds alone.
test("real-source corpus is pinned to six verified blobs and four independent task annotations", () => {
  assert.equal(original.repository, "saiidz/solvelang");
  assert.equal(original.commit, "c36f2b18e3393b8174943e01b79d56c65ce83c58");
  assert.equal(original.sources.length, 6);
  assert.equal(original.cases.length, 4);
  assert.equal(original.sources.reduce((sum, source) => sum + Buffer.byteLength(source.text), 0), 17829);
  assert.equal(validateCorpus(copy()).sources.length, 6);
});

test("all graph-assisted cases preserve required evidence without rounding quality gates", () => {
  const report = evaluateRepositoryCorpus(copy());
  assert.equal(report.aggregate.pass, true);
  assert.equal(report.aggregate.caseCount, 4);
  for (const fixture of report.cases) {
    assert.equal(fixture.pass, true, fixture.id);
    assert.equal(fixture.arms.graphAssisted.evidenceRecall, 1);
    assert.equal(fixture.arms.graphAssisted.pathRecall, 1);
    for (const arm of Object.values(fixture.arms)) {
      assert.equal(arm.exactIntegrity, true);
      assert.equal(arm.budgetRespected, true);
      assert.equal(arm.deterministic, true);
      assert.ok(arm.serializedPackBytes >= arm.excerptBytes);
      assert.ok(Number.isFinite(arm.packLatencyMs) && arm.packLatencyMs >= 0);
    }
  }
  const boundary = report.cases.find((fixture) => fixture.id === "context-path-boundary");
  assert.equal(boundary.arms.lexical.evidenceRecall, 0.5);
  assert.equal(boundary.arms.changedPaths.evidenceRecall, 0.5);
  assert.equal(boundary.arms.graphAssisted.evidenceRecall, 1);
});

test("measurements never masquerade as provider tokens, cache reuse, or actual agent success", () => {
  const { truth } = evaluateRepositoryCorpus(copy());
  assert.equal(truth.providerTokens, null);
  assert.equal(truth.providerCacheReuse, null);
  assert.equal(truth.agentTaskSuccess, null);
  assert.equal(truth.wholeRepositoryMeasured, false);
  assert.equal(truth.byteReductionIsNotTokenSavings, true);
  assert.equal(truth.providerRequests, 0);
  assert.equal(truth.snapshotCodeExecuted, false);
});

test("byte drift is rejected before context construction", () => {
  const corpus = copy();
  corpus.sources[0].text += "\nchanged\n";
  assert.throws(() => evaluateRepositoryCorpus(corpus), /hash mismatch/);
  corpus.sources[0].sha256 = sha256Text(corpus.sources[0].text);
  assert.throws(() => evaluateRepositoryCorpus(corpus), /hash mismatch/);
});

test("empty, duplicate, malformed, and oversized corpus inputs fail closed", () => {
  for (const mutate of [
    (c) => { c.sources = []; },
    (c) => { c.sources.push(c.sources[0]); },
    (c) => { c.cases = []; },
    (c) => { c.cases.push(c.cases[0]); },
    (c) => { c.commit = "main"; },
    (c) => { c.sources[0].text = "x".repeat(128 * 1024 + 1); },
    (c) => { c.cases[0].requiredEvidence = {}; },
    (c) => { c.cases[0].budgetBytes = NaN; },
    (c) => { c.cases[0].minPathPrecision = 0; },
    (c) => { c.cases[0].changedPaths = ["src/not-in-corpus.ts"]; },
    (c) => { c.cases[0].requiredEvidence["src/not-in-corpus.ts"] = ["imagined"]; },
  ]) {
    const corpus = copy(); mutate(corpus);
    assert.throws(() => evaluateRepositoryCorpus(corpus));
  }
});

test("noncanonical and escape paths cannot be introduced by corpus data", () => {
  for (const invalid of ["../outside.ts", "/tmp/outside.ts", "C:outside.ts", "C:/outside.ts", "./file.ts", "dir\\file.ts", "bad\0file.ts"]) {
    const corpus = copy(); corpus.sources[0].path = invalid;
    assert.throws(() => evaluateRepositoryCorpus(corpus));
  }
});

test("Unicode uses UTF-8 bytes for both hashes and rejects unpaired surrogates", () => {
  const text = "export const greeting = 'é🐈';\n";
  assert.notEqual(Buffer.byteLength(text), text.length);
  assert.match(gitBlobSha1(text), /^[a-f0-9]{40}$/);
  const corpus = copy();
  corpus.sources[0].text += "\ud800";
  corpus.sources[0].sha256 = sha256Text(corpus.sources[0].text);
  corpus.sources[0].gitBlobSha1 = gitBlobSha1(corpus.sources[0].text);
  assert.throws(() => evaluateRepositoryCorpus(corpus), /UTF-8/);
});

test("import graph includes only three resolved literal edges and reports two missing targets", () => {
  const graph = pinnedImportGraph(copy());
  assert.equal(graph.document.edges.length, 3);
  assert.equal(graph.document.limits.unresolvedRelativeImports, 2);
  assert.equal(graph.document.execution.networkAccess, false);
  assert.equal(graph.document.execution.writeAccess, false);
  for (const edge of graph.document.edges) {
    assert.equal(edge.kind, "imports");
    for (const evidence of edge.evidence) {
      const source = original.sources.find((source) => source.path === evidence.path);
      assert.equal(source.sha256, evidence.sourceSha256);
      assert.ok(source.text.split("\n")[evidence.line - 1].includes(evidence.literal));
    }
  }
});

test("source reordering preserves the graph identity and all pack identities", () => {
  const corpus = copy(); corpus.sources.reverse();
  assert.deepEqual(pinnedImportGraph(corpus), pinnedImportGraph(original));
  const first = evaluateRepositoryCorpus(original);
  const second = evaluateRepositoryCorpus(corpus);
  assert.deepEqual(second.cases.map((c) => Object.values(c.arms).map((a) => a.packId)), first.cases.map((c) => Object.values(c.arms).map((a) => a.packId)));
});

test("an insufficient budget reports missed evidence instead of celebrating byte reduction", () => {
  const corpus = copy(); corpus.cases[0].budgetBytes = 1024;
  const report = evaluateRepositoryCorpus(corpus);
  assert.equal(report.aggregate.pass, false);
  assert.equal(report.cases[0].pass, false);
  assert.ok(report.cases[0].arms.graphAssisted.missingEvidence.length > 0);
});

test("scoring refuses corrupted exact excerpt identities", () => {
  const fixture = original.cases[2];
  const pack = buildContextPack(fixture.task, original.sources, fixture.budgetBytes);
  pack.entries[0].excerptSha256 = "0".repeat(64);
  const score = scorePack(pack, fixture, original.sources);
  assert.equal(score.exactIntegrity, false);
  assert.equal(score.pass, false);
});

test("graph-only selection reaches implementation after a long header without executing source", () => {
  const text = "// header\n".repeat(30) + 'export function verifyPath(input) {\n  if (input.includes("..")) throw new Error("denied");\n  return input;\n}\n';
  const pack = buildContextPack("unmatched_task_word", [selected("src/helper.ts", text)], 1024);
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].startLine, 31);
  assert.match(pack.entries[0].content, /input.includes/);
  assert.ok(pack.entries[0].reasons.includes("selection:declaration-text-window"));
  assert.equal(pack.entries[0].sourceSha256, sha256Text(text));
  assert.deepEqual(buildContextPack("unmatched_task_word", [{ path: "src/helper.ts", text }], 1024).entries, []);
});

test("declaration fallback windows are bounded and cannot overlap adjacent declarations", () => {
  const text = 'export function first() {\n' + "  // implementation\n".repeat(40) + '}\nexport async function second() {\n  return 2;\n}\n';
  const pack = buildContextPack("unmatched_task_word", [selected("src/helper.ts", text)], 2048);
  assert.equal(pack.entries.length, 2);
  for (const entry of pack.entries) assert.ok(entry.endLine - entry.startLine + 1 <= 24);
  assert.ok(pack.entries[0].endLine < pack.entries[1].startLine);
  assert.equal(pack.entries[0].endLine, 24);
});

test("non-declaration sources retain the original header fallback", () => {
  const text = "// export function notADeclaration() {}\n".repeat(20);
  const pack = buildContextPack("unmatched_task_word", [selected("src/header.ts", text)], 1024);
  assert.equal(pack.entries[0].startLine, 1);
  assert.equal(pack.entries[0].endLine, 9);
  assert.ok(!pack.entries[0].reasons.includes("selection:declaration-text-window"));
});

test("lexical matches keep their existing context-window behavior", () => {
  const text = "// header\n".repeat(20) + "export function target() {\n  return 'search_marker';\n}\n";
  const plain = buildContextPack("search_marker", [{ path: "src/file.ts", text }], 1024);
  const hinted = buildContextPack("search_marker", [selected("src/file.ts", text)], 1024);
  assert.deepEqual(hinted.entries.map((entry) => [entry.startLine, entry.endLine, entry.content]), plain.entries.map((entry) => [entry.startLine, entry.endLine, entry.content]));
  assert.ok(!hinted.entries[0].reasons.includes("selection:declaration-text-window"));
});

test("candidate omissions stay visible when declaration windows exceed the budget", () => {
  const text = Array.from({ length: 80 }, (_, i) => `export function member${i}() {\n  return '${"x".repeat(60)}';\n}\n`).join("");
  const pack = buildContextPack("unmatched_task_word", [selected("src/functions.ts", text)], 1024);
  assert.equal(pack.selectedBytes, 1024);
  assert.equal(pack.truncated, true);
  // Omission counts now describe final fragments, not the original 80 windows.
  // Pin the actual ranges and content so fragmentation cannot hide lost evidence.
  assert.deepEqual(pack.entries.map((entry) => [entry.startLine, entry.endLine]), [
    ...Array.from({ length: 10 }, (_, i) => [i * 3 + 1, i * 3 + 3]),
    [33, 33], [36, 36], [39, 39], [42, 42],
  ]);
  assert.equal(pack.omittedCandidates, 74);
  const lines = text.split("\n");
  for (const entry of pack.entries) {
    assert.equal(entry.content, lines.slice(entry.startLine - 1, entry.endLine).join("\n"));
    assert.equal(entry.sourceSha256, sha256Text(text));
    assert.equal(entry.excerptSha256, sha256Text(entry.content));
    assert.equal(entry.bytes, Buffer.byteLength(entry.content));
    assert.ok(entry.reasons.includes("selection:declaration-text-window"));
  }
  assert.equal(pack.entries.reduce((sum, entry) => sum + entry.bytes, 0), pack.selectedBytes);
});
