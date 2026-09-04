import { assertPostHogProductEventsQueryRequestIntegrity, type PostHogAggregateQueryRequest } from "./selfDrivingPosthogQueryContract";
import { createPostHogTransportSimulationInvocation, simulatePostHogProductEventsTransport, type PostHogTransportSimulationInvocation, type PostHogTransportSimulationResult } from "./selfDrivingPosthogTransportSimulation";

type FixtureBinding = Readonly<{
  requestId: string;
  provider: "posthog";
  region: "us" | "eu";
  tenant: string;
  capability: "product-events";
  credentialRef: string;
  scope: "query:read";
}>;
type FixtureCredential = Readonly<{ kind: "fixture-only"; binding: FixtureBinding }>;
export type FixtureDependencies = {
  resolve: (binding: FixtureBinding) => Promise<FixtureCredential>;
  read: (invocation: PostHogTransportSimulationInvocation, handle: FixtureCredential) => Promise<unknown>;
};

// A reference-bound fake marker, never a token, environment lookup or secret.
export function fixtureCredential(binding: FixtureBinding): FixtureCredential {
  return Object.freeze({ kind: "fixture-only", binding });
}

type Status = "disabled" | "rejected" | "cancelled" | "timeout" | "complete";
type Result = Readonly<{
  schema: "solvelang.self-driving.injected-fixture.v0";
  status: Status;
  networkRequests: 0;
  realCredentialResolutions: 0;
  resolverInvocations: number;
  transportInvocations: number;
  result?: PostHogTransportSimulationResult;
}>;

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Trusted repository fakes only. Injection is not a sandbox for arbitrary code. */
export async function runInjectedFixtureTransport(
  input: PostHogAggregateQueryRequest,
  options: { mode?: string; dependencies?: FixtureDependencies; signal?: AbortSignal } = {},
): Promise<Result> {
  let resolverInvocations = 0;
  let transportInvocations = 0;
  const finish = (status: Status, result?: PostHogTransportSimulationResult): Result => Object.freeze({
    schema: "solvelang.self-driving.injected-fixture.v0", status, networkRequests: 0, realCredentialResolutions: 0,
    resolverInvocations, transportInvocations, ...(result ? { result } : {}),
  });
  if (options.mode === undefined || options.mode === "disabled") return finish("disabled");
  if (options.mode !== "fixture") return finish("rejected");
  const dependencies = options.dependencies;
  if (!dependencies || typeof dependencies.resolve !== "function" || typeof dependencies.read !== "function") return finish("disabled");
  const resolve = dependencies.resolve;
  const read = dependencies.read;
  const signal = options.signal;
  if (signal?.aborted) return finish("cancelled");

  let request: PostHogAggregateQueryRequest;
  try {
    assertPostHogProductEventsQueryRequestIntegrity(input);
    request = freezeDeep(structuredClone(input));
    assertPostHogProductEventsQueryRequestIntegrity(request);
  } catch {
    return finish("rejected");
  }
  const invocation = createPostHogTransportSimulationInvocation(request);
  const binding: FixtureBinding = Object.freeze({
    requestId: request.id, provider: request.provider, region: request.region,
    tenant: request.tenant.projectLocator, capability: request.capability,
    credentialRef: request.request.authorization.credentialRef, scope: "query:read",
  });
  let stopped = false;
  let stopReason: Status = "rejected";
  const started = performance.now();
  const checkStopped = () => {
    if (signal?.aborted) { stopped = true; stopReason = "cancelled"; }
    else if (performance.now() - started >= request.transportBounds.timeoutMs) { stopped = true; stopReason = "timeout"; }
    if (stopped) throw new Error("stopped");
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const stop = new Promise<never>((_, reject) => {
    abort = () => { stopped = true; stopReason = "cancelled"; reject(new Error("cancelled")); };
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { stopped = true; stopReason = "timeout"; reject(new Error("timeout")); }, request.transportBounds.timeoutMs);
  });
  const work = async () => {
    checkStopped();
    resolverInvocations++;
    const handle = await resolve(binding);
    checkStopped();
    if (stopped || !handle || handle.kind !== "fixture-only" || handle.binding !== binding
        || Object.keys(handle).sort().join(",") !== "binding,kind") throw new Error("rejected");
    transportInvocations++;
    const response = await read(invocation, fixtureCredential(binding));
    checkStopped();
    if (stopped || !response || typeof response !== "object" || Array.isArray(response)
        || Object.keys(response).sort().join(",") !== "fixture,requestId") throw new Error("rejected");
    const envelope = response as { requestId: unknown; fixture: unknown };
    if (envelope.requestId !== request.id) throw new Error("rejected");
    const result = simulatePostHogProductEventsTransport(request, envelope.fixture);
    checkStopped();
    return result;
  };
  try {
    return finish("complete", await Promise.race([work(), stop]));
  } catch {
    return finish(stopReason);
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
