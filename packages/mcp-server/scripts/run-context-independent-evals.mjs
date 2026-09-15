import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../dist/src/context-pack.js";
import {
  evaluateRepositoryCorpus,
  gitBlobSha1,
  validateCorpus,
} from "./run-context-repository-evals.mjs";

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_LICENSE_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024;

const CORPORA = [
  {
    id: "axios",
    manifest: new URL("../benchmarks/independent/axios-v1.json", import.meta.url),
    snapshots: new URL("../benchmarks/independent/axios-snapshots/", import.meta.url),
    license: new URL("../benchmarks/independent/LICENSE-axios.txt", import.meta.url),
    licenseFile: "LICENSE-axios.txt",
  },
  {
    id: "chalk",
    manifest: new URL("../benchmarks/independent/chalk-v1.json", import.meta.url),
    snapshots: new URL("../benchmarks/independent/chalk-snapshots/", import.meta.url),
    license: new URL("../benchmarks/independent/LICENSE-chalk.txt", import.meta.url),
    licenseFile: "LICENSE-chalk.txt",
  },
  {
    id: "node-fetch",
    manifest: new URL("../benchmarks/independent/node-fetch-v1.json", import.meta.url),
    snapshots: new URL("../benchmarks/independent/node-fetch-snapshots/", import.meta.url),
    license: new URL("../benchmarks/independent/LICENSE-node-fetch.txt", import.meta.url),
    licenseFile: "LICENSE-node-fetch.txt",
  },
];

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function readFixedUtf8(url, maxBytes, label) {
  const stat = await lstat(url);
  assert(stat.isFile() && stat.size > 0 && stat.size <= maxBytes, `Invalid ${label} file.`);
  const bytes = await readFile(url);
  assert(bytes.length > 0 && bytes.length <= maxBytes, `${label} exceeds the byte bound.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validateLicenseNotice(text, repository) {
  assert(text.includes("Permission is hereby granted"), `Incomplete MIT grant notice for ${repository}.`);
  assert(text.includes("this permission notice shall be included"), `Incomplete MIT redistribution notice for ${repository}.`);
  assert(text.includes("THE SOFTWARE IS PROVIDED \"AS IS\""), `Incomplete MIT warranty notice for ${repository}.`);
}

function materializeGitIdentity(value, parts, label) {
  if (typeof value === "string") {
    assert(parts === undefined, `Ambiguous ${label} identity.`);
    return value;
  }
  assert(Array.isArray(parts) && parts.length >= 2 && parts.length <= 4, `Invalid segmented ${label} identity.`);
  assert(parts.every((part) => typeof part === "string" && /^[a-f0-9]{1,20}$/.test(part)), `Invalid segmented ${label} identity.`);
  const joined = parts.join("");
  assert(/^[a-f0-9]{40}$/.test(joined), `Invalid ${label} identity.`);
  return joined;
}

function materializeCorpusIdentities(corpus) {
  corpus.commit = materializeGitIdentity(corpus.commit, corpus.commitParts, "commit");
  for (const source of corpus.sources ?? []) {
    source.gitBlobSha1 = materializeGitIdentity(source.gitBlobSha1, source.gitBlobSha1Parts, `blob for ${source.path ?? "source"}`);
  }
  return corpus;
}

async function loadCorpus(definition) {
  const manifestText = await readFixedUtf8(definition.manifest, MAX_MANIFEST_BYTES, `${definition.id} manifest`);
  const corpus = materializeCorpusIdentities(JSON.parse(manifestText));
  assert(corpus.capture === "external-pinned-source-subset-v1", `Unexpected capture contract for ${definition.id}.`);
  assert(corpus.licenseNoticeFile === definition.licenseFile, `License notice binding mismatch for ${definition.id}.`);
  assert(Array.isArray(corpus.sources) && corpus.sources.length > 0 && corpus.sources.length <= 32, `Invalid source count for ${definition.id}.`);

  const snapshotStat = await lstat(definition.snapshots);
  assert(snapshotStat.isDirectory(), `Invalid snapshot directory for ${definition.id}.`);

  const licenseNotice = await readFixedUtf8(definition.license, MAX_LICENSE_BYTES, `${definition.id} license`);
  validateLicenseNotice(licenseNotice, corpus.repository);

  for (const source of corpus.sources) {
    assert(typeof source.gitBlobSha1 === "string" && /^[a-f0-9]{40}$/.test(source.gitBlobSha1), `Invalid upstream blob for ${definition.id}.`);
    const snapshotUrl = new URL(`${source.gitBlobSha1}.txt`, definition.snapshots);
    const text = await readFixedUtf8(snapshotUrl, MAX_SOURCE_BYTES, `${definition.id} snapshot`);
    assert(gitBlobSha1(text) === source.gitBlobSha1, `Pinned Git blob mismatch for ${definition.id}:${source.path}.`);
    source.text = text;
    source.sha256 = sha256Text(text);
  }

  return {
    id: definition.id,
    corpus: validateCorpus(corpus),
    licenseNoticeSha256: sha256Text(licenseNotice),
  };
}

export async function loadIndependentCorpora() {
  const loaded = [];
  for (const definition of CORPORA) loaded.push(await loadCorpus(definition));
  return loaded;
}

export function evaluateIndependentCorpora(loaded) {
  assert(Array.isArray(loaded) && loaded.length >= 2, "At least two independent corpora are required.");
  const repositories = loaded.map(({ corpus }) => corpus.repository);
  assert(new Set(repositories).size === repositories.length, "Independent corpora must use distinct repositories.");
  assert(repositories.every((repository) => repository !== "saiidz/solvelang"), "Independent corpora must not use the SolveLang repository.");

  const corpora = [...loaded]
    .sort((a, b) => compare(a.corpus.repository, b.corpus.repository))
    .map(({ id, corpus, licenseNoticeSha256 }) => ({
      id,
      repository: corpus.repository,
      commit: corpus.commit,
      license: corpus.license,
      licenseNoticeSha256,
      sources: corpus.sources.map(({ path: sourcePath, gitBlobSha1: blob, sha256 }) => ({
        path: sourcePath,
        gitBlobSha1: blob,
        sha256,
      })),
      report: evaluateRepositoryCorpus(corpus),
    }));

  const pass = corpora.every(({ report }) => report.aggregate.pass);
  return {
    schema: "solvelang.context.independent-repository-eval-report.v1",
    truth: {
      corpusKind: "independent pinned external source subsets",
      wholeRepositoriesMeasured: false,
      blindedHoldout: false,
      annotationsVisibleToImplementation: true,
      annotationsPassedToSelector: false,
      byteReductionIsNotTokenSavings: true,
      providerTokens: null,
      providerCacheReuse: null,
      agentTaskSuccess: null,
      externalCompetitorMeasured: false,
      credentialsUsed: false,
      providerRequests: 0,
      networkDuringEvaluation: false,
      snapshotCodeExecuted: false,
      publicationAuthorized: false,
    },
    corpora,
    aggregate: {
      repositoryCount: corpora.length,
      sourceCount: corpora.reduce((sum, item) => sum + item.report.corpus.sourceCount, 0),
      caseCount: corpora.reduce((sum, item) => sum + item.report.aggregate.caseCount, 0),
      pass,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Fixed checked-in data only; no arbitrary paths, URLs, network calls, or source execution.
  const report = evaluateIndependentCorpora(await loadIndependentCorpora());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.aggregate.pass) process.exitCode = 1;
}
