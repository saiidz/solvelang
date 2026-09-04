import type { SelfDrivingMode } from "./selfDriving";

export const SELF_DRIVING_PROVIDERS = ["posthog"] as const;
export type SelfDrivingProvider = (typeof SELF_DRIVING_PROVIDERS)[number];

export const PROVIDER_REGIONS = ["us", "eu"] as const;
export type ProviderRegion = (typeof PROVIDER_REGIONS)[number];

export const PROVIDER_READ_CAPABILITIES = [
  "product-events",
  "errors",
  "deployments",
  "feature-flags",
  "experiments",
  "ai-traces",
  "mcp-tool-calls",
] as const;
export type ProviderReadCapability = (typeof PROVIDER_READ_CAPABILITIES)[number];

export type ProviderConnectionBounds = {
  maxPages: number;
  maxRecords: number;
  maxResponseBytes: number;
  maxRequests: number;
  timeoutMs: number;
  lookbackMinutes: number;
};

export type ProviderConnectionPlanInput = {
  provider: SelfDrivingProvider;
  region: ProviderRegion;
  tenant: {
    projectLocator: string;
  };
  credentialRef: string;
  capabilities: ProviderReadCapability[];
  bounds?: Partial<ProviderConnectionBounds>;
  requestedMode?: SelfDrivingMode;
};

export type ProviderConnectionPlan = {
  schema: "solvelang.self-driving.provider-connection.v0";
  mode: "analyze-only";
  id: string;
  provider: SelfDrivingProvider;
  region: ProviderRegion;
  tenant: {
    projectLocator: string;
  };
  credential: {
    kind: "environment-variable-reference";
    reference: string;
    resolved: false;
  };
  capabilities: ProviderReadCapability[];
  bounds: ProviderConnectionBounds;
  redaction: {
    personIdentity: "drop";
    profileIdentity: "drop";
    sessionReplay: "reject";
    rawRequestBody: "reject";
    rawResponseBody: "reject";
    rawPrompt: "reject";
    rawCompletion: "reject";
    credentialsAndSecrets: "reject";
    headersAndCookies: "reject";
  };
  policy: {
    requestedMode: "observe";
    effectiveMode: "observe";
    explicitReadAllowlistOnly: true;
    arbitraryEndpointAccess: false;
    mutationEndpointAccess: false;
    networkAccess: false;
    credentialResolution: false;
    repositoryWriteAccess: false;
    rolloutMutationAccess: false;
    productionMutationAccess: false;
    externalSideEffects: false;
  };
};

export type PostHogReadIntent = {
  schema: "solvelang.self-driving.posthog-read-intent.v0";
  mode: "analyze-only";
  connectionPlanId: string;
  provider: "posthog";
  region: ProviderRegion;
  tenant: {
    projectLocator: string;
  };
  capability: ProviderReadCapability;
  expectedSignalKind:
    | "runtime-event"
    | "error"
    | "deployment"
    | "feature-flag"
    | "experiment"
    | "ai-trace"
    | "mcp-tool-call";
  bounds: ProviderConnectionBounds;
  execution: {
    status: "not-executed";
    networkRequests: 0;
    credentialResolutions: 0;
  };
  policy: {
    readOnly: true;
    arbitraryEndpointAccess: false;
    mutationEndpointAccess: false;
    networkAccess: false;
    credentialResolution: false;
    externalSideEffects: false;
  };
};

export const defaultProviderConnectionBounds: ProviderConnectionBounds = Object.freeze({
  maxPages: 10,
  maxRecords: 1_000,
  maxResponseBytes: 5 * 1024 * 1024,
  maxRequests: 20,
  timeoutMs: 10_000,
  lookbackMinutes: 24 * 60,
});

const hardMaximumBounds: ProviderConnectionBounds = Object.freeze({
  maxPages: 100,
  maxRecords: 5_000,
  maxResponseBytes: 20 * 1024 * 1024,
  maxRequests: 100,
  timeoutMs: 60_000,
  lookbackMinutes: 30 * 24 * 60,
});

const PROVIDER_CONNECTION_BOUND_KEYS = [
  "maxPages",
  "maxRecords",
  "maxResponseBytes",
  "maxRequests",
  "timeoutMs",
  "lookbackMinutes",
] as const;

type ProviderConnectionBoundKey = (typeof PROVIDER_CONNECTION_BOUND_KEYS)[number];

const expectedSignalKindByCapability: Record<ProviderReadCapability, PostHogReadIntent["expectedSignalKind"]> = {
  "product-events": "runtime-event",
  errors: "error",
  deployments: "deployment",
  "feature-flags": "feature-flag",
  experiments: "experiment",
  "ai-traces": "ai-trace",
  "mcp-tool-calls": "mcp-tool-call",
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul((left ^ code) >>> 0, 0x01000193) >>> 0;
    right = Math.imul((right ^ ((code + index) >>> 0)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

function assertEnum<T extends string>(value: string, allowed: readonly T[], name: string): asserts value is T {
  if (!allowed.includes(value as T)) throw new Error(`${name} is not supported: ${value}`);
}

function normalizeProjectLocator(value: string): string {
  if (typeof value !== "string") throw new Error("tenant.projectLocator must be a string.");
  const normalized = value.trim();
  if (!/^project:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error("tenant.projectLocator must use bounded project:<locator> syntax.");
  }
  return normalized;
}

function normalizeCredentialRef(value: string): string {
  if (typeof value !== "string") throw new Error("credentialRef must be a string.");
  const normalized = value.trim();
  if (!/^env:[A-Z][A-Z0-9_]{1,127}$/.test(normalized)) {
    throw new Error("credentialRef must be an environment-variable reference such as env:POSTHOG_PERSONAL_API_KEY; raw credential values are not accepted.");
  }
  return normalized;
}

function normalizeCapabilities(values: ProviderReadCapability[]): ProviderReadCapability[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one provider read capability is required.");
  }
  if (values.length > PROVIDER_READ_CAPABILITIES.length) {
    throw new Error("Provider capability input exceeds the bounded read-capability set.");
  }
  const seen = new Set<ProviderReadCapability>();
  const normalized = values.map((value, index) => {
    assertEnum(value, PROVIDER_READ_CAPABILITIES, `capabilities[${index}]`);
    if (seen.has(value)) throw new Error(`Duplicate provider capability is not allowed: ${value}`);
    seen.add(value);
    return value;
  });
  return normalized.sort(compareText);
}

function normalizeBounds(overrides: Partial<ProviderConnectionBounds> | undefined): ProviderConnectionBounds {
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error("bounds must be an object.");
    }
    for (const key of Object.keys(overrides)) {
      if (!PROVIDER_CONNECTION_BOUND_KEYS.includes(key as ProviderConnectionBoundKey)) {
        throw new Error(`bounds contains unsupported key: ${key}`);
      }
    }
  }

  const bounds: ProviderConnectionBounds = { ...defaultProviderConnectionBounds, ...(overrides ?? {}) };
  for (const key of PROVIDER_CONNECTION_BOUND_KEYS) {
    const value = bounds[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`bounds.${key} must be a positive safe integer.`);
    }
    if (value > hardMaximumBounds[key]) {
      throw new Error(`bounds.${key} exceeds the hard maximum of ${hardMaximumBounds[key]}.`);
    }
  }
  if (bounds.maxPages > bounds.maxRequests) {
    throw new Error("bounds.maxPages cannot exceed bounds.maxRequests.");
  }
  return bounds;
}

function canonicalPlanIdentity(plan: Omit<ProviderConnectionPlan, "id">): string {
  return JSON.stringify({
    provider: plan.provider,
    region: plan.region,
    tenant: plan.tenant,
    credential: plan.credential,
    capabilities: plan.capabilities,
    bounds: plan.bounds,
    redaction: plan.redaction,
    policy: plan.policy,
  });
}

function freezeProviderConnectionPlan(plan: ProviderConnectionPlan): ProviderConnectionPlan {
  Object.freeze(plan.tenant);
  Object.freeze(plan.credential);
  Object.freeze(plan.capabilities);
  Object.freeze(plan.bounds);
  Object.freeze(plan.redaction);
  Object.freeze(plan.policy);
  return Object.freeze(plan);
}

export function createProviderConnectionPlan(input: ProviderConnectionPlanInput): ProviderConnectionPlan {
  if (!input || typeof input !== "object") throw new Error("Provider connection input must be an object.");
  assertEnum(input.provider, SELF_DRIVING_PROVIDERS, "provider");
  assertEnum(input.region, PROVIDER_REGIONS, "region");
  if (!input.tenant || typeof input.tenant !== "object") throw new Error("tenant is required.");

  const requestedMode = input.requestedMode ?? "observe";
  if (requestedMode !== "observe") {
    throw new Error(`Provider connection mode '${requestedMode}' is not enabled. Connection planning is observe-only.`);
  }

  const normalizedWithoutId: Omit<ProviderConnectionPlan, "id"> = {
    schema: "solvelang.self-driving.provider-connection.v0",
    mode: "analyze-only",
    provider: input.provider,
    region: input.region,
    tenant: {
      projectLocator: normalizeProjectLocator(input.tenant.projectLocator),
    },
    credential: {
      kind: "environment-variable-reference",
      reference: normalizeCredentialRef(input.credentialRef),
      resolved: false,
    },
    capabilities: normalizeCapabilities(input.capabilities),
    bounds: normalizeBounds(input.bounds),
    redaction: {
      personIdentity: "drop",
      profileIdentity: "drop",
      sessionReplay: "reject",
      rawRequestBody: "reject",
      rawResponseBody: "reject",
      rawPrompt: "reject",
      rawCompletion: "reject",
      credentialsAndSecrets: "reject",
      headersAndCookies: "reject",
    },
    policy: {
      requestedMode: "observe",
      effectiveMode: "observe",
      explicitReadAllowlistOnly: true,
      arbitraryEndpointAccess: false,
      mutationEndpointAccess: false,
      networkAccess: false,
      credentialResolution: false,
      repositoryWriteAccess: false,
      rolloutMutationAccess: false,
      productionMutationAccess: false,
      externalSideEffects: false,
    },
  };

  const identity = canonicalPlanIdentity(normalizedWithoutId);
  return freezeProviderConnectionPlan({
    ...normalizedWithoutId,
    id: `provider_${stableHash(identity)}`,
  });
}

function revalidateProviderConnectionPlan(plan: ProviderConnectionPlan): ProviderConnectionPlan {
  if (!plan || typeof plan !== "object") throw new Error("A provider connection plan is required.");
  if (plan.schema !== "solvelang.self-driving.provider-connection.v0" || plan.mode !== "analyze-only") {
    throw new Error("PostHog read intents require a valid analyze-only provider connection plan.");
  }
  if (!plan.policy || typeof plan.policy !== "object") {
    throw new Error("Provider connection plan integrity check failed.");
  }
  if (
    plan.policy.networkAccess !== false
    || plan.policy.credentialResolution !== false
    || plan.policy.mutationEndpointAccess !== false
    || plan.policy.externalSideEffects !== false
  ) {
    throw new Error("Provider connection plan weakens the no-network/no-mutation policy boundary.");
  }
  if (
    !plan.tenant
    || typeof plan.tenant !== "object"
    || !plan.credential
    || typeof plan.credential !== "object"
    || !Array.isArray(plan.capabilities)
    || !plan.bounds
    || typeof plan.bounds !== "object"
  ) {
    throw new Error("Provider connection plan integrity check failed.");
  }
  if (plan.credential.kind !== "environment-variable-reference" || plan.credential.resolved !== false) {
    throw new Error("Provider connection plan integrity check failed.");
  }

  let canonical: ProviderConnectionPlan;
  try {
    canonical = createProviderConnectionPlan({
      provider: plan.provider,
      region: plan.region,
      tenant: { projectLocator: plan.tenant.projectLocator },
      credentialRef: plan.credential.reference,
      capabilities: [...plan.capabilities],
      bounds: { ...plan.bounds },
      requestedMode: "observe",
    });
  } catch {
    throw new Error("Provider connection plan integrity check failed.");
  }

  if (JSON.stringify(plan) !== JSON.stringify(canonical)) {
    throw new Error("Provider connection plan integrity check failed.");
  }
  return canonical;
}

export function createPostHogReadIntent(
  plan: ProviderConnectionPlan,
  capability: ProviderReadCapability,
): PostHogReadIntent {
  const canonicalPlan = revalidateProviderConnectionPlan(plan);
  if (canonicalPlan.provider !== "posthog") throw new Error("PostHog read intents require a PostHog provider plan.");
  assertEnum(capability, PROVIDER_READ_CAPABILITIES, "capability");
  if (!canonicalPlan.capabilities.includes(capability)) {
    throw new Error(`Capability '${capability}' is not allowlisted by provider connection plan ${canonicalPlan.id}.`);
  }

  return {
    schema: "solvelang.self-driving.posthog-read-intent.v0",
    mode: "analyze-only",
    connectionPlanId: canonicalPlan.id,
    provider: "posthog",
    region: canonicalPlan.region,
    tenant: { ...canonicalPlan.tenant },
    capability,
    expectedSignalKind: expectedSignalKindByCapability[capability],
    bounds: { ...canonicalPlan.bounds },
    execution: {
      status: "not-executed",
      networkRequests: 0,
      credentialResolutions: 0,
    },
    policy: {
      readOnly: true,
      arbitraryEndpointAccess: false,
      mutationEndpointAccess: false,
      networkAccess: false,
      credentialResolution: false,
      externalSideEffects: false,
    },
  };
}
