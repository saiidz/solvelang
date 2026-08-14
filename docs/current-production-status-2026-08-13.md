# SolveLang Current Production Status — 2026-08-13

This document is the current factual status record for production-facing SolveLang account/API infrastructure. It corrects older repository text that still describes the entire API/customer-account stack as test-only.

## Product maturity

SolveLang remains an early beta / engineering prototype. The Rust language runtime, CLI, Studio, and browser preview should not be described as a finished managed workflow-execution platform.

The production customer-account foundation is further along than the overall language product.

## Verified production state

- API access: **enabled**
- customer accounts: **enabled**
- username/email + password authentication: **enabled**
- owner password-login canary: **passed**
- email sent during ordinary password login: **none**
- magic-link first-sign-in/recovery path: **available**
- optional authenticator-app TOTP implementation: **merged in code**
- authenticator-app TOTP production feature: **disabled / not rolled out yet**
- dedicated production TOTP KMS key: **not created yet**
- TOTP owner enrollment: **not performed**
- subscription billing: **disabled**
- production billing webhook path: **disabled by feature boundary**
- paid priority selection: **disabled**
- real charge authorization: **none**

## Account security implemented

The current customer-account implementation includes:

- unique immutable usernames;
- password length bounds;
- `scrypt-v1` password derivation with per-password random salt;
- generic credential failures and dummy password derivation for unknown/non-password accounts;
- source and identifier login throttles;
- opaque server-side sessions;
- HttpOnly, Secure, SameSite=None, Partitioned session cookies;
- CSRF validation on authenticated mutations;
- server-side logout/revocation;
- account `authVersion` invalidation for password/security-state changes;
- short-lived, single-use, version-bound magic links;
- API-key fingerprint storage rather than plaintext key persistence;
- API-key collision retries and plan key limits;
- usage idempotency and quota transactions;
- deployment request serialization and state-preserving production rollback.

## Authenticator implementation merged but not live

The merged TOTP implementation contains:

- RFC 6238-compatible six-digit TOTP;
- 30-second steps with a bounded clock window;
- a unique 20-byte enrollment secret;
- KMS secret protection with account-bound encryption context;
- staged first-factor authentication where an enrolled account receives no full session before MFA succeeds;
- magic-link recovery that does not bypass MFA;
- ten one-time backup codes stored only as keyed fingerprints;
- atomic backup-code consumption;
- TOTP time-step replay prevention;
- five-minute MFA challenges with bounded attempts;
- session invalidation through `authVersion` on security-state changes;
- fail-closed malformed/partial TOTP account-state handling.

The production rollout package is also merged, but the feature remains OFF until the separately controlled IAM/KMS/preflight/deployment sequence is completed.

## Deliberately disabled

The following must not be inferred as live merely because implementation code exists:

- public self-service subscription billing;
- Stripe-backed normal customer checkout;
- real charges;
- paid priority lanes exposed to customers;
- general managed hosted SolveLang workflow execution;
- Repository Audit write/remediation mode;
- Server Audit mutation/remediation mode.

## Buildout sequence

The approved engineering sequence is:

1. complete optional authenticator production rollout and owner canary;
2. add centralized account suspension/termination enforcement;
3. complete remaining account/security hardening;
4. synchronize stale product/repository documentation;
5. finish production billing preparation before any separately approved live billing activation;
6. finish queue-backed paid-priority execution before exposing priority selection;
7. build Repository Audit in read-only-first stages;
8. build Server Audit in read-only-first stages;
9. complete final production/IAM/rollback/operations hardening;
10. run final launch-readiness canaries and maintain an exact live-state record.

## Truthfulness rule

Repository documentation should distinguish four states:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically a production-enabled feature, and a production account foundation is not evidence that general managed workflow execution is live.
