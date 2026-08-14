# SolveLang Active Buildout Handoff

**Purpose:** durable cross-chat execution state for the approved full SolveLang buildout.  
**Owner master authorization:** `APPROVE FULL SOLVELANG BUILDOUT PLAN`  
**Major gates remain separate:** merge, live AWS/IAM/KMS mutation, production preflight dispatch, production deployment, email canary, Stripe/billing enablement, and any real charge.

## Repository and production truth

- Repository: `saiidz/solvelang`
- Current verified `main` before this draft PR: `07da1d5e4d01283549ff5df7cabd992731327cc9`
- That commit merged PR #146 (`feat(audit): add redaction and report-integrity primitives`).
- PR #145 priority lease-owner isolation and PR #146 Repository Audit hardening are merged.
- Production region: `us-east-2`
- Production API access: enabled
- Production customer accounts/password auth: enabled
- Production authenticator TOTP: **disabled**
- Production TOTP KMS key: **not created**
- Production subscription billing / Stripe: **disabled**
- Customer paid priority selection: **disabled**
- No production AWS/IAM/KMS, deployment, email, billing, Stripe, or charge is authorized by the coding work recorded here.

Always re-read current GitHub `main`, PR heads, CI, and review threads before relying on the SHAs in this file.

## Completed buildout stages

### Password/customer-account production foundation

Live password authentication supports email or immutable username plus password, magic-link recovery, version-bound sessions, rate limiting, and fail-closed authentication-state handling. The owner password canary passed previously with subscription billing still disabled.

### Optional authenticator 2FA implementation

PR #141 merged the optional RFC 6238 TOTP implementation, including KMS-encrypted secrets, MFA challenges, one-time backup codes, TOTP replay prevention, `authVersion` invalidation, and fail-closed partial-state handling.

PR #142 merged production rollout/preflight/KMS-stack preparation. Production TOTP is still disabled and the dedicated production key has not been created.

PR #143 (`security(prod): add guarded TOTP IAM operator path`) remains **Draft/quarantined** and must not be merged in its current state. No live IAM mutation has been performed from it.

### Priority hardening

PR #145 merged invocation-unique worker lease ownership using Lambda request identity. Priority remains test-only/customer-disabled.

### Repository Audit

PR #146 merged read-only/analyze-only primitives including HMAC-redacted secret warnings, encrypted private-key detection, canonical report integrity, deterministic report IDs, reference/import analysis, dependency candidates, and lockfile-conflict detection. This does not authorize repository remediation or hosted execution.

## Current stage: PR #147 account suspension / termination enforcement

Active PR: `#147 — feat(auth): add account suspension and termination foundation`  
Branch: `agent/account-access-enforcement`  
PR remains **Draft / DO NOT MERGE** until final hosted CI and review are clean.

Implemented on this branch:

- authoritative states: `active`, `suspended`, `terminated`;
- legacy versionless accounts remain active; missing or malformed account state fails closed;
- termination is irreversible;
- every real transition increments `authVersion`;
- Dynamo transition atomically writes request-idempotency state, account state/version, and immutable audit metadata;
- exact request replay is idempotent; request-ID reuse with different input conflicts;
- existing sessions, password session creation, MFA challenge creation/consumption, and existing-account magic-link consumption are blocked for restricted accounts;
- first-ever magic-link signup still works when no account row exists;
- suspended magic-link requests keep the enumeration-safe generic response and send no email;
- customer API-key authorization checks authoritative account state before quota metering;
- customer/internal key issuance, checkout reservation, direct subscription provisioning, and manual usage consumption use a centralized active-account guard;
- security cleanup/key revocation and signed Stripe lifecycle reconciliation remain available so restriction cannot prevent cancellation/reconciliation;
- admin GET/POST `/internal/accounts/access` is protected by the existing constant-time admin secret and uses a server-owned audit actor;
- API-key authorizer CustomerAuth permission is conditional and `dynamodb:GetItem`-only;
- priority workers preserve server-owned canaries and fail closed for customer-owned jobs unless an active-account verifier is configured;
- optional priority CustomerAuth verification uses `GetItem`-only access and defaults unconfigured so the current test-only canary stack behavior remains unchanged;
- focused tests cover transitions, auth-store behavior, no-email magic-link suppression, API-key no-metering denial, mutation gates, admin endpoints, SAM/IAM contracts, and customer-owned priority jobs.

Before #147 can become merge-ready:

1. exact current-head API Access CI must pass, including both SAM validate/build paths;
2. general CI/static build and Rust runtime must pass;
3. separate Rust/RustSec workflow must pass;
4. automated review must be checked and every valid finding fixed/resolved;
5. PR body/status must be updated from Draft to the exact completed scope;
6. merge requires separate explicit approval: `APPROVE MERGE PR #147`.

Merging #147 still does **not** authorize a production deployment or production account-state mutation.

## Other active work after #147

### PR #144 billing webhook serialization

Branch: `agent/billing-webhook-idempotency`; remains Draft. It contains claim/lease/complete/retryable webhook processing and legacy-event compatibility. A remaining review item requires payment-method normalization idempotency to include or persist the selected payment-method target. Production billing remains OFF.

### TOTP production IAM / rollout

After account hardening, return to the quarantined TOTP IAM path using a corrected least-privilege implementation. Live IAM/KMS changes, TOTP preflight, TOTP deployment, and owner enrollment each remain separately gated.

### Later stages

- finish billing/webhook hardening, then separately gate Stripe production activation;
- finish queue-backed paid-priority customer execution before exposing paid tiers;
- expand Repository Audit toward the complete product and later approval-based remediation;
- build Server Audit read-only foundations and later approval-based remediation;
- fix SolveLang imported-file source provenance diagnostics;
- final production/IAM/rollback/monitoring hardening and launch-readiness canaries.

## Cross-chat continuation

When a conversation reaches its practical limit, start a new chat inside the SolveLang project and say:

`continue SolveLang full buildout from docs/active-buildout-handoff.md`

The new chat must verify GitHub state rather than trusting this file blindly. Do not collapse merge, AWS/IAM/KMS mutation, production preflight, deployment, email, Stripe/billing, or charge gates.
