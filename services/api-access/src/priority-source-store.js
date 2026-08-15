import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PriorityJobError } from "./priority-jobs.js";

export const MAX_PRIORITY_SOURCE_BYTES = 5 * 1024 * 1024;
const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const ZIP_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);

function cleanAccountId(value) {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) {
    throw new PriorityJobError(400, "invalid_account_id", "Account ID is invalid.");
  }
  return value;
}

function cleanFingerprint(value) {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) {
    throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
  }
  return value;
}

function sourceKey(accountId, fingerprint) {
  return `customer/${cleanAccountId(accountId)}/${cleanFingerprint(fingerprint)}.zip`;
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new PriorityJobError(400, "invalid_source_archive", "Repository source must be a ZIP archive.");
}

function validateArchive(bytes) {
  if (bytes.length < 4 || bytes.length > MAX_PRIORITY_SOURCE_BYTES) {
    throw new PriorityJobError(413, "source_archive_too_large", "Repository source exceeds the upload limit.");
  }
  if (!ZIP_SIGNATURES.has(bytes.subarray(0, 4).toString("hex"))) {
    throw new PriorityJobError(400, "invalid_source_archive", "Repository source must be a ZIP archive.");
  }
}

async function bodyBytes(body) {
  if (!body) throw new Error("Stored priority source body is missing.");
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function missingSource(error) {
  return error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}

export function fingerprintPrioritySource(source) {
  const bytes = bytesOf(source);
  validateArchive(bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

export function createS3PrioritySourceStore(client, { bucketName }) {
  if (!client || typeof client.send !== "function") throw new Error("S3 client is required.");
  if (typeof bucketName !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error("Priority source bucket name is invalid.");
  }

  return {
    async putSource({ accountId, source }) {
      const bytes = bytesOf(source);
      validateArchive(bytes);
      const fingerprint = fingerprintPrioritySource(bytes);
      const key = sourceKey(accountId, fingerprint);
      await client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: bytes,
        ContentType: "application/zip",
        ServerSideEncryption: "AES256",
        Metadata: {
          "source-sha256": fingerprint,
          "source-bytes": String(bytes.length),
        },
      }));
      return { fingerprint, bytes: bytes.length };
    },

    async assertSource({ accountId, fingerprint }) {
      const key = sourceKey(accountId, fingerprint);
      let response;
      try {
        response = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      } catch (error) {
        if (missingSource(error)) {
          throw new PriorityJobError(404, "priority_source_not_found", "Repository source is not available.");
        }
        throw error;
      }
      const metadataFingerprint = response.Metadata?.["source-sha256"];
      const sourceBytes = Number(response.Metadata?.["source-bytes"] ?? response.ContentLength);
      if (metadataFingerprint !== fingerprint || !Number.isSafeInteger(sourceBytes) || sourceBytes < 4 || sourceBytes > MAX_PRIORITY_SOURCE_BYTES) {
        throw new Error("Stored priority source metadata is invalid.");
      }
      return { fingerprint, bytes: sourceBytes };
    },

    async getSource({ accountId, fingerprint }) {
      const key = sourceKey(accountId, fingerprint);
      const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
      const bytes = await bodyBytes(response.Body);
      validateArchive(bytes);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== fingerprint) throw new Error("Stored priority source fingerprint mismatch.");
      const metadataFingerprint = response.Metadata?.["source-sha256"];
      if (metadataFingerprint && metadataFingerprint !== fingerprint) throw new Error("Stored priority source metadata mismatch.");
      return bytes;
    },

    async deleteSource({ accountId, fingerprint }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: sourceKey(accountId, fingerprint) }));
    },
  };
}
