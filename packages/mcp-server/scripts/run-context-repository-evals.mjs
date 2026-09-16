import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildContextPack, contextEntryHandle, sha256Text } from "../dist/src/context-pack.js";
import { buildContextSelection, normalizeContextSelectionPath } from "../dist/src/context-selection.js";

const MAX_CORPUS_BYTES = 2 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byteLength = (text) => Buffer.byteLength(text, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const gitBlobSha1 = (text) => createHash("sha1").update(`blob ${byteLength(text)}\0`).update(text, "utf8").digest("hex");

function sourcePath(value) {
  assert(typeof value === "string" && normalizeContextSelectionPath(value) === value, "Corpus paths must be canonical and relative.");
  return value;
}

/** Validate only data. Snapshot text is never imported, evaluated, or written to the workspace. */
export function validateCorpus(corpus) {
  assert(corpus?.schema === "solvelang.context.repository-corpus.v1", "Unsupported repository corpus schema.");
  assert(typeof corpus.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(corpus.repository), "Invalid repository identity.");
  assert(typeof corpus.commit === "string" && /^[a-f0-9]{40}$/.test(corpus.commit), "Corpus needs an exact commit pin.");
  assert(corpus.license === "MIT", "Corpus license must be reviewed.");
  assert(typeof corpus.scope === "string" && corpus.scope.length > 0 && corpus.scope.length <= 512, "Corpus scope is required.");
  assert(Array.isArray(corpus.sources) && corpus.sources.length > 0 && corpus.sources.length <= 32, "Corpus source count is invalid.");
  const paths = new Set();
  let totalBytes = 0;
  for (const source of corpus.sources) {
    assert(source && typeof source === "object", "Invalid corpus source.");
    sourcePath(source.path);
    assert(!paths.has(source.path), "Duplicate corpus source path.");
    paths.add(source.path);
    assert(typeof source.text === "string" && byteLength(source.text) > 0 && byteLength(source.text) <= 128 * 1024, "Corpus source text is out of bounds.");
    // Reject unpaired surrogates rather than hashing a silently repaired UTF-8 replacement character.
    assert(Buffer.from(source.text, "utf8").toString("utf8") === source.text, "Corpus text must roundtrip through UTF-8.");
    assert(source.sha256 === sha256Text(source.text) && source.gitBlobSha1 === gitBlobSha1(source.text), "Corpus source hash mismatch.");
    totalBytes += byteLength(source.text);
  }
  assert(totalBytes <= MAX_CORPUS_BYTES, "Corpus exceeds the total byte bound.");
  assert(Array.isArray(corpus.cases) && corpus.cases.length > 0 && corpus.cases.length <= 32, "Corpus case count is invalid.");
  const ids = new Set();
  for (const fixture of corpus.cases) {
    assert(typeof fixture?.id === "string" && /^[a-z0-9-]{1,80}$/.test(fixture.id) && !ids.has(fixture.id), "Invalid or duplicate case ID.");
    ids.add(fixture.id);
    assert(typeof fixture.task === "string" && byteLength(fixture.task) > 0 && byteLength(fixture.task) <= 16 * 1024, "Invalid case task.");
    assert(Number.isSafeInteger(fixture.budgetBytes) && fixture.budgetBytes >= 1024 && fixture.budgetBytes <= 512 * 1024, "Invalid case budget.");
    assert(Array.isArray(fixture.changedPaths) && fixture.changedPaths.length > 0 && fixture.changedPaths.length <= 32, "Invalid changed paths.");
    assert(new Set(fixture.changedPaths).size === fixture.changedPaths.length && fixture.changedPaths.every((p) => paths.has(sourcePath(p))), "Changed path missing from corpus or duplicated.");
    assert(fixture.requiredEvidence && typeof fixture.requiredEvidence === "object" && !Array.isArray(fixture.requiredEvidence), "Required evidence must be an object.");
    const evidence = Object.entries(fixture.requiredEvidence);
    assert(evidence.length > 0 && evidence.length <= 32, "Required evidence must not be empty.");
    for (const [p, needles] of evidence) {
      assert(paths.has(sourcePath(p)), "Required evidence source missing from corpus.");
      assert(Array.isArray(needles) && needles.length > 0 && needles.length <= 32 && new Set(needles).size === needles.length, "Invalid evidence needles.");
      const text = corpus.sources.find((source) => source.path === p).text;
      assert(needles.every((needle) => typeof needle === "string" && needle.length > 0 && byteLength(needle) <= 4096 && text.includes(needle)), "Required evidence must exist verbatim in its source.");
    }
    assert(Number.isFinite(fixture.minPathPrecision) && fixture.minPathPrecision > 0 && fixture.minPathPrecision <= 1, "Invalid precision threshold.");
  }
  return corpus;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => sha256Text(JSON.stringify(canonical(value)));

function resolvePinnedImport(byPath, resolved) {
  const exact = byPath.get(resolved);
  if (exact) return exact;

  // Preserve the existing JS-specifier to pinned TypeScript-source fallback.
  if (resolved.endsWith(".js")) return byPath.get(`${resolved.slice(0, -3)}.ts`);

  // For extensionless relative ESM imports, resolve only against a small,
  // deterministic allowlist of paths that already exist in the validated
  // pinned corpus. This performs no filesystem lookup, package resolution,
  // network access, or source execution.
  if (path.posix.extname(resolved)) return undefined;
  for (const candidate of [
    `${resolved}.js`,
    `${resolved}.ts`,
    `${resolved}/index.js`,
    `${resolved}/index.ts`,
  ]) {
    const target = byPath.get(candidate);
    if (target) return target;
  }
  return undefined;
}

/** Only literal relative imports present in the pinned subset become graph edges. No filesystem/package resolver or source execution. */
export function pinnedImportGraph(corpus) {
  const schema = "solvelang.graph.v0";
  const nodes = corpus.sources.map((source) => ({
    id: `sgn_${digest({ schema, kind: "file", identity: source.path }).slice(0, 32)}`,
    kind: "file", identity: source.path, label: source.path,
    evidence: [{ path: source.path, sourceSha256: source.sha256 }], metadata: { path: source.path },
  })).sort((a, b) => compare(a.id, b.id));
  const byPath = new Map(nodes.map((node) => [node.metadata.path, node]));
  const edges = new Map();
  let unresolvedRelativeImports = 0;
  for (const source of [...corpus.sources].sort((a, b) => compare(a.path, b.path))) {
    const lines = source.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      // Deliberately narrow: one-line import ... from or the final line of a multiline import.
      const match = lines[index].match(/^\s*(?:import\s+[^;]*|})\s+from\s+["'](\.{1,2}\/[^"']+)["'];?\s*$/);
      if (!match) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), match[1]));
      const target = resolvePinnedImport(byPath, resolved);
      if (!target) { unresolvedRelativeImports += 1; continue; }
      const from = byPath.get(source.path).id;
      const kind = "imports";
      const id = `sge_${digest({ schema, kind, from, to: target.id, qualifier: "" }).slice(0, 32)}`;
      if (!edges.has(id)) edges.set(id, { id, kind, from, to: target.id, evidence: [] });
      edges.get(id).evidence.push({ path: source.path, line: index + 1, sourceSha256: source.sha256, literal: match[1] });
    }
  }
  const source = { fingerprint: digest(corpus.sources.map(({ path: p, sha256 }) => [p, sha256]).sort(([a], [b]) => compare(a, b))) };
  const engine = { name: "pinned-relative-import-eval", version: "1.0.0", deterministic: true };
  const extractors = [];
  const limits = { subsetOnly: true, maxDepth: 1, unresolvedRelativeImports };
  const body = {
    schema,
    graphId: `sg_${digest({ schema, sourceFingerprint: source.fingerprint, engineVersion: engine.version, extractors, limits }).slice(0, 32)}`,
    mode: "analyze-only", engine, source, extractors, limits,
    execution: { networkAccess: false, writeAccess: false },
    nodes, edges: [...edges.values()].sort((a, b) => compare(a.id, b.id)),
    integrity: { stableIds: true, ordering: "id-ascending" },
  };
  const document = { ...body, integrity: { ...body.integrity, canonicalJsonSha256: `sha256:${digest(body)}` } };
  return { path: "context-repository-eval.graph.json", sourceSha256: sha256Text(JSON.stringify(document)), document };
}

export function scorePack(pack, fixture, sources) {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const selectedPaths = [...new Set(pack.entries.map((entry) => entry.path))].sort(compare);
  const requiredPaths = Object.keys(fixture.requiredEvidence).sort(compare);
  const relevantCount = selectedPaths.filter((p) => requiredPaths.includes(p)).length;
  const missingEvidence = [];
  let evidenceRequired = 0;
  for (const [p, needles] of Object.entries(fixture.requiredEvidence)) {
    for (const needle of needles) {
      evidenceRequired += 1;
      // A needle must exist in one exact excerpt, never across a fabricated join of disjoint ranges.
      if (!pack.entries.some((entry) => entry.path === p && entry.content.includes(needle))) missingEvidence.push({ path: p, needle });
    }
  }
  const excerptBytes = pack.entries.reduce((total, entry) => total + byteLength(entry.content), 0);
  const exactIntegrity = pack.entries.every((entry) => {
    const source = byPath.get(entry.path);
    return source && Number.isSafeInteger(entry.startLine) && entry.startLine >= 1
      && Number.isSafeInteger(entry.endLine) && entry.endLine >= entry.startLine
      && entry.endLine <= source.text.replace(/\r\n/g, "\n").split("\n").length
      && source.sha256 === entry.sourceSha256 && sha256Text(entry.content) === entry.excerptSha256
      && byteLength(entry.content) === entry.bytes
      && source.text.replace(/\r\n/g, "\n").split("\n").slice(entry.startLine - 1, entry.endLine).join("\n") === entry.content
      && contextEntryHandle(entry.path, entry.sourceSha256, entry.startLine, entry.endLine, entry.excerptSha256) === entry.handle;
  });
  const corpusBytes = sources.reduce((total, source) => total + byteLength(source.text), 0);
  const pathRecall = relevantCount / requiredPaths.length;
  const pathPrecision = selectedPaths.length ? relevantCount / selectedPaths.length : 0;
  const evidenceRecall = 1 - missingEvidence.length / evidenceRequired;
  const budgetRespected = pack.budgetBytes === fixture.budgetBytes && excerptBytes === pack.selectedBytes && excerptBytes <= fixture.budgetBytes;
  return {
    packId: pack.packId, selectedPaths, missingEvidence,
    pathRecall, pathPrecision, evidenceRecall, exactIntegrity, budgetRespected,
    excerptBytes, serializedPackBytes: byteLength(JSON.stringify(pack)), corpusBytes,
    excerptByteReductionPercent: 100 * (1 - excerptBytes / corpusBytes),
    packTruncated: pack.truncated, omittedCandidates: pack.omittedCandidates,
    pass: pathRecall === 1 && evidenceRecall === 1 && pathPrecision >= fixture.minPathPrecision && exactIntegrity && budgetRespected,
  };
}

export function evaluateRepositoryCorpus(input) {
  const corpus = validateCorpus(input);
  const graph = pinnedImportGraph(corpus);
  const cases = corpus.cases.map((fixture) => {
    const changed = buildContextSelection(fixture.changedPaths);
    const assisted = buildContextSelection(fixture.changedPaths, graph);
    const arms = {};
    for (const [name, selection] of [["lexical", undefined], ["changedPaths", changed], ["graphAssisted", assisted]]) {
      const sources = corpus.sources.map((source) => ({ path: source.path, text: source.text, ...(selection ? { selection: selection.hints.get(source.path) } : {}) }));
      const started = performance.now();
      const pack = buildContextPack(fixture.task, sources, fixture.budgetBytes);
      const packLatencyMs = performance.now() - started;
      const reversed = buildContextPack(fixture.task, [...sources].reverse(), fixture.budgetBytes);
      arms[name] = { ...scorePack(pack, fixture, corpus.sources), packLatencyMs, deterministic: JSON.stringify(pack) === JSON.stringify(reversed) };
    }
    const qualityNonRegression = arms.graphAssisted.evidenceRecall >= arms.lexical.evidenceRecall
      && arms.graphAssisted.evidenceRecall >= arms.changedPaths.evidenceRecall;
    return { id: fixture.id, task: fixture.task, budgetBytes: fixture.budgetBytes, arms, qualityNonRegression,
      pass: arms.graphAssisted.pass && qualityNonRegression && Object.values(arms).every((arm) => arm.deterministic && arm.exactIntegrity && arm.budgetRespected) };
  });
  return {
    schema: "solvelang.context.repository-eval-report.v1",
    corpus: { repository: corpus.repository, commit: corpus.commit, sourceCount: corpus.sources.length,
      sourceBytes: corpus.sources.reduce((sum, source) => sum + byteLength(source.text), 0),
      corpusSha256: digest(corpus), scope: corpus.scope },
    truth: {
      corpusKind: "pinned real-source subset", wholeRepositoryMeasured: false,
      relevanceLabels: "manually annotated evidence proxies, not agent task success",
      byteReductionIsNotTokenSavings: true, serializedPackBytesIncludeMetadata: true,
      latencyScope: "one local pure pack construction per arm; not provider or end-to-end latency",
      providerTokens: null, providerCacheReuse: null, agentTaskSuccess: null, externalCompetitorMeasured: false,
      credentialsUsed: false, providerRequests: 0, snapshotCodeExecuted: false,
    },
    graph: { edges: graph.document.edges.length, unresolvedRelativeImports: graph.document.limits.unresolvedRelativeImports,
      snapshotSha256: graph.sourceSha256, scope: "narrow literal relative imports within pinned subset; not complete repository analysis" },
    cases,
    aggregate: { caseCount: cases.length, pass: cases.every((fixture) => fixture.pass) },
  };
}

/** Read only the fixed manifest and hash-named plain-text snapshots, never live workspace sources. */
export async function loadRepositoryCorpus() {
  const manifestUrl = new URL("../benchmarks/context-repository-v1.json", import.meta.url);
  const manifestStat = await lstat(manifestUrl);
  assert(manifestStat.isFile() && manifestStat.size <= MAX_CORPUS_BYTES, "Invalid corpus manifest file.");
  const bytes = await readFile(manifestUrl);
  assert(bytes.length <= MAX_CORPUS_BYTES, "Corpus file exceeds the byte bound.");
  const corpus = JSON.parse(bytes.toString("utf8"));
  assert(Array.isArray(corpus.sources) && corpus.sources.length > 0 && corpus.sources.length <= 32, "Corpus source count is invalid.");
  const snapshotDirectory = new URL("../benchmarks/repository-snapshots/", import.meta.url);
  assert((await lstat(snapshotDirectory)).isDirectory(), "Snapshot directory must not be a symlink.");
  for (const source of corpus.sources) {
    assert(typeof source.gitBlobSha1 === "string" && /^[a-f0-9]{40}$/.test(source.gitBlobSha1), "Invalid snapshot blob identity.");
    sourcePath(source.path);
    const snapshotUrl = new URL(`${source.gitBlobSha1}.txt`, snapshotDirectory);
    const stat = await lstat(snapshotUrl);
    assert(stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024, "Invalid snapshot file.");
    const snapshot = await readFile(snapshotUrl);
    assert(snapshot.length > 0 && snapshot.length <= 128 * 1024, "Snapshot exceeds the byte bound.");
    source.text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot);
  }
  return validateCorpus(corpus);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Fixed checked-in data only; no arbitrary file/URL arguments or source execution.
  const report = evaluateRepositoryCorpus(await loadRepositoryCorpus());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.aggregate.pass) process.exitCode = 1;
}
