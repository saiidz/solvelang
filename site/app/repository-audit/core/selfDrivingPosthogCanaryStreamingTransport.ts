import {
  POSTHOG_CANARY_CLAIM_SCHEMA,
  type NormalizedPostHogCanaryApproval,
  type PostHogCanaryClaimResult,
} from "./selfDrivingPosthogCanaryApproval";
import {
  executePostHogReadPlan,
  PostHogTransportFailure,
  type PostHogAuthProvider,
  type PostHogTransportRequest,
  type PostHogTransportResult,
} from "./selfDrivingPosthogTransport";

export const POSTHOG_CANARY_STREAMING_TRANSPORT_SCHEMA = "solvelang.self-driving.posthog-canary-streaming-transport.v0" as const;

export type PostHogStreamingTransportResponse = {
  status: number;
  contentType: string;
  finalUrl: string;
  body: AsyncIterable<Uint8Array>;
  redirected?: boolean;
};

export type PostHogStreamingTransport = (
  request: PostHogTransportRequest,
) => Promise<PostHogStreamingTransportResponse>;

export type PostHogCanaryStreamingTransportOptions = {
  signal?: AbortSignal;
  nowMs?: () => number;
};

export type PostHogCanaryStreamingTransportResult = PostHogTransportResult & {
  canary: {
    schema: typeof POSTHOG_CANARY_STREAMING_TRANSPORT_SCHEMA;
    approvalId: string;
    claimId: string;
    policy: {
      claimBound: true;
      fixedFirstPageOnly: true;
      maxBodyBytes: 262144;
      maxChunks: 1024;
      totalClaimDeadlineMs: 10000;
      streamingByteLimitEnforcedBeforeCompleteBuffer: true;
      injectedEphemeralAuthOnly: true;
      injectedStreamingTransportOnly: true;
      builtInCredentialResolver: false;
      builtInNetworkClient: false;
      non2xxBodyBuffered: false;
      redirectsAllowed: false;
      retries: 0;
      automaticAuthRefresh: false;
      paginationFollowup: false;
      credentialMaterialReturned: false;
      rawHeadersReturned: false;
      rawErrorBodyReturned: false;
      repositoryWriteAccess: false;
      rolloutMutationAccess: false;
      productionMutationAccess: false;
      billingMutationAccess: false;
      solveRunnerAuthority: false;
    };
    execution: {
      claimToStartElapsedMs: number;
      remainingDeadlineMsAtStart: number;
      authorizationCalls: 1;
      streamingTransportCalls: 1;
      streamedChunks: number;
      streamedBodyBytes: number;
    };
  };
};

export const defaultPostHogCanaryStreamingTransportLimits = Object.freeze({
  maxBodyBytes: 262_144,
  maxChunks: 1_024,
  totalClaimDeadlineMs: 10_000,
});

function normalizeUtcTimestamp(value: string, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`${name} must be an explicit canonical UTC timestamp.`);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${name} must be an explicit canonical UTC timestamp.`);
  }
  return value;
}

function normalizeContentType(value: string): string {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

function assertCanaryBinding(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
): { claimId: string; claimEpoch: number } {
  if (!approval || typeof approval !== "object") {
    throw new Error("Canary streaming transport requires a normalized approved canary.");
  }
  if (
    approval.schema !== "solvelang.self-driving.posthog-canary-approval.v0"
    || approval.state !== "approved"
    || (approval.operation !== "read-errors" && approval.operation !== "read-feature-flags")
    || approval.requestPlan.request.method !== "GET"
    || approval.requestPlan.request.origin !== approval.origin
    || approval.requestPlan.request.query.limit !== "25"
    || approval.requestPlan.request.query.cursor !== undefined
    || approval.requestPlan.policy.authorizationMaterialIncluded !== false
    || approval.requestPlan.policy.repositoryWriteAccess !== false
    || approval.requestPlan.policy.productionMutationAccess !== false
    || approval.requestPlan.policy.externalSideEffects !== false
  ) {
    throw new Error("Canary streaming transport requires the safe fixed first-page approval boundary.");
  }
  if (!claim || typeof claim !== "object") {
    throw new Error("Canary streaming transport requires a successful single-use claim.");
  }
  if (
    claim.schema !== POSTHOG_CANARY_CLAIM_SCHEMA
    || claim.status !== "claimed"
    || typeof claim.claimId !== "string"
    || claim.claimId.trim().length === 0
    || claim.claimId.length > 128
  ) {
    throw new Error("Canary streaming transport requires a successful single-use claim.");
  }
  if (
    claim.approvalId !== approval.approvalId
    || claim.requestId !== approval.requestPlan.request.id
    || claim.policy.atomicSingleUseClaimRequired !== true
    || claim.policy.approvalClaimMutationAttempted !== true
    || claim.policy.retries !== 0
    || claim.policy.automaticRearm !== false
    || claim.policy.credentialResolutionAccess !== false
    || claim.policy.providerNetworkAccess !== false
    || claim.policy.repositoryWriteAccess !== false
    || claim.policy.productionMutationAccess !== false
    || claim.policy.credentialMaterialReturned !== false
  ) {
    throw new Error("Canary streaming transport claim binding or policy does not match the approved request.");
  }
  const requestedAt = normalizeUtcTimestamp(claim.requestedAt, "claim.requestedAt");
  return { claimId: claim.claimId.trim(), claimEpoch: Date.parse(requestedAt) };
}

function assertClock(options: PostHogCanaryStreamingTransportOptions): number {
  if (options.nowMs !== undefined && typeof options.nowMs !== "function") {
    throw new Error("nowMs must be an injected clock function when provided.");
  }
  const now = options.nowMs ? options.nowMs() : Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Canary streaming transport clock must return a non-negative safe integer epoch timestamp.");
  }
  return now;
}

function assertAsyncByteStream(value: unknown): asserts value is AsyncIterable<Uint8Array> {
  if (!value || typeof value !== "object" || typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") {
    throw new PostHogTransportFailure(
      "transport",
      "PostHog streaming transport returned an invalid bounded byte stream.",
    );
  }
}

async function closeStream(body: AsyncIterable<Uint8Array>): Promise<void> {
  try {
    const iterator = body[Symbol.asyncIterator]();
    if (typeof iterator.return === "function") await iterator.return();
  } catch {
    // Closing is best-effort. Provider/stream detail is intentionally suppressed.
  }
}

function streamFailure(message: string): PostHogTransportFailure {
  return new PostHogTransportFailure("transport", message);
}

async function bufferBoundedStream(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  abort: () => void,
): Promise<{ body: string; bytes: number; chunks: number }> {
  assertAsyncByteStream(body);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textChunks: string[] = [];
  let bytes = 0;
  let chunks = 0;
  const iterator = body[Symbol.asyncIterator]();

  try {
    while (true) {
      if (signal.aborted) {
        abort();
        throw new PostHogTransportFailure("cancelled", "PostHog streaming read was cancelled.");
      }
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) {
        abort();
        throw streamFailure("PostHog streaming transport emitted a non-byte chunk.");
      }
      chunks += 1;
      if (chunks > defaultPostHogCanaryStreamingTransportLimits.maxChunks) {
        abort();
        throw streamFailure("PostHog streaming response exceeds the fixed chunk-count bound.");
      }
      bytes += chunk.byteLength;
      if (bytes > defaultPostHogCanaryStreamingTransportLimits.maxBodyBytes) {
        abort();
        throw streamFailure("PostHog streaming response exceeds the fixed 262144-byte bound.");
      }
      try {
        textChunks.push(decoder.decode(chunk, { stream: true }));
      } catch {
        abort();
        throw streamFailure("PostHog streaming response is not valid UTF-8 JSON text.");
      }
    }
    try {
      textChunks.push(decoder.decode());
    } catch {
      abort();
      throw streamFailure("PostHog streaming response is not valid UTF-8 JSON text.");
    }
    return { body: textChunks.join(""), bytes, chunks };
  } finally {
    if (typeof iterator.return === "function") {
      try {
        await iterator.return();
      } catch {
        // Stream-close detail is intentionally suppressed.
      }
    }
  }
}

export async function executePostHogCanaryStreamingRead(
  approval: NormalizedPostHogCanaryApproval,
  claim: PostHogCanaryClaimResult,
  authProvider: PostHogAuthProvider,
  streamingTransport: PostHogStreamingTransport,
  options: PostHogCanaryStreamingTransportOptions = {},
): Promise<PostHogCanaryStreamingTransportResult> {
  const binding = assertCanaryBinding(approval, claim);
  if (typeof authProvider !== "function" || typeof streamingTransport !== "function") {
    throw new Error("Canary streaming transport requires injected authorization and streaming transport callbacks.");
  }
  if (options.signal?.aborted) {
    throw new PostHogTransportFailure("cancelled", "PostHog streaming read was cancelled.");
  }

  const now = assertClock(options);
  if (now < binding.claimEpoch) {
    throw new Error("Canary streaming transport clock precedes the successful approval claim.");
  }
  const claimToStartElapsedMs = now - binding.claimEpoch;
  const remainingDeadlineMs = defaultPostHogCanaryStreamingTransportLimits.totalClaimDeadlineMs - claimToStartElapsedMs;
  if (remainingDeadlineMs <= 0) {
    throw new PostHogTransportFailure(
      "timeout",
      "PostHog canary total claim deadline expired before authorization or transport.",
    );
  }

  let authorizationCalls = 0;
  let streamingTransportCalls = 0;
  let streamedBodyBytes = 0;
  let streamedChunks = 0;

  const result = await executePostHogReadPlan(
    approval.requestPlan,
    async (context) => {
      authorizationCalls += 1;
      if (authorizationCalls !== 1) {
        throw new Error("Canary streaming transport permits exactly one authorization attempt.");
      }
      return authProvider(context);
    },
    async (request) => {
      streamingTransportCalls += 1;
      if (streamingTransportCalls !== 1) {
        throw streamFailure("Canary streaming transport permits exactly one transport request.");
      }

      const streamController = new AbortController();
      const onParentAbort = () => streamController.abort();
      request.signal.addEventListener("abort", onParentAbort, { once: true });
      try {
        const response = await streamingTransport({
          method: request.method,
          url: request.url,
          headers: request.headers,
          signal: streamController.signal,
        });
        if (!response || typeof response !== "object") {
          streamController.abort();
          throw streamFailure("PostHog streaming transport returned an invalid response envelope.");
        }
        assertAsyncByteStream(response.body);

        const safeMetadata =
          Number.isSafeInteger(response.status)
          && response.status >= 100
          && response.status <= 599
          && response.redirected !== true
          && response.finalUrl === request.url
          && normalizeContentType(response.contentType) === "application/json";
        const successfulStatus = Number.isSafeInteger(response.status) && response.status >= 200 && response.status <= 299;

        if (!safeMetadata || !successfulStatus) {
          streamController.abort();
          await closeStream(response.body);
          return {
            status: response.status,
            contentType: response.contentType,
            finalUrl: response.finalUrl,
            redirected: response.redirected,
            body: "",
          };
        }

        const buffered = await bufferBoundedStream(
          response.body,
          streamController.signal,
          () => streamController.abort(),
        );
        streamedBodyBytes = buffered.bytes;
        streamedChunks = buffered.chunks;
        return {
          status: response.status,
          contentType: response.contentType,
          finalUrl: response.finalUrl,
          redirected: response.redirected,
          body: buffered.body,
        };
      } finally {
        request.signal.removeEventListener("abort", onParentAbort);
      }
    },
    {
      maxBodyBytes: defaultPostHogCanaryStreamingTransportLimits.maxBodyBytes,
      timeoutMs: remainingDeadlineMs,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  if (authorizationCalls !== 1 || streamingTransportCalls !== 1) {
    throw new Error("Canary streaming transport did not preserve one-call execution semantics.");
  }

  return {
    ...result,
    execution: {
      bodyBytes: streamedBodyBytes,
    },
    canary: {
      schema: POSTHOG_CANARY_STREAMING_TRANSPORT_SCHEMA,
      approvalId: approval.approvalId,
      claimId: binding.claimId,
      policy: {
        claimBound: true,
        fixedFirstPageOnly: true,
        maxBodyBytes: defaultPostHogCanaryStreamingTransportLimits.maxBodyBytes,
        maxChunks: defaultPostHogCanaryStreamingTransportLimits.maxChunks,
        totalClaimDeadlineMs: defaultPostHogCanaryStreamingTransportLimits.totalClaimDeadlineMs,
        streamingByteLimitEnforcedBeforeCompleteBuffer: true,
        injectedEphemeralAuthOnly: true,
        injectedStreamingTransportOnly: true,
        builtInCredentialResolver: false,
        builtInNetworkClient: false,
        non2xxBodyBuffered: false,
        redirectsAllowed: false,
        retries: 0,
        automaticAuthRefresh: false,
        paginationFollowup: false,
        credentialMaterialReturned: false,
        rawHeadersReturned: false,
        rawErrorBodyReturned: false,
        repositoryWriteAccess: false,
        rolloutMutationAccess: false,
        productionMutationAccess: false,
        billingMutationAccess: false,
        solveRunnerAuthority: false,
      },
      execution: {
        claimToStartElapsedMs,
        remainingDeadlineMsAtStart: remainingDeadlineMs,
        authorizationCalls: 1,
        streamingTransportCalls: 1,
        streamedChunks,
        streamedBodyBytes,
      },
    },
  };
}
