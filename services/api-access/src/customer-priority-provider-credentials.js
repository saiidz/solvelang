const FULL_SECRET_ARN = /^arn:aws:secretsmanager:([a-z0-9-]+):([0-9]{12}):secret:([A-Za-z0-9/_+=.@-]{1,512})-([A-Za-z0-9]{6})$/;
const PRODUCTION_SECRET_PREFIX = "solvelang/priority/production/";
const MAX_SECRET_BYTES = 64 * 1024;

function cleanExpectedRegion(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-z0-9-]{3,32}$/.test(value)) {
    throw new Error("Priority provider secret region is invalid.");
  }
  return value;
}

function cleanExpectedAccountId(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]{12}$/.test(value)) {
    throw new Error("Priority provider secret account is invalid.");
  }
  return value;
}

export function parseCustomerPriorityProviderSecretArn(secretArn, { region, accountId } = {}) {
  if (typeof secretArn !== "string") {
    throw new Error("Priority provider secret ARN is required.");
  }
  const match = FULL_SECRET_ARN.exec(secretArn);
  if (!match) {
    throw new Error("Priority provider secret ARN must be a complete production Secrets Manager ARN.");
  }

  const expectedRegion = cleanExpectedRegion(region);
  const expectedAccountId = cleanExpectedAccountId(accountId);
  const [, secretRegion, secretAccountId, secretName] = match;

  if (!secretName.startsWith(PRODUCTION_SECRET_PREFIX)) {
    throw new Error("Priority provider secret must use the production priority namespace.");
  }
  if (expectedRegion && secretRegion !== expectedRegion) {
    throw new Error("Priority provider secret must be in the worker region.");
  }
  if (expectedAccountId && secretAccountId !== expectedAccountId) {
    throw new Error("Priority provider secret must be in the worker account.");
  }

  return secretArn;
}

export function createCustomerPriorityProviderCredentialLoader({
  secretArn,
  region,
  accountId,
  readSecret,
}) {
  const arn = parseCustomerPriorityProviderSecretArn(secretArn, { region, accountId });
  if (typeof readSecret !== "function") {
    throw new Error("Priority provider secret reader is required.");
  }

  return async function loadProviderCredential() {
    const response = await readSecret({ secretArn: arn });
    if (
      !response
      || typeof response !== "object"
      || Array.isArray(response)
      || response.secretArn !== arn
      || typeof response.secretValue !== "string"
      || response.secretValue.length === 0
      || Buffer.byteLength(response.secretValue, "utf8") > MAX_SECRET_BYTES
    ) {
      throw new Error("Priority provider secret response is invalid.");
    }
    return response.secretValue;
  };
}
