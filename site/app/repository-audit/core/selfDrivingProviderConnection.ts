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
  const bounds = { ...defaultProviderConnectionBounds, ...(overrides ?? {}) };
  for (const [key, value] of Object.entries(bounds) as Array<[keyof ProviderConnectionBounds, number]>) {
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

export function createProviderConnectionPlan(input: ProviderConnectionPlanInput): ProviderConnectionPlan {
  if (!input || typeof input !== "object") throw new Error("Provider connection input must be an object.");
  assertEnum(input.provider, SELF_DRIVING_PROVIDERS, "provider");
  assertEnum(input.region, PROVIDER_REGIONS, "region");

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
      projectLocator: normalizeProjectLocator(input.tenant?.projectLocator),
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
  return {
    ...normalizedWithoutId,
    id: `provider_${stableHash(identity)}`,
  };
}

export function createPostHogReadIntent(
  plan: ProviderConnectionPlan,
  capability: ProviderReadCapability,
): PostHogReadIntent {
  if (!plan || typeof plan !== "object") throw new Error("A provider connection plan is required.");
  if (plan.schema !== "solvelang.self-driving.provider-connection.v0" || plan.mode !== "analyze-only") {
    throw new Error("PostHog read intents require a valid analyze-only provider connection plan.");
  }
  if (plan.provider !== "posthog") throw new Error("PostHog read intents require a PostHog provider plan.");
  if (
    plan.policy.networkAccess !== false
    || plan.policy.credentialResolution !== false
    || plan.policy.mutationEndpointAccess !== false
    || plan.policy.externalSideEffects !== false
  ) {
    throw new Error("Provider connection plan weakens the no-network/no-mutation policy boundary.");
  }
  assertEnum(capability, PROVIDER_READ_CAPABILITIES, "capability");
  if (!plan.capabilities.includes(capability)) {
    throw new Error(`Capability '${capability}' is not allowlisted by provider connection plan ${plan.id}.`);
  }

  return {
    schema: "solvelang.self-driving.posthog-read-intent.v0",
    mode: "analyze-only",
    connectionPlanId: plan.id,
    provider: "posthog",
    region: plan.region,
    tenant: { ...plan.tenant },
    capability,
    expectedSignalKind: expectedSignalKindByCapability[capability],
    bounds: { ...plan.bounds },
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
