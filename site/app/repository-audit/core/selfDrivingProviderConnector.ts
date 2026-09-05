import type { SelfDrivingMode } from "./selfDriving";

export type ProviderReadOperationPolicy = {
  provider: string;
  operation: string;
  pathTemplate: string;
  tenantField: string;
};

export type ProviderConnectorPolicy = {
  provider: string;
  allowedOperations: ProviderReadOperationPolicy[];
  maxPageSize: number;
  maxPages: number;
  maxRecords: number;
  maxBytes: number;
  maxRetries: number;
  maxWallClockMs: number;
};

export type ProviderConnectorRequest = {
  requestedMode?: SelfDrivingMode;
  provider: string;
  operation: string;
  tenant: string;
  credentialRef: string;
  pageSize: number;
};

export type ProviderConnectorPage = {
  tenant: string;
  records: unknown[];
  bytes: number;
  nextCursor?: string;
};

export type ProviderPageFetcher = (input: {
  provider: string;
  operation: string;
  tenant: string;
  credentialRef: string;
  pageSize: number;
  cursor?: string;
  attempt: number;
}) => Promise<ProviderConnectorPage>;

export type ProviderConnectorResult = {
  schema: "solvelang.self-driving.provider-connector.v0";
  mode: "analyze-only";
  source: {
    provider: string;
    operation: string;
    tenant: string;
  };
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    readOnly: true;
    credentialMaterialReturned: false;
    arbitraryUrlAccess: false;
    writeMethodsAllowed: false;
    repositoryWriteAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
  execution: {
    status: "complete" | "partial";
    partialReasons: Array<"page-limit" | "record-limit" | "byte-limit" | "wall-clock-limit" | "cursor-cycle" | "retry-exhausted">;
    pages: number;
    records: number;
    bytes: number;
    retries: number;
  };
  records: unknown[];
};

const mutationVerbPattern = /(?:^|-)(?:create|update|delete|remove|write|mutate|patch|post|put|rollback|deploy|enable|disable|archive|restore|send)(?:-|$)/i;
const absoluteUrlPattern = /^https?:\/\//i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer.`);
}

function normalizeText(value: string, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty.`);
  if (normalized.length > maxLength) throw new Error(`${name} exceeds the ${maxLength}-character bound.`);
  if (/[\r\n\u0000-\u001f]/.test(normalized)) throw new Error(`${name} must be single-line sanitized text.`);
  return normalized;
}

function assertReadOperation(operation: string): void {
  if (mutationVerbPattern.test(operation)) throw new Error(`Operation '${operation}' is mutation-shaped and is not allowed.`);
  if (!operation.startsWith("read-")) throw new Error(`Operation '${operation}' is not explicitly read-only.`);
}

function validatePolicy(policy: ProviderConnectorPolicy): ProviderConnectorPolicy {
  const provider = normalizeText(policy.provider, "policy.provider", 64);
  assertPositiveSafeInteger(policy.maxPageSize, "policy.maxPageSize");
  assertPositiveSafeInteger(policy.maxPages, "policy.maxPages");
  assertPositiveSafeInteger(policy.maxRecords, "policy.maxRecords");
  assertPositiveSafeInteger(policy.maxBytes, "policy.maxBytes");
  if (!Number.isSafeInteger(policy.maxRetries) || policy.maxRetries < 0) throw new Error("policy.maxRetries must be a non-negative safe integer.");
  assertPositiveSafeInteger(policy.maxWallClockMs, "policy.maxWallClockMs");
  if (!Array.isArray(policy.allowedOperations) || policy.allowedOperations.length === 0) {
    throw new Error("policy.allowedOperations must declare at least one read operation.");
  }
  const seen = new Set<string>();
  const allowedOperations = policy.allowedOperations.map((item, index) => {
    const itemProvider = normalizeText(item.provider, `policy.allowedOperations[${index}].provider`, 64);
    const operation = normalizeText(item.operation, `policy.allowedOperations[${index}].operation`, 64);
    const pathTemplate = normalizeText(item.pathTemplate, `policy.allowedOperations[${index}].pathTemplate`, 256);
    const tenantField = normalizeText(item.tenantField, `policy.allowedOperations[${index}].tenantField`, 64);
    if (itemProvider !== provider) throw new Error("Provider operation policy must match the connector provider.");
    assertReadOperation(operation);
    if (absoluteUrlPattern.test(pathTemplate)) throw new Error("Provider operation paths must be relative allowlisted templates, not arbitrary absolute URLs.");
    if (!pathTemplate.startsWith("/")) throw new Error("Provider operation paths must start with '/'.");
    if (seen.has(operation)) throw new Error(`Duplicate provider operation policy '${operation}'.`);
    seen.add(operation);
    return { provider: itemProvider, operation, pathTemplate, tenantField };
  }).sort((left, right) => compareText(left.operation, right.operation));
  return { ...policy, provider, allowedOperations };
}

function findOperation(policy: ProviderConnectorPolicy, request: ProviderConnectorRequest): ProviderReadOperationPolicy {
  if (request.requestedMode !== undefined && request.requestedMode !== "observe") {
    throw new Error(`Provider connector mode '${request.requestedMode}' is not enabled. The connector is observe-only.`);
  }
  if (request.provider !== policy.provider) throw new Error("Provider request does not match the connector policy provider.");
  assertReadOperation(request.operation);
  const operation = policy.allowedOperations.find((item) => item.operation === request.operation);
  if (!operation) throw new Error(`Provider operation '${request.operation}' is not allowlisted for read-only collection.`);
  return operation;
}

function safeCredentialReference(value: string): string {
  const normalized = normalizeText(value, "credentialRef", 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(normalized)) throw new Error("credentialRef must be an opaque reference identifier.");
  if (/^(?:sk-|gh[pousr]_|bearer\s|akia)/i.test(normalized)) throw new Error("credentialRef appears to contain credential material; pass an opaque reference instead.");
  return normalized;
}

export async function collectReadOnlyProvider(
  rawPolicy: ProviderConnectorPolicy,
  request: ProviderConnectorRequest,
  fetchPage: ProviderPageFetcher,
  now: () => number = () => Date.now(),
): Promise<ProviderConnectorResult> {
  const policy = validatePolicy(rawPolicy);
  const operation = findOperation(policy, request);
  const tenant = normalizeText(request.tenant, "tenant", 160);
  const credentialRef = safeCredentialReference(request.credentialRef);
  assertPositiveSafeInteger(request.pageSize, "pageSize");
  if (request.pageSize > policy.maxPageSize) throw new Error(`pageSize cannot exceed ${policy.maxPageSize}.`);

  const startedAt = now();
  const records: unknown[] = [];
  const cursors = new Set<string>();
  const partialReasons = new Set<ProviderConnectorResult["execution"]["partialReasons"][number]>();
  let cursor: string | undefined;
  let pages = 0;
  let bytes = 0;
  let retries = 0;

  while (true) {
    if (pages >= policy.maxPages) {
      partialReasons.add("page-limit");
      break;
    }
    if (now() - startedAt >= policy.maxWallClockMs) {
      partialReasons.add("wall-clock-limit");
      break;
    }

    let page: ProviderConnectorPage | undefined;
    for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
      try {
        page = await fetchPage({
          provider: policy.provider,
          operation: operation.operation,
          tenant,
          credentialRef,
          pageSize: request.pageSize,
          ...(cursor ? { cursor } : {}),
          attempt,
        });
        break;
      } catch {
        if (attempt < policy.maxRetries) retries += 1;
      }
    }
    if (!page) {
      partialReasons.add("retry-exhausted");
      break;
    }
    if (page.tenant !== tenant) throw new Error("Provider response tenant does not match the requested tenant binding.");
    if (!Array.isArray(page.records)) throw new Error("Provider response records must be an array.");
    if (!Number.isSafeInteger(page.bytes) || page.bytes < 0) throw new Error("Provider response bytes must be a non-negative safe integer.");

    pages += 1;
    if (bytes + page.bytes > policy.maxBytes) {
      partialReasons.add("byte-limit");
      break;
    }
    bytes += page.bytes;

    const available = Math.max(0, policy.maxRecords - records.length);
    if (page.records.length > available) {
      records.push(...page.records.slice(0, available));
      partialReasons.add("record-limit");
      break;
    }
    records.push(...page.records);

    const nextCursor = page.nextCursor?.trim();
    if (!nextCursor) break;
    if (cursors.has(nextCursor) || nextCursor === cursor) {
      partialReasons.add("cursor-cycle");
      break;
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }

  const reasons = [...partialReasons].sort(compareText);
  return {
    schema: "solvelang.self-driving.provider-connector.v0",
    mode: "analyze-only",
    source: { provider: policy.provider, operation: operation.operation, tenant },
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      readOnly: true,
      credentialMaterialReturned: false,
      arbitraryUrlAccess: false,
      writeMethodsAllowed: false,
      repositoryWriteAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
    execution: {
      status: reasons.length === 0 ? "complete" : "partial",
      partialReasons: reasons,
      pages,
      records: records.length,
      bytes,
      retries,
    },
    records,
  };
}

export const POSTHOG_READONLY_CONNECTOR_POLICY: ProviderConnectorPolicy = Object.freeze({
  provider: "posthog",
  allowedOperations: [
    { provider: "posthog", operation: "read-events", pathTemplate: "/api/projects/{project}/events", tenantField: "project" },
    { provider: "posthog", operation: "read-errors", pathTemplate: "/api/projects/{project}/error_tracking/issues", tenantField: "project" },
    { provider: "posthog", operation: "read-feature-flags", pathTemplate: "/api/projects/{project}/feature_flags", tenantField: "project" },
  ],
  maxPageSize: 100,
  maxPages: 20,
  maxRecords: 1_000,
  maxBytes: 2_000_000,
  maxRetries: 2,
  maxWallClockMs: 15_000,
});
