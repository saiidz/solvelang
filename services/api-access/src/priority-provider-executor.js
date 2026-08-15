const FIELD = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACCOUNT_ID = /^acct_[a-f0-9]{32}$/;
const JOB_ID = /^job_[a-f0-9]{32}$/;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

function cleanField(value, label) {
  if (typeof value !== "string" || !FIELD.test(value)) throw new Error(`Priority provider ${label} is invalid.`);
  return value;
}

export function createHttpsPriorityProviderExecutor({
  sourceStore,
  providerUrl,
  providerSecret,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
}) {
  if (!sourceStore || typeof sourceStore.getSource !== "function") throw new Error("Priority source store is required.");
  const endpoint = new URL(providerUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new Error("Priority provider URL must be a credential-free HTTPS URL.");
  if (typeof providerSecret !== "string" || providerSecret.length < 32 || providerSecret.length > 512) throw new Error("Priority provider secret is invalid.");
  if (typeof fetchImpl !== "function") throw new Error("Priority provider fetch implementation is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error("Priority provider timeout is invalid.");

  return async function executeCustomerJob({ jobId, accountId, priority, sourceFingerprint, weightedCredits }) {
    if (!JOB_ID.test(jobId ?? "") || !ACCOUNT_ID.test(accountId ?? "") || !SHA256.test(sourceFingerprint ?? "")) {
      throw new Error("Priority provider execution identity is invalid.");
    }
    if (!Number.isSafeInteger(weightedCredits) || weightedCredits < 1 || weightedCredits > 1_000_000) throw new Error("Priority provider weighted credits are invalid.");
    const source = await sourceStore.getSource({ accountId, jobId, sourceFingerprint });
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${providerSecret}`,
        "content-type": "application/octet-stream",
        "content-length": String(source.bytes.length),
        "x-solvelang-account-id": accountId,
        "x-solvelang-job-id": jobId,
        "x-solvelang-priority": cleanField(priority, "priority"),
        "x-solvelang-source-sha256": sourceFingerprint,
        "x-solvelang-weighted-credits": String(weightedCredits),
      },
      body: source.bytes,
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Priority provider response exceeded the limit.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Priority provider response exceeded the limit.");
    if (!response.ok) throw new Error(`Priority provider returned HTTP ${response.status}.`);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Priority provider response was invalid JSON.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Priority provider response was invalid.");
    return {
      reportId: cleanField(payload.reportId, "report ID"),
      provider: cleanField(payload.provider, "name"),
    };
  };
}

export { MAX_PROVIDER_RESPONSE_BYTES };
