# PostHog canary sanitized-evidence lifecycle v0

Status: **implemented core contract; live provider activation remains blocked**.

`solvelang.self-driving.posthog-canary-lifecycle.v0` implements the post-claim evidence and retention boundary for the owner-gated one-request canary. It does not send a PostHog request, resolve a credential, persist evidence, revoke a key, or activate the canary.

## Inputs and binding

The lifecycle accepts only:

- a normalized approved `solvelang.self-driving.posthog-canary-approval.v0`;
- a successful `solvelang.self-driving.posthog-canary-claim.v0` whose approval ID and canonical request ID match that approval;
- bounded caller-supplied sanitized audit metadata.

The record binds the approval/claim/request IDs, exact source revision, reviewed adapter revision, project, regional origin, and operation. The approval's credential reference, credential scope, tenant identity, operator identity, and runtime identity are intentionally not returned in the durable lifecycle artifact.

## Sanitized evidence only

The record may contain only:

- fixed outcome (`succeeded`, `failed`, or `cancelled`) and, for failure, one fixed failure category;
- attempt count fixed to one;
- UTC start/end timestamps and total duration from claim time;
- bounded response-byte and accepted-record counts;
- explicit bounded partiality reasons;
- an optional `sha256:<64hex>` integrity digest of the **sanitized artifact**; success requires the digest;
- opaque private evidence-destination reference;
- bounded unique authorized-reader references;
- deletion-owner reference and exact deletion deadline.

Raw provider JSON, raw request/response bodies, raw headers/cookies, raw payload digests, provider error text, and credential material are not accepted as evidence fields.

## Enforced limits

- one attempt, zero retries, no automatic re-arm;
- total lifecycle deadline: at most 10 seconds from successful approval claim through completion evidence;
- response body metadata ceiling: 262144 bytes;
- accepted records: at most 25;
- retention deadline must be after completion and no later than the owner-approved `retentionHours` ceiling, which the approval contract itself limits to 24 hours;
- source revision must be an exact 40- or 64-hex revision;
- evidence/reader/owner references are bounded opaque references, not HTTP(S) URLs or credential material.

These checks validate the evidence contract. They do **not** replace the still-required streaming network adapter that must enforce the byte/deadline/abort limits before buffering provider bytes.

## Claim finalization

`solvelang.self-driving.posthog-canary-finalization.v0` requires an injected atomic finalizer. It is called exactly once per invocation with the approval ID, claim ID, request ID, lifecycle ID, and terminal state:

- successful attempt -> `consumed`;
- failed or cancelled attempt -> `invalidated`.

The core never retries the finalizer and never re-arms an approval. Dependency exceptions and malformed results become fixed `finalizer-failure` or `invalid-finalizer-result` categories rather than leaking provider/store detail. A replay may be rejected as already finalized and remains non-reusable.

No concrete external finalization store is configured by this contract.

## Disable and revocation requirements

Every lifecycle record carries the deterministic required-action checklist:

1. abort active work;
2. disallow the approval ID;
3. remove the runtime credential reference;
4. have the owner revoke the canary key;
5. verify a later attempt fails before credential resolution;
6. delete retained sanitized evidence by the recorded deadline.

The checklist is explicitly `required-actions-not-executed`. The core has no key-revocation API access, credential access, durable sink access, provider network access, repository write access, rollout/production/billing mutation, deployment authority, or Solve Runner authority.

## Remaining live-canary gates

Issue #833 remains open. Before any real provider request, the project still needs a reviewed external streaming/body-limited transport with abort/deadline enforcement, an approved isolated runtime and secret-store integration, current least-privilege PostHog scope/project verification, concrete retention/deletion and revocation operators, and fresh owner authorization for the exact one-run record. Unit/fixture success here does not authorize a live canary.
