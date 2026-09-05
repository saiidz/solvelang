# PostHog read-only canary contract

Status: **design only; activation blocked**. The repository has fixture-tested request planning, injected transport and concrete sanitizers. It has no approved live project, credential installation or canary execution. This document does not authorize a provider connection. Billing, managed execution, repository writes and provider mutation remain off.

## Owner-controlled activation record

Before a canary, an owner must approve a record identifying all of the following. Missing, ambiguous or expired values mean no request and no credential resolution.

| Field | Required decision |
| --- | --- |
| Tenant and system | Exact tenant ID and approved system boundary; no cross-tenant credentials |
| Project | One canonical positive numeric PostHog project ID |
| Region and origin | Exactly one reviewed regional origin: `https://us.posthog.com` or `https://eu.posthog.com`; no automatic region discovery |
| Operation | Exactly one of `read-errors` or `read-feature-flags` |
| Endpoint | Exact project-substituted path from the table below |
| Credential | Owner-approved secret-store location and reference, never the value in code, issues, logs or reports |
| Scope | Exact currently verified provider read scope for that endpoint, limited to the approved project; no write, replay or person-profile authority |
| Execution | Named operator, approved runtime, reviewed adapter revision, start/end window and one-run approval ID |
| Evidence destination | Approved local/private destination, authorized readers and deletion deadline |
| Stop control | Operator able to abort the request and revoke the reference/key immediately |

Scope names and account-level project restrictions must be verified against the owner's current PostHog configuration before approval. They are not inferred from a successful fixture or a broadly capable API key. If the provider cannot enforce the requested credential boundary, park activation for a separate security decision; do not silently substitute broader access.

## Exact request and limits

| Operation | Method and path |
| --- | --- |
| `read-errors` | `GET /api/projects/{project}/error_tracking/issues/` |
| `read-feature-flags` | `GET /api/projects/{project}/feature_flags/` |

- One operator-triggered request total, one operation, one project; no scheduler or background polling.
- Query is exactly `limit=25`. No cursor, offset, targeting properties or pagination follow-up.
- At most 25 records accepted; reject an over-returning provider rather than claiming the extra records were approved.
- At most 262144 response-body bytes, enforced while streaming by the reviewed external transport **before** buffering/JSON parsing. The existing core's post-return body check alone is not a streaming network adapter.
- Ten-second total deadline covering credential resolution and transport; abort signal must stop the underlying request. Connection timeout at most five seconds.
- Zero retries, zero redirects and zero automatic authentication refresh. A 429, 401, 403, 5xx, timeout or malformed response stops the run. A later attempt requires new approval.
- HTTPS certificate verification remains enabled. The adapter must reject any URL/region/project mismatch before sending credentials.
- No cookies, browser session, raw headers, request/response logging or provider SDK telemetry.
- A returned `next` link is never followed. Collection truncation remains explicit; issue/flag collection coverage is not complete incident or rollout understanding.

## Sanitization and evidence

Use only the reviewed operation-specific sanitizer and existing observe pipeline. Unknown fields or malformed data fail closed. Never retain raw provider JSON, user identities, free-text titles, descriptions, stack bodies, feature targeting, payloads, prompts, session/replay IDs or credential material. Known private serializer fields are dropped wholesale; see the [error](posthog-error-sanitizer.md) and [flag](posthog-feature-flag-sanitizer.md) contracts.

The transport temporarily sees raw bytes in memory. Do not persist them, dump process memory, attach them to an issue, or log errors from the provider/SDK. Discard references after sanitization/failure; JavaScript does not promise secure memory erasure. An approved isolated runtime remains a prerequisite.

Retain only the bounded sanitized result, exact source/adapter revision, approval ID, operation, region, project binding, attempt count, start/end timestamps, byte/record counts, partiality, fixed failure category and an integrity digest of the **sanitized** artifact. Never hash or retain raw customer payloads as an audit shortcut. Default canary retention ceiling is 24 hours, with an explicit deletion owner; longer retention requires a separate approval. No durable sink is implemented or activated by this design.

## Qualification and disable procedure

Before activation, qualify the external adapter with loopback/fixture tests for wrong tenant/project/origin, expired approval, missing credential reference, redirects, malformed JSON, oversized streamed bodies, over-returned records, cancellation, timeout, 429 and credential revocation. Assert zero auth calls before denied requests and zero provider/network calls in ordinary unit tests. These adapter tests and the approval enforcement are **not yet implemented**; core tests do not replace them.

After an approved run, verify the sanitized artifact and its partiality without claiming causality or changing any flag. Stop on any unexpected field or privacy failure. Record only the fixed failure category and counts, not the rejected value.

Disable by aborting the active request, disallowing the approval ID, removing the runtime's credential reference and having the owner revoke the canary key. Verify that another request fails before credential resolution and that retained sanitized artifacts are deleted by the agreed deadline. No repository fix, PR creation, deployment or provider mutation follows automatically.

## Blocker queue

- `OWNER_AUTHORIZATION`: tenant, project, region, exact operation/window and credential-scope approval are absent. No live request is permitted.
- `CREDENTIAL_REQUIRED`: secret-store location/reference and revocation owner are absent. Never ask for a secret value in chat or GitHub.
- `DEPENDENCY`: a reviewed streaming transport and approval/retention enforcement adapter still need implementation and deterministic qualification.

These block only live-canary activation. Sanitizer quality, Observe, Suggest artifacts, Repository Audit, Graph and editor work may continue independently.
