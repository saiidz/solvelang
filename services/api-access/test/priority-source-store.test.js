import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerPriorityExecutor } from "../src/customer-priority-executor.js";
import { createS3PrioritySourceStore, fingerprintPrioritySource, MAX_PRIORITY_SOURCE_BYTES } from "../src/priority-source-store.js";

function zipBytes(body = "fixture") {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(body)]);
}

class FakeS3 {
  constructor() { this.calls = []; this.object = null; }
  async send(command) {
    this.calls.push({ type: command.constructor.name, input: command.input });
    if (command.constructor.name === "PutObjectCommand") {
      this.object = { bytes: Buffer.from(command.input.Body), metadata: { ...command.input.Metadata } };
      return {};
    }
    if (command.constructor.name === "HeadObjectCommand") {
      if (!this.object) throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: this.object.bytes.length, Metadata: this.object.metadata };
    }
    if (command.constructor.name === "GetObjectCommand") {
      if (!this.object) throw new Error("missing");
      return {
        ContentLength: this.object.bytes.length,
        Body: { transformToByteArray: async () => this.object.bytes },
        Metadata: this.object.metadata,
      };
    }
    if (command.constructor.name === "DeleteObjectCommand") {
      this.object = null;
      return {};
    }
    throw new Error("unexpected command");
  }
}

test("source storage is content-addressed, encrypted, fingerprint verified, and existence checked", async () => {
  const client = new FakeS3();
  const store = createS3PrioritySourceStore(client, { bucketName: "solvelang-priority-source-test" });
  const source = zipBytes("repository archive bytes");
  const fingerprint = fingerprintPrioritySource(source);
  const saved = await store.putSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source });
  assert.equal(saved.fingerprint, fingerprint);
  assert.equal(client.calls[0].input.Key, `customer/acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${fingerprint}.zip`);
  assert.equal(client.calls[0].input.ServerSideEncryption, "AES256");
  assert.equal(client.calls[0].input.ContentType, "application/zip");
  assert.equal(client.calls[0].input.Metadata["source-sha256"], fingerprint);
  assert.deepEqual(
    await store.assertSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }),
    { fingerprint, bytes: source.length },
  );
  assert.deepEqual(await store.getSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }), source);
});

test("source existence is account-bound and missing source is a public 404 before usage", async () => {
  const client = new FakeS3();
  const store = createS3PrioritySourceStore(client, { bucketName: "solvelang-priority-source-test" });
  await assert.rejects(
    store.assertSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint: "f".repeat(64) }),
    (error) => error?.statusCode === 404 && error?.code === "priority_source_not_found",
  );
  assert.equal(client.calls[0].type, "HeadObjectCommand");
  assert.match(client.calls[0].input.Key, /^customer\/acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\//);
});

test("source metadata verification rejects fingerprint and size disagreement", async () => {
  const client = new FakeS3();
  const store = createS3PrioritySourceStore(client, { bucketName: "solvelang-priority-source-test" });
  const source = zipBytes("metadata");
  const fingerprint = fingerprintPrioritySource(source);
  await store.putSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source });
  client.object.metadata["source-sha256"] = "f".repeat(64);
  await assert.rejects(
    store.assertSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }),
    /metadata is invalid/,
  );
  client.object.metadata["source-sha256"] = fingerprint;
  client.object.metadata["source-bytes"] = String(source.length + 1);
  await assert.rejects(
    store.assertSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }),
    /size metadata mismatch/,
  );
});

test("source storage rejects non-ZIP, tiny, malformed ownership, and oversized source before S3", async () => {
  const client = new FakeS3();
  const store = createS3PrioritySourceStore(client, { bucketName: "solvelang-priority-source-test" });
  assert.throws(() => fingerprintPrioritySource(Buffer.from("not a zip")), /ZIP archive/);
  assert.throws(() => fingerprintPrioritySource(Buffer.from([0x50, 0x4b, 0x03])), /ZIP archive/);
  await assert.rejects(store.putSource({ accountId: "bad", source: zipBytes() }), /Account ID/);
  const oversized = Buffer.alloc(MAX_PRIORITY_SOURCE_BYTES + 1);
  oversized.set([0x50, 0x4b, 0x03, 0x04]);
  await assert.rejects(store.putSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source: oversized }), /upload limit/);
  assert.equal(client.calls.length, 0);
});

test("source retrieval fails closed on digest or stored-size metadata mismatch", async () => {
  const client = new FakeS3();
  const store = createS3PrioritySourceStore(client, { bucketName: "solvelang-priority-source-test" });
  const source = zipBytes("one");
  const fingerprint = fingerprintPrioritySource(source);
  await store.putSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source });
  client.object.bytes = zipBytes("tampered");
  await assert.rejects(store.getSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }), /fingerprint mismatch/);
  client.object.bytes = source;
  client.object.metadata["source-bytes"] = String(source.length + 1);
  await assert.rejects(store.getSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint }), /size metadata mismatch/);
});

test("source retrieval rejects oversized stored objects before or while reading their bodies", async () => {
  let transformed = false;
  const oversizedByHeader = {
    async send() {
      return {
        ContentLength: MAX_PRIORITY_SOURCE_BYTES + 1,
        Body: { async transformToByteArray() { transformed = true; return zipBytes("should not be read"); } },
      };
    },
  };
  const headerStore = createS3PrioritySourceStore(oversizedByHeader, { bucketName: "solvelang-priority-source-test" });
  await assert.rejects(
    headerStore.getSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint: "a".repeat(64) }),
    /upload limit/,
  );
  assert.equal(transformed, false);

  let streamTransformed = false;
  const oversizedStream = {
    async send() {
      return {
        Body: {
          async transformToByteArray() { streamTransformed = true; return zipBytes("unsafe fallback"); },
          async *[Symbol.asyncIterator]() {
            yield Buffer.from([0x50, 0x4b, 0x03, 0x04]);
            yield Buffer.alloc(MAX_PRIORITY_SOURCE_BYTES);
          },
        },
      };
    },
  };
  const streamStore = createS3PrioritySourceStore(oversizedStream, { bucketName: "solvelang-priority-source-test" });
  await assert.rejects(
    streamStore.getSource({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fingerprint: "a".repeat(64) }),
    /upload limit/,
  );
  assert.equal(streamTransformed, false);
});

test("executor loads only the account-bound fingerprint, forwards an abort signal, sanitizes result, and deletes source after success", async () => {
  const calls = [];
  const source = zipBytes("repo");
  const sourceStore = {
    async getSource(input) { calls.push(["get", input]); return source; },
    async deleteSource(input) { calls.push(["delete", input]); },
  };
  const executor = createCustomerPriorityExecutor({
    sourceStore,
    timeoutMs: 5_000,
    executeAudit: async (input) => {
      calls.push(["execute", input]);
      assert.deepEqual(input.source, source);
      assert.equal(input.signal instanceof AbortSignal, true);
      return { reportId: "report_12345678", provider: "provider-v1", secret: "must-not-escape" };
    },
  });
  const result = await executor({
    accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    jobId: "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    priority: "express",
    sourceFingerprint: "a".repeat(64),
    weightedCredits: 2,
  });
  assert.deepEqual(result, { reportId: "report_12345678", provider: "provider-v1" });
  assert.equal(calls[0][0], "get");
  assert.equal(calls[1][0], "execute");
  assert.equal(calls[2][0], "delete");
});

test("executor keeps source for retry on failure and enforces bounded results", async () => {
  let deleted = false;
  const sourceStore = {
    async getSource() { return zipBytes("repo"); },
    async deleteSource() { deleted = true; },
  };
  const executor = createCustomerPriorityExecutor({
    sourceStore,
    executeAudit: async () => ({ reportId: "x", provider: "bad provider spaces" }),
  });
  await assert.rejects(executor({ accountId: "acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sourceFingerprint: "a".repeat(64) }), /invalid result/);
  assert.equal(deleted, false);
});
