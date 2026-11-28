import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { RepoReadError } from "../src/github-repo-reader.js";
import {
  readAzureArchive,
  readBitbucketArchive,
  readForgeArchive,
  readGitLabArchive,
  readPlatformRepository,
} from "../src/platform-repo-reader.js";

// Recorded-shape fixtures: every platform response below is built
// from the platform's documented API shape and served through a
// fake fetch, so the readers are proven against the wire format
// without a live workspace. (The Forge leg additionally ran
// end-to-end against a self-hosted Gitea instance on 2026-11-28.)

const sha256Of = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// Minimal ustar writer, the same pattern as github-repo-reader.test.js.
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

function archiveFixture(root) {
  return tarGz([
    tarEntry(root, "", { type: "5" }),
    tarEntry(`${root}/README.md`, "# Hello\n"),
    tarEntry(`${root}/src/index.js`, "console.log('hi');\n"),
  ]);
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return payload; },
    async arrayBuffer() { return Buffer.from(JSON.stringify(payload), "utf8"); },
  };
}

function bytesResponse(buffer, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-length" ? String(buffer.length) : null) },
    async json() { throw new Error("not json"); },
    async arrayBuffer() { return buffer; },
  };
}

// Routes are [predicate, respond] pairs matched in order; every
// call is recorded so tests can assert on URLs and auth headers.
function routerFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    for (const [matches, respond] of routes) {
      if (matches(String(url))) return respond(String(url));
    }
    return jsonResponse({ message: "not found" }, 404);
  };
  return { fetchImpl, calls };
}

test("GitLab reader walks project, branch, and archive into the shared manifest", async () => {
  const { fetchImpl, calls } = routerFetch([
    [(url) => url.endsWith("/api/v4/projects/group%2Fproject"), () => jsonResponse({ default_branch: "main", path_with_namespace: "group/project" })],
    [(url) => url.includes("/repository/branches/main"), () => jsonResponse({ commit: { id: "abc123" } })],
    [(url) => url.includes("/repository/archive.tar.gz?sha=abc123"), () => bytesResponse(archiveFixture("project-main-abc123"))],
  ]);
  const manifest = await readGitLabArchive({
    token: "glpat-test-token",
    baseUrl: "https://gitlab.example.com",
    projectPath: "group/project",
    fetchImpl,
  });
  assert.equal(manifest.repoFullName, "group/project");
  assert.equal(manifest.defaultBranch, "main");
  assert.equal(manifest.commitSha, "abc123");
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 0 });
  const byPath = new Map(manifest.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("README.md").sha256, sha256Of("# Hello\n"));
  assert.equal(byPath.get("src/index.js").sha256, sha256Of("console.log('hi');\n"));
  assert.equal(calls[0].headers["private-token"], "glpat-test-token");
});

test("GitLab reader fails as repo_unavailable when the platform refuses", async () => {
  const { fetchImpl } = routerFetch([]);
  await assert.rejects(
    readGitLabArchive({ token: "glpat-test-token", baseUrl: "https://gitlab.example.com", projectPath: "group/project", fetchImpl }),
    (error) => error instanceof RepoReadError && error.code === "repo_unavailable",
  );
});

test("Forge reader walks repo, branch, and archive with the platform token scheme", async () => {
  const { fetchImpl, calls } = routerFetch([
    [(url) => url.endsWith("/api/v1/repos/acme/alpha"), () => jsonResponse({ default_branch: "main", full_name: "acme/alpha" })],
    [(url) => url.includes("/branches/main"), () => jsonResponse({ commit: { id: "def456" } })],
    [(url) => url.includes("/archive/def456.tar.gz"), () => bytesResponse(archiveFixture("alpha-def456"))],
  ]);
  const manifest = await readForgeArchive({
    token: "forge-token-value",
    baseUrl: "https://git.example.com",
    owner: "acme",
    repo: "alpha",
    fetchImpl,
  });
  assert.equal(manifest.repoFullName, "acme/alpha");
  assert.equal(manifest.commitSha, "def456");
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 0 });
  assert.equal(calls[0].headers.authorization, "token forge-token-value");
});

test("Azure reader lists items at the head commit and hashes fetched contents", async () => {
  const contents = { "/README.md": "# Hello\n", "/src/index.js": "console.log('hi');\n" };
  const { fetchImpl, calls } = routerFetch([
    [(url) => url.includes("/repositories/api%20service?"), () => jsonResponse({ id: "repo-id-1", name: "api service", defaultBranch: "refs/heads/main" })],
    [(url) => url.includes("/refs?"), () => jsonResponse({ value: [{ objectId: "sha999" }] })],
    [(url) => url.includes("recursionLevel=Full"), () => jsonResponse({
      value: [
        { path: "/README.md", isFolder: false, size: 8 },
        { path: "/src", isFolder: true },
        { path: "/big.bin", isFolder: false, size: 3_000_000 },
        { path: "/src/index.js", isFolder: false, size: 19 },
      ],
    })],
    [(url) => url.includes("items?path="), (url) => {
      const path = new URL(url).searchParams.get("path");
      return bytesResponse(Buffer.from(contents[path], "utf8"));
    }],
  ]);
  const manifest = await readAzureArchive({
    token: "azure-pat-value",
    organization: "acme",
    project: "Platform Team",
    repository: "api service",
    fetchImpl,
  });
  assert.equal(manifest.repoFullName, "api service");
  assert.equal(manifest.defaultBranch, "main");
  assert.equal(manifest.commitSha, "sha999");
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 1 });
  assert.deepEqual(manifest.skipped, [{ path: "big.bin", reason: "file_too_large" }]);
  const byPath = new Map(manifest.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("README.md").sha256, sha256Of("# Hello\n"));
  assert.equal(byPath.get("src/index.js").sha256, sha256Of("console.log('hi');\n"));
  const expectedAuth = `Basic ${Buffer.from(":azure-pat-value", "utf8").toString("base64")}`;
  assert.equal(calls[0].headers.authorization, expectedAuth);
  assert.ok(calls.some((call) => call.url.includes("versionDescriptor.version=sha999")), "listing is pinned to the head commit");
});

test("Bitbucket reader follows the src listing pages and hashes fetched contents", async () => {
  const base = "https://api.bitbucket.org/2.0/repositories/acme/alpha";
  const contents = { "README.md": "# Hello\n", "src/index.js": "console.log('hi');\n" };
  const { fetchImpl, calls } = routerFetch([
    [(url) => url === base, () => jsonResponse({ mainbranch: { name: "main" }, full_name: "acme/alpha" })],
    [(url) => url.includes("/commits/main"), () => jsonResponse({ values: [{ hash: "beef42" }] })],
    [(url) => url.includes("/src/beef42/?pagelen=100") && !url.includes("page=2"), () => jsonResponse({
      values: [
        { type: "commit_directory", path: "src" },
        { type: "commit_file", path: "README.md", size: 8, links: { self: { href: `${base}/src/beef42/README.md` } } },
      ],
      next: `${base}/src/beef42/?pagelen=100&page=2`,
    })],
    [(url) => url.includes("page=2"), () => jsonResponse({
      values: [
        { type: "commit_file", path: "src/index.js", size: 19, links: { self: { href: `${base}/src/beef42/src/index.js` } } },
      ],
    })],
    [(url) => url.startsWith(`${base}/src/beef42/`) && !url.includes("pagelen"), (url) => {
      const path = url.slice(`${base}/src/beef42/`.length);
      return bytesResponse(Buffer.from(contents[path], "utf8"));
    }],
  ]);
  const manifest = await readBitbucketArchive({
    token: "bitbucket-token-value",
    workspace: "acme",
    repoSlug: "alpha",
    fetchImpl,
  });
  assert.equal(manifest.repoFullName, "acme/alpha");
  assert.equal(manifest.defaultBranch, "main");
  assert.equal(manifest.commitSha, "beef42");
  assert.deepEqual(manifest.totals, { files: 2, bytes: 27, skipped: 0 });
  const byPath = new Map(manifest.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("README.md").sha256, sha256Of("# Hello\n"));
  assert.equal(byPath.get("src/index.js").sha256, sha256Of("console.log('hi');\n"));
  assert.equal(calls[0].headers.authorization, "Bearer bitbucket-token-value");
});

test("the dispatcher routes a stored repository entry to its platform reader", async () => {
  const { fetchImpl } = routerFetch([
    [(url) => url.endsWith("/api/v1/repos/acme/alpha"), () => jsonResponse({ default_branch: "main", full_name: "acme/alpha" })],
    [(url) => url.includes("/branches/main"), () => jsonResponse({ commit: { id: "def456" } })],
    [(url) => url.includes("/archive/def456.tar.gz"), () => bytesResponse(archiveFixture("alpha-def456"))],
  ]);
  const manifest = await readPlatformRepository({
    platform: "forge",
    token: "forge-token-value",
    connection: { baseUrl: "https://git.example.com" },
    repository: "acme/alpha",
    fetchImpl,
  });
  assert.equal(manifest.commitSha, "def456");
  await assert.rejects(
    readPlatformRepository({ platform: "gitea", token: "t", connection: {}, repository: "a/b", fetchImpl }),
    /no repository reader/,
  );
});
