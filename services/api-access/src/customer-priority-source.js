import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { customerPriorityJobId } from "./customer-priority-id.js";
import { MAX_SOURCE_BYTES } from "./priority-source-store.js";
import { PriorityJobError } from "./priority-jobs.js";

const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const DEFAULT_EXPIRES_SECONDS = 300;

function validateInput({ accountId, requestId, sourceFingerprint, byteLength }) {
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) throw new PriorityJobError(400, "invalid_account_id", "Account ID is invalid.");
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new PriorityJobError(400, "invalid_request", "Job request ID is invalid.");
  if (typeof sourceFingerprint !== "string" || !SHA256.test(sourceFingerprint)) throw new PriorityJobError(400, "invalid_source_fingerprint", "Source fingerprint is invalid.");
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_SOURCE_BYTES) throw new PriorityJobError(413, "source_size_invalid", "Priority source size is invalid.");
}

export function createCustomerPrioritySourceService({
  accountAccess,
  s3Client,
  bucket,
  queueEnabled = false,
  customerPriorityEnabled = false,
  getSignedUrlImpl = getSignedUrl,
  expiresSeconds = DEFAULT_EXPIRES_SECONDS,
}) {
  if (!accountAccess || typeof accountAccess.assertActive !== "function") throw new Error("Customer account access verifier is required.");
  if (!s3Client || typeof s3Client.send !== "function") throw new Error("Priority S3 client is required.");
  if (typeof bucket !== "string" || !bucket) throw new Error("Priority source bucket is required.");
  if (typeof getSignedUrlImpl !== "function") throw new Error("Priority source presigner is required.");
  if (!Number.isSafeInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 600) throw new Error("Priority source URL expiry is invalid.");

  function assertEnabled() {
    if (!queueEnabled || !customerPriorityEnabled) throw new PriorityJobError(503, "customer_priority_disabled", "Customer priority processing is not enabled.");
  }

  async function reserve(input = {}) {
    assertEnabled();
    validateInput(input);
    await accountAccess.assertActive(input.accountId);
    const jobId = customerPriorityJobId(input.accountId, input.requestId);
    const key = `customer/${input.accountId}/${jobId}/source.bin`;
    const requiredHeaders = {
      "content-type": "application/octet-stream",
      "x-amz-server-side-encryption": "AES256",
      "x-amz-meta-accountid": input.accountId,
      "x-amz-meta-jobid": jobId,
      "x-amz-meta-sha256": input.sourceFingerprint,
    };
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: requiredHeaders["content-type"],
      ServerSideEncryption: "AES256",
      Metadata: {
        accountid: input.accountId,
        jobid: jobId,
        sha256: input.sourceFingerprint,
      },
    });
    const uploadUrl = await getSignedUrlImpl(s3Client, command, { expiresIn: expiresSeconds });
    if (typeof uploadUrl !== "string" || !uploadUrl.startsWith("https://")) throw new Error("Priority source presigner returned an invalid URL.");
    return {
      jobId,
      sourceFingerprint: input.sourceFingerprint,
      byteLength: input.byteLength,
      uploadUrl,
      requiredHeaders,
      expiresInSeconds: expiresSeconds,
    };
  }

  return { reserve };
}

export { DEFAULT_EXPIRES_SECONDS };
