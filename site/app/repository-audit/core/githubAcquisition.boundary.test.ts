import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireGitHubRepositorySnapshot,
  type GitHubBlob,
  type GitHubRecursiveTree,
  type GitHubResolvedReference,
  type RepositoryGitHubClient,
} from "./githubAcquisition";

const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const blobSha = "c".repeat(40);

function validTree(): GitHubRecursiveTree {
  return {
    truncated: false,
    entries: [{ path: "a.txt", mode: "100644", type: "blob", sha: blobSha, size: 1 }],
  };
}

function validBlob(): GitHubBlob {
  return { sha: blobSha, encoding: "base64", content: "YQ==", byteSize: 1 };
}

function client(overrides: Partial<RepositoryGitHubClient> = {}): RepositoryGitHubClient {
  return {
    async resolveReference(): Promise<GitHubResolvedReference> {
      return { commitSha, treeSha };
    },
    async listRecursiveTree(): Promise<GitHubRecursiveTree> {
      return validTree();
    },
    async getBlob(): Promise<GitHubBlob> {
      return validBlob();
    },
    ...overrides,
  };
}

test("sanitizes provider errors without exposing connector credentials", async () => {
  const canary = "ghp_PROVIDER_ERROR_CANARY_DO_NOT_LEAK";
  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: client({ async resolveReference() { throw new Error(`request failed with ${canary}`); } }),
      repositoryFullName: "example/repo",
      reference: "main",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "GitHub reference resolution failed.");
      assert.ok(!error.message.includes(canary));
      return true;
    },
  );

  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: client({ async listRecursiveTree() { throw new Error(`tree URL contained ${canary}`); } }),
      repositoryFullName: "example/repo",
      reference: "main",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "GitHub recursive tree request failed.");
      assert.ok(!error.message.includes(canary));
      return true;
    },
  );

  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: client({ async getBlob() { throw new Error(`authorization ${canary}`); } }),
      repositoryFullName: "example/repo",
      reference: "main",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "GitHub blob download for a.txt failed.");
      assert.ok(!error.message.includes(canary));
      return true;
    },
  );
});

test("rejects oversized encoded blob content before decoding", async () => {
  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: client({ async getBlob() { return { ...validBlob(), content: "A".repeat(10_000) }; } }),
      repositoryFullName: "example/repo",
      reference: "main",
    }),
    /exceeds the declared encoded size/,
  );
});

test("requires every GitHub acquisition client method", async () => {
  const incomplete = {
    resolveReference: async () => ({ commitSha, treeSha }),
  } as unknown as RepositoryGitHubClient;
  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: incomplete,
      repositoryFullName: "example/repo",
      reference: "main",
    }),
    /missing listRecursiveTree/,
  );
});

test("rejects dot-only repository components", async () => {
  await assert.rejects(
    () => acquireGitHubRepositorySnapshot({
      client: client(),
      repositoryFullName: "../repo",
      reference: "main",
    }),
    /invalid component/,
  );
});
