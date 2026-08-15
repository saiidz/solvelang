import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { PriorityJobError } from "./priority-jobs.js";

const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const JOB_ID = /^job_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

function keyFor(accountId, jobId) {
  if (!ACCOUNT_ID.test(accountId ?? "") || !JOB_ID.test(jobId ?? "")) {
    throw new PriorityJobError(400, "invalid_source_identity", "Priority source identity is invalid.");
  }
  return `customer/${accountId}/${jobId}/source.bin`;
}

async function readBody(body, maximum = MAX_SOURCE_BYTES) {
  if (!body || typeof body.transformToByteArray !== "function") throw new Error("Priority source body is unavailable.");
  const bytes = Buffer.from(await body.transformToByteArray());
  if (bytes.length < 1 || bytes.length > maximum) throw new PriorityJobError(413, "source_size_invalid", "Priority source size is invalid.");
  return bytes;
}

export function createS3PrioritySourceStore(client, { bucket, maxBytes = MAX_SOURCE_BYTES } = {}) {
  if (!client || typeof client.send !== "function") throw new Error("S3 client is required.");
  if (typeof bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Priority source bucket is invalid.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_SOURCE_BYTES) throw new Error("Priority source maximum is invalid.");

  async function inspect({ accountId, jobId, sourceFingerprint }) {
    if (!SHA256.test(sourceFingerprint ?? "")) throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
    const key = keyFor(accountId, jobId);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const size = Number(head.ContentLength);
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) throw new PriorityJobError(413, "source_size_invalid", "Priority source size is invalid.");
    if (head.Metadata?.accountid !== accountId || head.Metadata?.jobid !== jobId || head.Metadata?.sha256 !== sourceFingerprint) {
      throw new PriorityJobError(409, "source_metadata_mismatch", "Priority source metadata does not match the job.");
    }
    return { key, byteLength: size, sourceFingerprint };
  }

  async function putSource({ accountId, jobId, bytes, sourceFingerprint }) {
    const body = Buffer.from(bytes ?? []);
    if (body.length < 1 || body.length > maxBytes) throw new PriorityJobError(413, "source_size_invalid", "Priority source size is invalid.");
    if (!SHA256.test(sourceFingerprint ?? "")) throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
    const actual = createHash("sha256").update(body).digest("hex");
    if (actual !== sourceFingerprint) throw new PriorityJobError(409, "source_fingerprint_mismatch", "Source fingerprint does not match uploaded source.");
    const key = keyFor(accountId, jobId);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
      Metadata: { accountid: accountId, jobid: jobId, sha256: sourceFingerprint },
      ServerSideEncryption: "AES256",
    }));
    return { key, byteLength: body.length, sourceFingerprint };
  }

  async function verifySource(input) {
    return inspect(input);
  }

  async function getSource(input) {
    const verified = await inspect(input);
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: verified.key }));
    const bytes = await readBody(object.Body, maxBytes);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== verified.sourceFingerprint) throw new PriorityJobError(409, "source_fingerprint_mismatch", "Stored priority source failed integrity verification.");
    return { bytes, ...verified };
  }

  return { putSource, verifySource, getSource, keyFor };
}

export { MAX_SOURCE_BYTES };
