import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryInventory } from "./inventory";
import {
  acquireGitHubRepositorySnapshot,
  type GitHubBlob,
  type GitHubRecursiveTree,
  type GitHubResolvedReference,
  type RepositoryGitHubClient,
} from "./githubAcquisition";

const encoder = new TextEncoder();
const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);

function toBase64(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function treeEntry(path: string, shaCharacter: string, size: number, mode = "100644") {
  return { path, mode, type: "blob" as const, sha: shaCharacter.repeat(40), size };
}

class FakeGitHubClient implements RepositoryGitHubClient {
  readonly calls: string[] = [];
  readonly blobs = new Map<string, GitHubBlob>();
  resolved: GitHubResolvedReference = { commitSha, treeSha };
  tree: GitHubRecursiveTree = { truncated: false, entries: [] };
  inFlight = 0;
  maxInFlight = 0;
  delayMs = 0;
  abortAfterResolve?: AbortController;

  async resolveReference(): Promise<GitHubResolvedReference> {
    this.calls.push("resolve");
    this.abortAfterResolve?.abort();
    return this.resolved;
  }

  async listRecursiveTree(): Promise<GitHubRecursiveTree> {
    this.calls.push("tree");
    return this.tree;
  }

  async getBlob({ blobSha }: { blobSha: string }): Promise<GitHubBlob> {
    this.calls.push(`blob:${blobSha}`);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.inFlight -= 1;
    const blob = this.blobs.get(blobSha);
    if (!blob) throw new Error("fixture blob missing");
    return blob;
  }
}

function addBlob(client: FakeGitHubClient, shaCharacter: string, value: string | Uint8Array, overrides: Partial<GitHubBlob> = {}) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const sha = shaCharacter.repeat(40);
  client.blobs.set(sha, {
    sha,
    encoding: "base64",
    content: toBase64(bytes),
    byteSize: bytes.byteLength,
    ...overrides,
  });
}

test("pins a GitHub reference, downloads a bounded tree, and feeds Repository Audit inventory", async () => {
  const client = new FakeGitHubClient();
  const packageJson = JSON.stringify({ dependencies: { next: "16.2.7", react: "19.2.4" } });
  addBlob(client, "1", packageJson);
  addBlob(client, "2", "export const ready = true;");
  addBlob(client, "3", "compiled");
  client.tree = {
    truncated: false,
    entries: [
      treeEntry("src/index.ts", "2", encoder.encode("export const ready = true;").byteLength),
      { path: "src", mode: "040000", type: "tree", sha: "4".repeat(40) },
      treeEntry("package.json", "1", encoder.encode(packageJson).byteLength),
      treeEntry("dist/app.js", "3", encoder.encode("compiled").byteLength),
    ],
  };

  const acquired = await acquireGitHubRepositorySnapshot({
    client,
    repositoryFullName: "example/automation-app",
    reference: "main",
  });

  assert.equal(acquired.acquisition.commitSha, commitSha);
  assert.equal(acquired.acquisition.treeSha, treeSha);
  assert.equal(acquired.acquisition.treeEntriesSeen, 4);
  assert.equal(acquired.acquisition.blobsDownloaded, 3);
  assert.equal(acquired.acquisition.apiRequests, 5);
  assert.equal(acquired.acquisition.networkAccess, true);
  assert.equal(acquired.acquisition.writeAccess, false);
  assert.deepEqual(acquired.result.snapshot.files.map(({ path }) => path), ["dist/app.js", "package.json", "src/index.ts"]);
  assert.equal(acquired.result.snapshot.files.find(({ path }) => path === "dist/app.js")?.generated, true);
  assert.deepEqual(client.calls.slice(0, 2), ["resolve", "tree"]);

  const analysis = analyzeRepositoryInventory(acquired.result.snapshot);
  assert.deepEqual(analysis.inventory.frameworks.map(({ name }) => name), ["Next.js", "React"]);
  assert.equal(analysis.detections.generatedCandidates[0].path, "dist/app.js");
});

test("fails closed on a truncated recursive tree before downloading blobs", async () => {
  const client = new FakeGitHubClient();
  client.tree = { truncated: true, entries: [treeEntry("a.txt", "1", 1)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client,
    repositoryFullName: "example/repo",
    reference: "main",
  }), /truncated/);
  assert.deepEqual(client.calls, ["resolve", "tree"]);
});

test("rejects symbolic links and submodules before downloading blobs", async () => {
  const symlinkClient = new FakeGitHubClient();
  symlinkClient.tree = {
    truncated: false,
    entries: [{ path: "link", mode: "120000", type: "blob", sha: "1".repeat(40), size: 4 }],
  };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: symlinkClient,
    repositoryFullName: "example/repo",
    reference: "main",
  }), /symbolic links/);
  assert.equal(symlinkClient.calls.filter((call) => call.startsWith("blob:")).length, 0);

  const submoduleClient = new FakeGitHubClient();
  submoduleClient.tree = {
    truncated: false,
    entries: [{ path: "vendor/project", mode: "160000", type: "commit", sha: "2".repeat(40) }],
  };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: submoduleClient,
    repositoryFullName: "example/repo",
    reference: "main",
  }), /submodules/);
  assert.equal(submoduleClient.calls.filter((call) => call.startsWith("blob:")).length, 0);
});

test("enforces tree, blob, total-byte, depth, and API-request limits before blob acquisition", async () => {
  const tooMany = new FakeGitHubClient();
  tooMany.tree = { truncated: false, entries: [treeEntry("a", "1", 1), treeEntry("b", "2", 1)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: tooMany,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxTreeEntries: 1 },
  }), /tree exceeds/);

  const tooLarge = new FakeGitHubClient();
  tooLarge.tree = { truncated: false, entries: [treeEntry("large.bin", "1", 3)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: tooLarge,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxBlobBytes: 2, maxTextBytes: 1 },
  }), /blob exceeds/);

  const total = new FakeGitHubClient();
  total.tree = { truncated: false, entries: [treeEntry("a", "1", 3), treeEntry("b", "2", 3)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: total,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxTotalBlobBytes: 5 },
  }), /repository exceeds/);

  const depth = new FakeGitHubClient();
  depth.tree = { truncated: false, entries: [treeEntry("a/b/c", "1", 1)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: depth,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxDepth: 2 },
  }), /depth limit/);

  const requests = new FakeGitHubClient();
  requests.tree = { truncated: false, entries: [treeEntry("a", "1", 1)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: requests,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxApiRequests: 2 },
  }), /request limit/);
  assert.equal(requests.calls.filter((call) => call.startsWith("blob:")).length, 0);
});

test("rejects malformed blob identity, encoding, base64, and size responses", async () => {
  async function expectBlobFailure(overrides: Partial<GitHubBlob>, pattern: RegExp) {
    const client = new FakeGitHubClient();
    addBlob(client, "1", "abc", overrides);
    client.tree = { truncated: false, entries: [treeEntry("a.txt", "1", 3)] };
    await assert.rejects(() => acquireGitHubRepositorySnapshot({
      client,
      repositoryFullName: "example/repo",
      reference: "main",
    }), pattern);
  }
  await expectBlobFailure({ sha: "2".repeat(40) }, /identity changed/);
  await expectBlobFailure({ encoding: "utf-8" }, /encoding/);
  await expectBlobFailure({ content: "%%%=" }, /base64/);
  await expectBlobFailure({ byteSize: 2 }, /response size/);
  await expectBlobFailure({ content: toBase64("abcd"), byteSize: 4 }, /size changed/);
});

test("bounds concurrent blob requests and preserves deterministic snapshot order", async () => {
  const client = new FakeGitHubClient();
  client.delayMs = 5;
  client.tree = {
    truncated: false,
    entries: Array.from({ length: 5 }, (_, index) => {
      const character = String(index + 1);
      addBlob(client, character, character);
      return treeEntry(`src/${5 - index}.txt`, character, 1);
    }),
  };
  const acquired = await acquireGitHubRepositorySnapshot({
    client,
    repositoryFullName: "example/repo",
    reference: "main",
    limits: { maxConcurrentBlobRequests: 2 },
  });
  assert.equal(client.maxInFlight, 2);
  assert.deepEqual(acquired.result.snapshot.files.map(({ path }) => path), ["src/1.txt", "src/2.txt", "src/3.txt", "src/4.txt", "src/5.txt"]);
});

test("honors cancellation before and during acquisition", async () => {
  const before = new FakeGitHubClient();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: before,
    repositoryFullName: "example/repo",
    reference: "main",
    signal: alreadyAborted.signal,
  }), { name: "AbortError" });
  assert.deepEqual(before.calls, []);

  const during = new FakeGitHubClient();
  const controller = new AbortController();
  during.abortAfterResolve = controller;
  await assert.rejects(() => acquireGitHubRepositorySnapshot({
    client: during,
    repositoryFullName: "example/repo",
    reference: "main",
    signal: controller.signal,
  }), { name: "AbortError" });
  assert.deepEqual(during.calls, ["resolve"]);
});

test("keeps acquisition credentials and raw bytes out of returned metadata", async () => {
  const client = new FakeGitHubClient() as FakeGitHubClient & { token: string };
  client.token = "ghp_DO_NOT_LEAK_ACQUISITION_CANARY";
  addBlob(client, "1", "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n");
  client.tree = { truncated: false, entries: [treeEntry("asset.dat", "1", 64)] };
  const acquired = await acquireGitHubRepositorySnapshot({
    client,
    repositoryFullName: "example/repo",
    reference: "main",
  });
  const serialized = JSON.stringify(acquired);
  assert.ok(!serialized.includes(client.token));
  assert.ok(!serialized.includes('"bytes"'));
});

test("rejects malformed repository names, references, resolved identities, duplicate paths, and unsupported modes", async () => {
  const client = new FakeGitHubClient();
  await assert.rejects(() => acquireGitHubRepositorySnapshot({ client, repositoryFullName: "invalid", reference: "main" }), /owner\/repository/);
  await assert.rejects(() => acquireGitHubRepositorySnapshot({ client, repositoryFullName: "example/repo", reference: "\n" }), /reference/);

  const badResolved = new FakeGitHubClient();
  badResolved.resolved = { commitSha: "main", treeSha };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({ client: badResolved, repositoryFullName: "example/repo", reference: "main" }), /commit/);

  const duplicate = new FakeGitHubClient();
  duplicate.tree = { truncated: false, entries: [treeEntry("a.txt", "1", 1), treeEntry("./a.txt", "2", 1)] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({ client: duplicate, repositoryFullName: "example/repo", reference: "main" }), /duplicate normalized path/);

  const mode = new FakeGitHubClient();
  mode.tree = { truncated: false, entries: [treeEntry("a.txt", "1", 1, "100600")] };
  await assert.rejects(() => acquireGitHubRepositorySnapshot({ client: mode, repositoryFullName: "example/repo", reference: "main" }), /mode is unsupported/);
});
