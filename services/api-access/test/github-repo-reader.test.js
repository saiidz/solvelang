import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createDynamoGitHubStore } from "../src/github-store.js";
import {
  RepoReadError,
  extractTar,
  extractTarGzip,
  readRepositoryArchive,
  runRepositoryAuditRead,
} from "../src/github-repo-reader.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const AT = Date.parse("2026-11-05T12:00:00Z");
const SHA = "a".repeat(40);

// --- in-test tar.gz fixture builder --------------------------------------
// Minimal ustar writer: header block + padded data blocks + two zero
// blocks, then gzip. Enough to exercise the reader honestly.
function tarEntry(name, content, { prefix = "", type = "0" } = {}) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write(type, 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  if (prefix) header.write(prefix.slice(0, 155), 345, "utf8");
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) checksum += index >= 148 && index < 156 ? 0x20 : header[index];
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}

function tarGz(entries) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

const ROOT = `solvelang-${SHA}`;
const fixture = tarGz([
  tarEntry(ROOT, "", { type: "5" }),
  tarEntry(`${ROOT}/README.md`, "# Hello\n"),
  tarEntry(`${ROOT}/src/index.js`, "console.log('hi');\n"),
]);
const sha256Of = (text) => createHash("sha256").update(text, "utf8").digest("hex");

test("tar extraction strips the root prefix and hashes file contents", () => {
  const manifest = extractTarGzip(fixture);
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 0 });
  const byPath = new Map(manifest.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("README.md").sha256, sha256Of("# Hello\n"));
  assert.equal(byPath.get("README.md").bytes, 8);
  assert.equal(byPath.get("src/index.js").sha256, sha256Of("console.log('hi');\n"));
});

test("ustar prefix field is honoured for long paths", () => {
  const long = tarGz([tarEntry("deep/nested/file.txt", "x", { prefix: ROOT })]);
  const manifest = extractTarGzip(long);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].path, "deep/nested/file.txt");
});

test("per-file cap skips oversized files and records them", () => {
  const manifest = extractTarGzip(fixture, { maxFileBytes: 10 });
  assert.equal(manifest.totals.files, 1);
  assert.equal(manifest.totals.skipped, 1);
  assert.deepEqual(manifest.skipped, [{ path: "src/index.js", reason: "file_too_large" }]);
  assert.equal(manifest.files[0].path, "README.md");
});

test("file-count and extracted-size caps fail the read", () => {
  assert.throws(
    () => extractTarGzip(fixture, { maxFiles: 1 }),
    (error) => error instanceof RepoReadError && error.code === "too_many_files",
  );
  const rawTar = Buffer.concat([tarEntry(`${ROOT}/a.txt`, "hello"), Buffer.alloc(1024)]);
  assert.throws(
    () => extractTar(rawTar, { maxExtractedBytes: 100 }),
    (error) => error instanceof RepoReadError && error.code === "archive_too_large",
  );
});

test("compressed-size cap and garbage input fail closed", () => {
  assert.throws(
    () => extractTarGzip(fixture, { maxCompressedBytes: 10 }),
    (error) => error instanceof RepoReadError && error.code === "archive_too_large",
  );
  assert.throws(
    () => extractTarGzip(Buffer.from("not a gzip stream")),
    (error) => error instanceof RepoReadError && error.code === "archive_invalid",
  );
});

// --- full reader flow with a fake GitHub ---------------------------------
function readerFetch(tarball) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    const json = (payload, status = 200) => ({
      ok: status === 200, status,
      headers: { get: () => null },
      json: async () => payload,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    if (target === "https://api.github.com/repos/octocat/hello") {
      return json({ full_name: "octocat/hello", default_branch: "main" });
    }
    if (target === "https://api.github.com/repos/octocat/hello/branches/main") {
      return json({ commit: { sha: SHA } });
    }
    if (target === "https://api.github.com/repos/octocat/hello/tarball/main") {
      return {
        ok: true, status: 200,
        headers: { get: () => String(tarball.length) },
        json: async () => ({}),
        arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength),
      };
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  impl.calls = calls;
  return impl;
}

test("readRepositoryArchive returns metadata, branch head and the manifest", async () => {
  const manifest = await readRepositoryArchive({
    token: "ghs_test", owner: "octocat", repo: "hello", fetchImpl: readerFetch(fixture),
  });
  assert.equal(manifest.repoFullName, "octocat/hello");
  assert.equal(manifest.defaultBranch, "main");
  assert.equal(manifest.commitSha, SHA);
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 0 });
});

// --- audit orchestration ---------------------------------------------------
function fakeDocumentClient() {
  const items = new Map();
  return {
    items,
    async send(command) {
      const { input } = command;
      const name = command.constructor.name;
      if (name === "GetCommand") return { Item: items.get(input.Key.recordKey) };
      if (name === "PutCommand") { items.set(input.Item.recordKey, structuredClone(input.Item)); return {}; }
      if (name === "DeleteCommand") {
        const existing = items.get(input.Key.recordKey);
        if (input.ConditionExpression && !existing) {
          throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        }
        items.delete(input.Key.recordKey);
        return input.ReturnValues === "ALL_OLD" ? { Attributes: existing } : {};
      }
      if (name === "QueryCommand") {
        const prefix = input.ExpressionAttributeValues[":prefix"];
        return { Items: [...items.values()].filter((item) => item.recordKey.startsWith(prefix)) };
      }
      throw new Error(`Unexpected command ${name}`);
    },
  };
}

async function linkedStore({ suspended = false } = {}) {
  const store = createDynamoGitHubStore(fakeDocumentClient(), "github-table", { now: () => AT });
  await store.putInstallation({
    installationId: 42, accountLogin: "octocat", accountType: "User",
    repositories: [{ id: 1, fullName: "octocat/hello" }], suspended,
    updatedAt: new Date(AT).toISOString(),
  });
  await store.linkAccountInstallation({ accountId: "acct_abc", installationId: 42 });
  return store;
}

function auditFetch(tarball) {
  const inner = readerFetch(tarball);
  return async (url, options = {}) => {
    if (String(url) === "https://api.github.com/app/installations/42/access_tokens") {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ token: "ghs_test", expires_at: "2026-11-05T13:00:00Z" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return inner(url, options);
  };
}

test("audit read completes for a linked repo and persists the run", async () => {
  const store = await linkedStore();
  const result = await runRepositoryAuditRead({
    store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
    installationId: 42, repoFullName: "octocat/hello",
    fetchImpl: auditFetch(fixture), now: () => AT, runId: "run_test_1",
  });
  assert.equal(result.status, "read_complete");
  assert.deepEqual(result.totals, { files: 2, bytes: 27, skipped: 0 });
  const run = await store.getAuditRun({ accountId: "acct_abc", runId: "run_test_1" });
  assert.equal(run.status, "read_complete");
  assert.equal(run.manifest.commitSha, SHA);
  assert.equal(run.manifest.defaultBranch, "main");
  assert.deepEqual(run.manifest.totals, { files: 2, bytes: 27, skipped: 0 });
});

test("audit read rejects repos outside the linked installation and unlinked installations", async () => {
  const store = await linkedStore();
  await assert.rejects(
    () => runRepositoryAuditRead({
      store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
      installationId: 42, repoFullName: "octocat/secret",
      fetchImpl: auditFetch(fixture), now: () => AT, runId: "run_test_2",
    }),
    (error) => error.code === "github_repo_not_linked" && error.statusCode === 403,
  );
  assert.equal(await store.getAuditRun({ accountId: "acct_abc", runId: "run_test_2" }), undefined);
  await assert.rejects(
    () => runRepositoryAuditRead({
      store, appId: "123", privateKey: privatePem, accountId: "acct_someone_else",
      installationId: 42, repoFullName: "octocat/hello",
      fetchImpl: auditFetch(fixture), now: () => AT, runId: "run_test_3",
    }),
    (error) => error.code === "github_installation_not_linked" && error.statusCode === 404,
  );
});

test("audit read records read_failed when GitHub cannot deliver the archive", async () => {
  const store = await linkedStore();
  const failingFetch = async (url, options = {}) => {
    if (String(url).endsWith("/access_tokens")) {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ token: "ghs_test", expires_at: "2026-11-05T13:00:00Z" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    throw new Error("network down");
  };
  await assert.rejects(
    () => runRepositoryAuditRead({
      store, appId: "123", privateKey: privatePem, accountId: "acct_abc",
      installationId: 42, repoFullName: "octocat/hello",
      fetchImpl: failingFetch, now: () => AT, runId: "run_test_4",
    }),
    (error) => error.code === "github_repo_read_failed" && error.statusCode === 502,
  );
  const run = await store.getAuditRun({ accountId: "acct_abc", runId: "run_test_4" });
  assert.equal(run.status, "read_failed");
});
