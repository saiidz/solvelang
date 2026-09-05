# PostHog canary claim-bound streaming transport v0

Status: **implemented injected transport boundary; no live provider activation**.

`solvelang.self-driving.posthog-canary-streaming-transport.v0` closes the response-buffering gap identified by the one-request canary design. It wraps the existing hardened `executePostHogReadPlan` boundary but requires an injected streaming transport whose body is an async stream of `Uint8Array` chunks.

No built-in `fetch`, PostHog SDK, credential resolver, secret-store client, project configuration, polling loop, or live network call is added by this module.

## Exact canary binding

Before authorization or transport, the wrapper revalidates:

- normalized owner approval schema/state;
- operation is only `read-errors` or `read-feature-flags`;
- canonical GET request plan;
- fixed first page `limit=25` with no cursor;
- successful atomic single-use claim;
- exact approval ID and request ID binding;
- zero-retry/no-rearm claim policy;
- canonical UTC claim timestamp.

The wrapper always executes the approval's canonical request plan. There is no caller-controlled URL, method, cursor, follow-up page, or request body.

## Streaming byte enforcement

The response body is consumed chunk by chunk and never allowed to exceed:

- **262144 raw bytes total**;
- **1024 chunks**.

Every chunk must be a `Uint8Array`. Invalid chunks, invalid UTF-8, chunk-count overflow, or byte overflow abort the child streaming signal and fail with a bounded transport error. The chunk that crosses the byte ceiling is not appended to the accumulated text, so the complete oversize body is never buffered by the core.

After the bounded stream completes, the existing hardened transport performs the canonical JSON parse and returns bounded in-memory `json` for the already-reviewed sanitizer pipeline. The canary result reports the raw streamed byte count rather than relying only on re-encoding the decoded string.

## Error-body minimization

Before reading a body, the wrapper checks response metadata sufficiently to identify unsafe envelopes. It closes/aborts the stream without consuming the body when the response is:

- non-2xx;
- redirected;
- on a final URL different from the approved URL;
- not `application/json`.

The existing hardened transport then emits its normal sanitized failure. Provider error-body content is not buffered or returned.

## Claim-to-request deadline

The wrapper receives a successful claim timestamp and computes the remaining time in the **10000ms total canary deadline**. If the deadline is already exhausted, it fails before either the injected auth callback or the injected transport callback runs.

The remaining time is passed to the existing aborting transport timer, so authorization plus streaming transport cannot run beyond the remainder of the claim deadline. External cancellation is also forwarded to the injected stream signal.

The post-run lifecycle contract additionally validates the final claim-to-completion timestamps, providing a second fail-closed check on the same 10-second boundary.

## One-call authority

Per invocation:

- injected ephemeral auth callback: exactly one attempt;
- injected streaming transport: exactly one call;
- retries: zero;
- redirect following: zero;
- automatic auth refresh: zero;
- pagination follow-up: zero.

The injected callbacks may later be implemented by an approved isolated runtime. This core module itself has no built-in network client or credential resolver and returns no credential material, raw headers, or raw error body.

## Still not a live canary

Issue #833 remains owner-gated. Even with atomic claim (#838), lifecycle/finalization (#846), and this streaming boundary, a real provider request still requires current least-privilege PostHog project/key verification, an approved isolated runtime and secret-store adapter, concrete retention/deletion/revocation operators, a tested kill switch, and fresh owner authorization for the exact one-run activation record.

No provider mutation, repository write, rollout/production/billing mutation, deployment, or Solve Runner authority is introduced here.
