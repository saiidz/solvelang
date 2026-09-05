import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPostHogCanaryApproval,
  normalizePostHogCanaryApproval,
  POSTHOG_CANARY_APPROVAL_SCHEMA,
  type NormalizedPostHogCanaryApproval,
  type PostHogCanaryApprovalInput,
  type PostHogCanaryClaimResult,
} from "./selfDrivingPosthogCanaryApproval";
import {
  PostHogTransportFailure,
  type PostHogAuthProvider,
} from "./selfDrivingPosthogTransport";
import {
  defaultPostHogCanaryStreamingTransportLimits,
  executePostHogCanaryStreamingRead,
  type PostHogStreamingTransport,
  type PostHogStreamingTransportResponse,
} from "./selfDrivingPosthogCanaryStreamingTransport";

const CLAIM_EPOCH = Date.parse("2026-09-05T14:00:00.000Z");
const AUTHORIZATION = "Bearer fixture_readonly_token_12345678";

function approvalInput(overrides: Partial<PostHogCanaryApprovalInput> = {}): PostHogCanaryApprovalInput {
  return {
    schema: POSTHOG_CANARY_APPROVAL_SCHEMA,
    state: "approved",
    approvalId: "approval-stream-001",
    tenantId: "tenant:solve-owner",
    systemBoundary: "self-driving-posthog-canary",
    project: "12345",
    origin: "https://us.posthog.com",
    operation: "read-errors",
    credentialRef: "secret-store/posthog/canary-readonly",
    credentialScope: "verified-project-read-scope",
    operator: "owner-operator",
    runtime: "isolated-canary-runtime",
    adapterRevision: "adapter-revision-001",
    notBefore: "2026-09-05T14:00:00Z",
    expiresAt: "2026-09-05T14:10:00Z",
    retentionHours: 24,
    ...overrides,
  };
}

async function approvalAndClaim(
  overrides: Partial<PostHogCanaryApprovalInput> = {},
): Promise<{ approval: NormalizedPostHogCanaryApproval; claim: PostHogCanaryClaimResult }> {
  const input = approvalInput(overrides);
  const approval = normalizePostHogCanaryApproval(input);
  const claim = await claimPostHogCanaryApproval(
    input,
    async () => ({ status: "claimed", claimId: "claim-stream-001" }),
    { now: "2026-09-05T14:00:00Z" },
  );
  assert.equal(claim.status, "claimed");
  return { approval, claim };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function* stream(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

function authProvider(counter?: { calls: number }): PostHogAuthProvider {
  return async () => {
    if (counter) counter.calls += 1;
    return { authorization: AUTHORIZATION };
  };
}

function successResponse(url: string, body: AsyncIterable<Uint8Array>): PostHogStreamingTransportResponse {
  return {
    status: 200,
    contentType: "application/json; charset=utf-8",
    finalUrl: url,
    body,
    redirected: false,
  };
}

test("streams bounded JSON through the existing hardened parser with one auth and transport call", async () => {
  const { approval, claim } = await approvalAndClaim();
  const auth = { calls: 0 };
  const transport = { calls: 0 };
  let seenAuthorization = "";
  const result = await executePostHogCanaryStreamingRead(
    approval,
    claim,
    authProvider(auth),
    async (request) => {
      transport.calls += 1;
      seenAuthorization = request.headers.Authorization;
      return successResponse(request.url, stream(bytes('{"results":'), bytes("[]}")));
    },
    { nowMs: () => CLAIM_EPOCH + 100 },
  );

  assert.deepEqual(result.json, { results: [] });
  assert.equal(result.execution.bodyBytes, 14);
  assert.equal(result.canary.schema, "solvelang.self-driving.posthog-canary-streaming-transport.v0");
  assert.equal(result.canary.approvalId, "approval-stream-001");
  assert.equal(result.canary.claimId, "claim-stream-001");
  assert.equal(result.canary.execution.claimToStartElapsedMs, 100);
  assert.equal(result.canary.execution.remainingDeadlineMsAtStart, 9900);
  assert.equal(result.canary.execution.authorizationCalls, 1);
  assert.equal(result.canary.execution.streamingTransportCalls, 1);
  assert.equal(result.canary.execution.streamedChunks, 2);
  assert.equal(result.canary.execution.streamedBodyBytes, 14);
  assert.equal(auth.calls, 1);
  assert.equal(transport.calls, 1);
  assert.equal(seenAuthorization, AUTHORIZATION);
  assert.equal(result.canary.policy.maxBodyBytes, 262144);
  assert.equal(result.canary.policy.maxChunks, 1024);
  assert.equal(result.canary.policy.totalClaimDeadlineMs, 10000);
  assert.equal(result.canary.policy.streamingByteLimitEnforcedBeforeCompleteBuffer, true);
  assert.equal(result.canary.policy.injectedEphemeralAuthOnly, true);
  assert.equal(result.canary.policy.injectedStreamingTransportOnly, true);
  assert.equal(result.canary.policy.builtInCredentialResolver, false);
  assert.equal(result.canary.policy.builtInNetworkClient, false);
  assert.equal(result.canary.policy.non2xxBodyBuffered, false);
  assert.equal(result.canary.policy.redirectsAllowed, false);
  assert.equal(result.canary.policy.retries, 0);
  assert.equal(result.canary.policy.automaticAuthRefresh, false);
  assert.equal(result.canary.policy.paginationFollowup, false);
  assert.equal(result.canary.policy.credentialMaterialReturned, false);
});

test("accepts exactly 262144 raw bytes and reports the streamed byte count", async () => {
  const { approval, claim } = await approvalAndClaim();
  const body = `{"x":"${"a".repeat(262136)}"}`;
  assert.equal(bytes(body).byteLength, defaultPostHogCanaryStreamingTransportLimits.maxBodyBytes);

  const result = await executePostHogCanaryStreamingRead(
    approval,
    claim,
    authProvider(),
    async (request) => successResponse(request.url, stream(bytes(body))),
    { nowMs: () => CLAIM_EPOCH },
  );
  assert.equal(result.execution.bodyBytes, 262144);
  assert.equal((result.json as { x: string }).x.length, 262136);
});

test("oversize stream aborts before a complete body can be buffered", async () => {
  const { approval, claim } = await approvalAndClaim();
  let signalAborted = false;
  let thirdChunkReached = false;

  const transport: PostHogStreamingTransport = async (request) => {
    request.signal.addEventListener("abort", () => {
      signalAborted = true;
    }, { once: true });
    async function* body(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(200_000).fill(97);
      yield new Uint8Array(70_000).fill(98);
      thirdChunkReached = true;
      yield bytes("secret-body-must-not-be-read");
    }
    return successResponse(request.url, body());
  };

  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      transport,
      { nowMs: () => CLAIM_EPOCH },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure
      && error.category === "transport"
      && /262144-byte bound/.test(error.message),
  );
  assert.equal(signalAborted, true);
  assert.equal(thirdChunkReached, false);
});

test("chunk-count limit aborts pathological streams", async () => {
  const { approval, claim } = await approvalAndClaim();
  let aborted = false;
  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      async (request) => {
        request.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
        async function* body(): AsyncGenerator<Uint8Array> {
          for (let index = 0; index < 1025; index += 1) yield new Uint8Array(0);
        }
        return successResponse(request.url, body());
      },
      { nowMs: () => CLAIM_EPOCH },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure
      && error.category === "transport"
      && /chunk-count bound/.test(error.message),
  );
  assert.equal(aborted, true);
});

test("invalid stream chunks and invalid UTF-8 abort with sanitized transport failures", async () => {
  const { approval, claim } = await approvalAndClaim();
  const invalidChunk = {
    async *[Symbol.asyncIterator]() {
      yield "not-bytes" as unknown as Uint8Array;
    },
  };
  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      async (request) => successResponse(request.url, invalidChunk),
      { nowMs: () => CLAIM_EPOCH },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure && /non-byte chunk/.test(error.message),
  );

  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      async (request) => successResponse(request.url, stream(new Uint8Array([0xff]))),
      { nowMs: () => CLAIM_EPOCH },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure && /valid UTF-8 JSON text/.test(error.message),
  );
});

test("non-2xx provider body is never consumed or returned", async () => {
  const { approval, claim } = await approvalAndClaim();
  let bodyTouched = false;
  const secret = "provider-secret-error-body";

  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      async (request) => {
        async function* body(): AsyncGenerator<Uint8Array> {
          bodyTouched = true;
          yield bytes(secret);
        }
        return {
          status: 401,
          contentType: "application/json",
          finalUrl: request.url,
          body: body(),
          redirected: false,
        };
      },
      { nowMs: () => CLAIM_EPOCH },
    ),
    (error: unknown) => error instanceof Error
      && /HTTP 401/.test(error.message)
      && !error.message.includes(secret),
  );
  assert.equal(bodyTouched, false);
});

test("redirect, final-URL mismatch and non-JSON envelopes are rejected without consuming bodies", async () => {
  const { approval, claim } = await approvalAndClaim();
  const cases = [
    { redirected: true, finalUrl: "same", contentType: "application/json", expected: /redirects are not allowed/ },
    { redirected: false, finalUrl: "other", contentType: "application/json", expected: /final URL does not match/ },
    { redirected: false, finalUrl: "same", contentType: "text/html", expected: /must return application\/json/ },
  ] as const;

  for (const item of cases) {
    let touched = false;
    await assert.rejects(
      executePostHogCanaryStreamingRead(
        approval,
        claim,
        authProvider(),
        async (request) => {
          async function* body(): AsyncGenerator<Uint8Array> {
            touched = true;
            yield bytes("raw-body-must-not-be-read");
          }
          return {
            status: 200,
            contentType: item.contentType,
            finalUrl: item.finalUrl === "same" ? request.url : "https://us.posthog.com/other",
            body: body(),
            redirected: item.redirected,
          };
        },
        { nowMs: () => CLAIM_EPOCH },
      ),
      item.expected,
    );
    assert.equal(touched, false);
  }
});

test("claim-deadline exhaustion fails before authorization and transport callbacks", async () => {
  const { approval, claim } = await approvalAndClaim();
  const auth = { calls: 0 };
  const transport = { calls: 0 };

  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(auth),
      async (request) => {
        transport.calls += 1;
        return successResponse(request.url, stream(bytes("{}")));
      },
      { nowMs: () => CLAIM_EPOCH + 10_000 },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure
      && error.category === "timeout"
      && /expired before authorization or transport/.test(error.message),
  );
  assert.equal(auth.calls, 0);
  assert.equal(transport.calls, 0);
});

test("remaining claim deadline drives timeout and aborts the injected stream transport", async () => {
  const { approval, claim } = await approvalAndClaim();
  let transportSignalAborted = false;

  await assert.rejects(
    executePostHogCanaryStreamingRead(
      approval,
      claim,
      authProvider(),
      async (request) => {
        request.signal.addEventListener("abort", () => { transportSignalAborted = true; }, { once: true });
        return successResponse(request.url, {
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) => {
              if (request.signal.aborted) return resolve();
              request.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            return;
          },
        });
      },
      { nowMs: () => CLAIM_EPOCH + 9_990 },
    ),
    (error: unknown) => error instanceof PostHogTransportFailure && error.category === "timeout",
  );
  assert.equal(transportSignalAborted, true);
});

test("external cancellation propagates to the injected streaming transport", async () => {
  const { approval, claim } = await approvalAndClaim();
  const controller = new AbortController();
  let transportSignalAborted = false;

  const promise = executePostHogCanaryStreamingRead(
    approval,
    claim,
    authProvider(),
    async (request) => {
      request.signal.addEventListener("abort", () => { transportSignalAborted = true; }, { once: true });
      setTimeout(() => controller.abort(), 0);
      return successResponse(request.url, {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) return resolve();
            request.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        },
      });
    },
    { nowMs: () => CLAIM_EPOCH, signal: controller.signal },
  );
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof PostHogTransportFailure && error.category === "cancelled",
  );
  assert.equal(transportSignalAborted, true);
});

test("forged claim binding and exhausted or backwards clocks fail closed", async () => {
  const { approval, claim } = await approvalAndClaim();
  const safeTransport: PostHogStreamingTransport = async (request) => successResponse(request.url, stream(bytes("{}")));

  for (const forged of [
    { ...claim, approvalId: "other" },
    { ...claim, requestId: "phr_other" },
    { ...claim, policy: { ...claim.policy, automaticRearm: true } },
  ] as PostHogCanaryClaimResult[]) {
    await assert.rejects(
      executePostHogCanaryStreamingRead(approval, forged, authProvider(), safeTransport, { nowMs: () => CLAIM_EPOCH }),
      /claim binding or policy does not match/,
    );
  }

  await assert.rejects(
    executePostHogCanaryStreamingRead(approval, claim, authProvider(), safeTransport, { nowMs: () => CLAIM_EPOCH - 1 }),
    /clock precedes the successful approval claim/,
  );
});

test("serialized successful result excludes injected credential, approval secret refs, raw headers and error bodies", async () => {
  const { approval, claim } = await approvalAndClaim();
  const result = await executePostHogCanaryStreamingRead(
    approval,
    claim,
    authProvider(),
    async (request) => successResponse(request.url, stream(bytes('{"results":[]}'))),
    { nowMs: () => CLAIM_EPOCH },
  );
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /fixture_readonly_token_12345678/);
  assert.doesNotMatch(serialized, /secret-store\/posthog\/canary-readonly|verified-project-read-scope|tenant:solve-owner|owner-operator/);
  assert.doesNotMatch(serialized, /"(?:Authorization|headers|rawErrorBody|responseBody)"\s*:/i);
  assert.equal(result.policy.credentialMaterialReturned, false);
  assert.equal(result.policy.rawHeadersReturned, false);
  assert.equal(result.policy.rawErrorBodyReturned, false);
  assert.equal(result.canary.policy.credentialMaterialReturned, false);
});
