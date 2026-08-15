import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCustomerPriorityService } from "../src/customer-priority.js";
import { createCustomerPrioritySourceService } from "../src/customer-priority-source.js";
import { parsePriorityWorkerEnvironment } from "../src/priority-config.js";
import { createHttpsPriorityProviderExecutor } from "../src/priority-provider-executor.js";
import { createS3PrioritySourceStore } from "../src/priority-source-store.js";

const accountId = `acct_${"a".repeat(32)}`;
const requestId = "request-priority-0001";
const sourceBytes = Buffer.from("repository archive bytes");
const sourceFingerprint = createHash("sha256").update(sourceBytes).digest("hex");

function access() {
  return { assertActive: async (id) => assert.equal(id, accountId) };
}

test("source reservation is account-bound, short-lived, and signs only the deterministic job object", async () => {
  let captured;
  const service = createCustomerPrioritySourceService({
    accountAccess: access(),
    s3Client: { send: async () => {} },
    bucket: "solvelang-priority-production-source",
    queueEnabled: true,
    customerPriorityEnabled: true,
    getSignedUrlImpl: async (_client, command, options) => {
      captured = { input: command.input, options };
      return "https://signed.example/upload";
    },
  });
  const result = await service.reserve({ accountId, requestId, sourceFingerprint, byteLength: sourceBytes.length });
  assert.match(result.jobId, /^job_[a-f0-9]{32}$/);
  assert.equal(result.expiresInSeconds, 300);
  assert.equal(captured.options.expiresIn, 300);
  assert.equal(captured.input.Key, `customer/${accountId}/${result.jobId}/source.bin`);
  assert.equal(captured.input.Metadata.accountid, accountId);
  assert.equal(captured.input.Metadata.sha256, sourceFingerprint);
  assert.equal(result.requiredHeaders["x-amz-meta-jobid"], result.jobId);
});

test("job submission verifies source before consuming weighted credits", async () => {
  const calls = [];
  const service = createCustomerPriorityService({
    accountAccess: access(),
    apiAccessService: { consumeUsage: async (input) => { calls.push(["usage", input]); return { used: input.credits }; } },
    jobStore: {
      getJob: async () => undefined,
      putJob: async (job) => { calls.push(["job", job]); return "created"; },
    },
    sourceVerifier: { verifySource: async (input) => { calls.push(["source", input]); return { byteLength: sourceBytes.length }; } },
    sourceVerificationRequired: true,
    queueEnabled: true,
    customerPriorityEnabled: true,
    providerExecutionEnabled: true,
    now: () => Date.parse("2026-08-15T20:00:00Z"),
  });
  const result = await service.submit({
    accountId,
    requestId,
    sourceFingerprint,
    workload: { inputTokens: 5_001, outputTokens: 1_001, priority: "express" },
  });
  assert.equal(calls[0][0], "source");
  assert.equal(calls[1][0], "usage");
  assert.equal(calls[2][0], "job");
  assert.equal(result.duplicate, false);
});

test("source verification failure cannot consume credits", async () => {
  let usageCalls = 0;
  const service = createCustomerPriorityService({
    accountAccess: access(),
    apiAccessService: { consumeUsage: async () => { usageCalls += 1; } },
    jobStore: { getJob: async () => undefined, putJob: async () => "created" },
    sourceVerifier: { verifySource: async () => { throw new Error("missing source"); } },
    sourceVerificationRequired: true,
    queueEnabled: true,
    customerPriorityEnabled: true,
    providerExecutionEnabled: true,
  });
  await assert.rejects(() => service.submit({ accountId, requestId, sourceFingerprint, workload: { priority: "standard" } }), /missing source/);
  assert.equal(usageCalls, 0);
});

test("S3 source store re-verifies metadata and full SHA-256 before execution", async () => {
  const jobId = `job_${"b".repeat(32)}`;
  const client = {
    send: async (command) => {
      const name = command.constructor.name;
      if (name === "HeadObjectCommand") return {
        ContentLength: sourceBytes.length,
        Metadata: { accountid: accountId, jobid: jobId, sha256: sourceFingerprint },
      };
      if (name === "GetObjectCommand") return { Body: { transformToByteArray: async () => sourceBytes } };
      throw new Error(`unexpected command ${name}`);
    },
  };
  const store = createS3PrioritySourceStore(client, { bucket: "solvelang-priority-source" });
  const loaded = await store.getSource({ accountId, jobId, sourceFingerprint });
  assert.deepEqual(loaded.bytes, sourceBytes);
});

test("HTTPS provider executor sends bounded source evidence and returns only report receipt fields", async () => {
  const jobId = `job_${"c".repeat(32)}`;
  let request;
  const executor = createHttpsPriorityProviderExecutor({
    sourceStore: { getSource: async () => ({ bytes: sourceBytes, sourceFingerprint }) },
    providerUrl: "https://provider.example/v1/repository-audit",
    providerSecret: "provider-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ reportId: "report_123", provider: "repository-audit-v1", ignored: "secret" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await executor({ jobId, accountId, priority: "priority", sourceFingerprint, weightedCredits: 5 });
  assert.deepEqual(result, { reportId: "report_123", provider: "repository-audit-v1" });
  assert.equal(request.url, "https://provider.example/v1/repository-audit");
  assert.equal(request.options.headers["x-solvelang-source-sha256"], sourceFingerprint);
  assert.equal(request.options.headers.authorization.startsWith("Bearer "), true);
  assert.deepEqual(Buffer.from(request.options.body), sourceBytes);
});

test("worker provider execution fails closed unless every provider setting is present", () => {
  const base = { API_PRIORITY_JOBS_TABLE: "jobs", API_PRIORITY_LANE: "priority" };
  assert.equal(parsePriorityWorkerEnvironment(base).providerExecutionEnabled, false);
  assert.throws(() => parsePriorityWorkerEnvironment({ ...base, API_PRIORITY_PROVIDER_EXECUTION_ENABLED: "true" }), /SOURCE_BUCKET/);
  const configured = parsePriorityWorkerEnvironment({
    ...base,
    API_PRIORITY_PROVIDER_EXECUTION_ENABLED: "true",
    API_PRIORITY_SOURCE_BUCKET: "source-bucket",
    API_PRIORITY_PROVIDER_URL: "https://provider.example/audit",
    API_PRIORITY_PROVIDER_SECRET: "provider-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  });
  assert.equal(configured.providerExecutionEnabled, true);
});

test("production priority infrastructure is retained, protected, and entirely default-off", async () => {
  const template = await readFile(new URL("../priority-production-template.yaml", import.meta.url), "utf8");
  assert.match(template, /PriorityQueueEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /PriorityProviderExecutionEnabled:[\s\S]*?Default: "false"/);
  assert.match(template, /PointInTimeRecoveryEnabled: true/);
  assert.match(template, /DeletionPolicy: Retain/);
  assert.match(template, /BlockPublicAcls: true/);
  assert.match(template, /RestrictPublicBuckets: true/);
  assert.match(template, /VersioningConfiguration:[\s\S]*?Status: Enabled/);
  assert.match(template, /ExpirationInDays: 7/);
  assert.doesNotMatch(template, /Stripe|SubscriptionBilling|sk_live|charge/i);
});
