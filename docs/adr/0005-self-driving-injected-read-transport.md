# ADR 0005: Injected read transport and credential boundary

**Status:** repository contract for fake-only implementation; live activation requires a new owner authorization.

## Existing boundary

The observe-only train through #799 already validates exact PostHog provider/region/project/capability/query identity, budgets, aggregate response shape, and structural redaction. `selfDrivingPosthogTransportSimulation` consumes supplied fixtures and performs zero credential resolutions or network requests. This ADR preserves that implementation; it does not rename fixture execution as a live connection.

## Contract

The next coordinator accepts an immutable, integrity-revalidated `PostHogAggregateQueryRequest` and explicitly injected dependencies. Missing dependencies or omitted/disabled mode return a disabled result **before calling either dependency**. Only a literal `fixture` mode is implemented at this stage; `live`, `pr`, `auto`, unknown modes, and caller-supplied URLs/methods/headers are rejected.

1. Canonicalize/revalidate the request before any dependency call. Derive provider, region, tenant, capability, exact host/path/method/body, credential reference and budgets only from the validated request. Freeze/copy nested inputs before awaiting anything; a mutable caller object cannot redirect the later invocation.
2. The injected credential resolver receives only a structured binding: request ID, provider, region, tenant, capability, credential reference, and required read scopes. Fixture resolution returns an opaque fake handle bound to that exact tuple. It never reads environment variables, files, a secret manager, or browser storage. Real secret material must never enter the browser/core graph or serializable reports.
3. The injected read transport receives the canonical frozen invocation and that opaque handle. It exposes no arbitrary URL, generic HTTP, shell, SDK, query-text, redirect-following, pagination, retry, or mutation interface. Only the already-reviewed aggregate query is eligible; a provider POST used for an allowlisted aggregate read is not general POST authority.
4. The coordinator permits at most one resolution and one fixture response per request. Enforce bounded body/response bytes, request/page/record counts and elapsed time through the existing query/simulation validators. A timeout/cancellation invalidates the result; late promises cannot publish evidence. No automatic retries, partial raw-response persistence, fallback credentials, or redirect recovery.
5. Revalidate exact response identity and all aggregate/redaction constraints before normalizing into Context. Resolver/transport exceptions become a fixed sanitized error category, never arbitrary exception text, headers, response body, secrets, person IDs, replay data, prompts, or completions.
6. Output retains deterministic request/plan/invocation IDs and explicit `fixture-only`, networkRequests=0, realCredentialResolutions=0 evidence. Stable IDs establish correlation, not cryptographic authenticity or authorization. Dependency invocation counts are reported separately from live activity.

Injected dependencies are trusted code within the repository test process, not sandboxed plugins. Tests use repository-owned fakes only. Accepting an injected function does not prove that an arbitrary implementation is read-only; wiring a real implementation is a separate reviewed server-side boundary and explicit owner gate. There is no production entrypoint, endpoint, secret wiring, provider SDK, environment activation switch, or live implementation in this stage.

## Required fixture verification

- Default/disabled/unknown modes call neither dependency; observe-only orchestration remains unchanged.
- Tampered provider/region/tenant/capability/reference/request/body/budget fails before resolution.
- Wrong credential binding, expired/cancelled request, invalid response identity/count/size/redaction, and exceptions fail closed without raw detail.
- Mutation during an awaited resolution cannot change the invocation; stale/late completion cannot emit Context.
- Repeated valid fake runs produce deterministic sanitized evidence and never touch network/environment/storage.

## Later authority stages

Suggestion mode may produce only bounded non-applied patch artifacts tied to exact source identity and a validation plan. It must not execute source, install dependencies, alter files, or create branches/PRs. A separate least-privilege GitHub write-policy ADR must precede any PR-mode implementation and cover allowed branches/paths, owner approvals, exact-head validation, credential scope, rollback, and immutable audit evidence. Neither that future ADR nor a finding grants permission to enable writes, rollout changes, automatic merges, or auto mode.
