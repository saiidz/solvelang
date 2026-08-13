# SolveLang Security Controls and Production Authentication Status

**Status date:** 2026-08-13  
**Repository:** `saiidz/solvelang`  
**Document branch base:** `bb79c82f59ba1f3556fee6069811dc90ccebc9e5`

> This document records security controls that are implemented and, where stated, verified in production. It is not authorization to deploy, enable billing, configure Stripe, send email, charge customers, modify production data, suspend accounts, or perform destructive actions.

## Current production authentication status

Production deployment run `31667832799` successfully deployed `main` commit:

```text
bb79c82f59ba1f3556fee6069811dc90ccebc9e5
```

Verified production feature state after that deployment:

```text
API_ACCESS_MODE=live
API_ACCESS_ENABLED=true
CUSTOMER_ACCOUNTS_ENABLED=true
SUBSCRIPTION_BILLING_ENABLED=false
```

The deployment completed successfully with:

- API access enabled;
- customer accounts enabled;
- password-auth backend code deployed;
- production customer frontend already exposing the password login UI;
- subscription billing still disabled;
- billing webhook still disabled;
- no Stripe subscription credentials injected;
- no charges performed;
- SES sender configuration verified;
- production operations baseline re-verified;
- no rollback required.

A controlled owner password-authentication canary was then completed successfully:

```text
username/email + password
  -> successful authentication
  -> production session
  -> customer dashboard
```

The password login sent no sign-in email. The owner mailbox, password, cookies, CSRF token, and all other authentication secrets are intentionally omitted from this public repository document.

---

# 1. Identity and duplicate-prevention controls

## Deterministic account identity

Customer account IDs are derived deterministically from the normalized verified email address using the customer-authentication pepper. This prevents ordinary account creation from producing multiple account IDs for the same normalized email identity.

Account creation uses a conditional DynamoDB write:

```text
attribute_not_exists(authKey)
```

If the account already exists, the service reads it strongly consistently and requires the stored email to match. A conflicting identity fails rather than silently overwriting the account.

## Unique usernames

Usernames are normalized to lowercase and constrained to:

```text
^[a-z0-9][a-z0-9._-]{2,31}$
```

Additional rules:

- 3–32 characters;
- no `@`;
- unique across accounts;
- stored as a dedicated `username#<username>` identity record;
- claimed with `attribute_not_exists(authKey)`;
- account + username claim + current-session auth-version update occur transactionally;
- a username cannot be changed through the current credential screen after it is claimed.

This means two accounts cannot successfully claim the same username through the supported flow.

## Magic-link token uniqueness

Magic links use random opaque token IDs and secrets. The token record is created only if its token key does not already exist.

## Session ID uniqueness

Server sessions use random opaque identifiers and are inserted conditionally with:

```text
attribute_not_exists(authKey)
```

A duplicate session identifier cannot overwrite an existing session record.

## API-key ID collision handling

Live/test API keys use cryptographically random key IDs and secrets. API-key insertion is conditional on the key ID not already existing.

If a generated key ID collides, the service detects the collision and retries generation up to three times. It does not overwrite the existing key.

## Duplicate API scopes removed

Requested API scopes are normalized through a set before validation, so duplicate scope strings do not create duplicate effective permissions.

## Usage-charge idempotency / no duplicate charging

Usage metering creates a deduplication record keyed by:

```text
account + billing period + idempotency key
```

The idempotency record and credit counter update occur in one DynamoDB transaction.

Behavior:

- first matching request: consumes the intended credits;
- same idempotency key + same credit amount: treated as a duplicate and does not consume twice;
- same idempotency key + different amount: rejected as `idempotency_conflict`;
- quota overflow: rejected without partially writing usage.

## Subscription-checkout duplicate protection

The subscription foundation reserves a bounded checkout request ID on the account.

Behavior:

- the same active request ID can be recognized as a duplicate/retry;
- a different concurrent active/pending subscription attempt is rejected as a conflict;
- expired reservations can be replaced;
- an existing non-replaceable subscription blocks another checkout reservation.

Production subscription billing is currently disabled, so this control is implemented but not part of an active paid production lifecycle yet.

## Subscription event ordering

Subscription account updates carry a strict event order. DynamoDB only accepts an update when it is newer than the stored order.

This prevents an older/stale subscription lifecycle event from reverting newer account state.

## Stripe-event duplicate handling

The subscription event store is designed/tested with a uniqueness condition so duplicate webhook event delivery can be handled idempotently rather than applying lifecycle changes more than once.

Production subscription billing/webhook processing remains disabled.

---

# 2. Password security

## No plaintext password storage

SolveLang does not store customer passwords in plaintext.

The current password verifier uses:

```text
scheme: scrypt-v1
N: 32768
r: 8
p: 1
derived key: 32 bytes
salt: random 16 bytes
max memory: 64 MiB
```

Each password setup/replacement receives a new random salt.

Stored account data contains the salt, verifier/hash, scheme, and password update timestamp—not the plaintext password.

## Password length boundary

Credential setup requires:

```text
12 <= password length <= 128
```

Login also rejects unusable/oversized input safely.

## Constant-time comparisons

Security-sensitive comparisons use timing-safe comparison where appropriate, including password-derived values, session fingerprints, and API-key fingerprints.

## Enumeration resistance

Unknown accounts/usernames and incorrect passwords return the same public credential error:

```text
Email/username or password is incorrect.
```

The password path also performs a dummy scrypt operation for unknown/no-password identities so a trivial timing distinction is reduced.

## Password login does not send email

Normal username/email + password login creates a session directly after successful credential verification. It does not invoke the magic-link email gateway.

This was verified by the production owner canary.

---

# 3. Login throttling and abuse resistance

## Password source throttling

Password attempts are limited by source/IP-derived throttle key:

```text
10 requests per minute window
```

## Password identifier throttling

Attempts are also limited per normalized email/username identifier:

```text
5 requests per minute window
```

This prevents simply rotating source addresses from removing all account-level throttling and prevents a single source from hammering many identifiers without a source-wide bound.

## Magic-link source throttling

Magic-link requests use the same bounded source counter model with a 10-request limit per minute window.

## Magic-link email throttle

A normalized email address has a separate one-minute request reservation. Repeated requests inside that period return the same accepted-style response without sending another email.

This reduces email spam and limits duplicate magic-link delivery.

## Infrastructure failures are not silently classified as rate limits

Conditional throttle conflicts are handled as expected limit conditions, while unrelated DynamoDB/infrastructure errors are rethrown rather than hidden.

---

# 4. Magic-link security

## Short lifetime

Magic links expire after:

```text
15 minutes
```

## Opaque random tokens

Magic links use opaque random IDs and secrets rather than account data embedded as credentials.

## Fragment-based browser delivery

The magic token is placed in the URL fragment for the customer page and then consumed by the frontend. After verification, the browser removes the fragment from the displayed history/location.

## Fingerprint-only storage

The server stores a cryptographic fingerprint of the magic-link token rather than the usable plaintext token.

## Single-use transactional consumption

Successful magic-link verification transactionally:

1. deletes the magic-link record only if the presented fingerprint matches and the link is unexpired; and
2. creates the new session only if the session ID does not already exist.

A consumed link cannot be reused through the normal path.

## Auth-version binding

Magic links are bound to the account authentication version at issuance.

If account security changes before an unused link is consumed—for example a password replacement increments the auth version—the old link becomes invalid.

---

# 5. Session security

## Opaque server-side sessions

Sessions are opaque `sess_...` bearer-style cookies backed by server-side DynamoDB records. The browser does not carry trusted account authorization state itself.

## Cookie protections

The current session cookie is configured with:

```text
HttpOnly
Secure
SameSite=None
Partitioned
Path=/
7-day maximum age
```

## Fingerprint validation

The server stores a keyed HMAC fingerprint for the opaque session token and timing-safely compares the presented token fingerprint during authentication.

## Expiry validation

Expired session records are rejected.

## Server-side logout revocation

Logout marks the server session revoked/expired and clears the browser cookie. A revoked session record is not accepted by authentication.

The original owner magic-link canary verified that refresh after logout stayed signed out.

## Authentication version (`authVersion`)

Each account has an authentication version used to invalidate old credentials/sessions safely.

A session is accepted only if:

```text
session.authVersion == account.authVersion
```

Malformed, missing-invalid, or mismatched versions fail closed.

Legacy versionless records are interpreted as version 1 for migration compatibility.

## Password changes revoke other sessions

Credential setup/password replacement:

1. reads the current account auth version;
2. increments the account version;
3. stores the new password verifier;
4. upgrades only the current session performing the security change;
5. leaves all other sessions on the old version, making them immediately invalid.

These operations are transactional, preventing a partial password/session-version update.

---

# 6. CSRF and browser ownership controls

Authenticated state-changing customer operations require the server-derived CSRF token associated with the session.

The CSRF value is derived from the opaque session token and the customer-authentication pepper.

Protected customer operations do not trust browser-supplied account ownership IDs. Account ownership is derived from the authenticated server session.

This applies to operations such as:

- credential setup/replacement;
- API-key issuance;
- API-key revocation;
- subscription-management actions when enabled;
- logout.

---

# 7. API-key security

## Live/test environment separation

API keys encode their intended mode:

```text
sl_test_...
sl_live_...
```

The authorizer rejects a key whose mode does not match the active environment.

## Random secrets

Keys contain:

- a random 12-byte identifier;
- a random 32-byte secret.

## Fingerprint-only persistent secret verification

The full API-key secret is not stored as the credential verifier. The store keeps a keyed HMAC fingerprint plus safe display metadata such as prefix/last four.

## One-time plaintext return

The full API key is returned at issuance so the customer can copy it. Account/dashboard views expose only safe metadata and not the full stored credential.

## Constant-time fingerprint verification

Presented API-key fingerprints are compared timing-safely.

## Account ownership checks

API-key revocation requires that the key belong to the authenticated account. A key belonging to another account is treated as not found through that customer path.

## Revoked-key rejection

Revoked keys fail authorization and cannot be touched as active credentials.

## Atomic plan key limits

API-key creation transactionally increments the account active-key counter and inserts the new unique key. The transaction only succeeds if the plan's active-key limit has not been reached.

Revocation transactionally marks the key revoked and decrements the account active-key counter.

This avoids counter/key drift from partial writes during normal operation.

## Subscription access required

API-key issuance and authorization require an eligible subscription state. An unsubscribed/inactive account cannot obtain active paid API access simply by reaching the customer UI.

Production subscription billing remains disabled, and the current owner account has no subscription/API keys as expected.

---

# 8. Credit/quota security

Monthly usage increments are atomic and bounded by the plan limit.

A transaction cannot partially write an idempotency record while failing the quota update, or vice versa.

The service fails closed when:

- the monthly credit limit would be exceeded;
- an idempotency key is reused with a different charge;
- account/subscription access is not eligible;
- the charge input is invalid.

Paid priority remains disabled until its separate queue-backed production rollout is intentionally validated and enabled.

---

# 9. Billing interlocks currently active

Production currently requires:

```text
SUBSCRIPTION_BILLING_ENABLED=false
```

Current production deployment verified:

- billing disabled;
- subscription webhook disabled;
- no Stripe subscription secret injected;
- no Stripe subscription webhook secret injected;
- no charge performed.

The customer UI may show plan choices, but the backend production billing interlock remains authoritative.

Billing must remain a separately approved rollout.

---

# 10. Secret separation

Production authentication/deployment validation requires independent secrets for distinct trust boundaries, including:

- `CUSTOMER_AUTH_PEPPER`;
- `API_KEY_PEPPER`;
- `API_ACCESS_ADMIN_SECRET`.

The production validation rejects unsafe reuse between these secret roles.

Secrets are not intended for `NEXT_PUBLIC_*` values or public logs/documentation.

---

# 11. Production deployment safety controls

## Manual protected deployment

Production deployment is manually dispatched and protected by the `api-access-production` GitHub Environment approval boundary.

## Main-only source boundary

Production deployment requires the intended `main` source path rather than an arbitrary feature branch.

## Attempt-aware deployment queue

Production deployment ordering treats each GitHub Actions workflow attempt as a distinct queue request using run ID **and** run attempt metadata.

Ordering uses actual attempt start metadata with deterministic tie-breaking.

This prevents an older run ID that is rerun later from incorrectly jumping ahead of a newer production deployment that started first.

Missing, malformed, or ambiguous ordering metadata fails closed.

## Separate test deployment

Test deployment remains isolated from the production deployment queue/boundary.

## Pre-deploy state capture

The production deployment captures the exact starting values of production API-access/customer-account flags.

## State-preserving rollback

If post-deploy verification fails, rollback restores the captured starting feature state rather than blindly forcing an already-live production service to disabled.

Subscription billing remains forced disabled through this password-auth/customer-account phase.

## Post-deploy verification

Production deployment verifies the resulting health state and billing-disabled boundary before declaring success.

## Production operations baseline

The deployment re-applies/re-verifies the operations baseline after deployment. Existing production operations documentation covers controls such as retention/protection/alarm routing.

---

# 12. Production authentication evidence completed

## Magic-link canary

Previously verified:

- exactly one requested owner sign-in email;
- successful single-use link verification;
- successful dashboard session;
- no subscription/charge;
- successful logout;
- session stayed invalid after logout.

## Password-auth canary

Now verified in production:

- password sign-in UI is live;
- password-auth backend is deployed;
- existing verified account reports password sign-in enabled;
- username or email + password authenticates successfully;
- dashboard loads after password login;
- normal password login sends no email;
- account remains unsubscribed with zero API keys during the canary;
- billing remains disabled.

This proves the intended normal path:

```text
username/email + password
  -> throttled credential verification
  -> auth-version-bound server session
  -> CSRF-protected customer dashboard
```

---

# 13. Security controls planned but NOT active yet

The following must not be described as live security controls until implemented, reviewed, merged, deployed, and canary-tested.

## Optional authenticator-app 2FA (TOTP)

Planned next security enhancement:

- optional per account;
- compatible with standard authenticator apps;
- setup requires authenticated session + CSRF;
- QR/manual TOTP enrollment;
- enrollment is not enabled until one valid TOTP code proves possession;
- password login for 2FA-enabled accounts must stop at a limited pre-auth challenge rather than issuing a full session;
- successful TOTP challenge then creates the full session;
- rate-limit TOTP attempts;
- encrypted TOTP seed at rest using a dedicated encryption/KMS boundary;
- one-time hashed backup recovery codes;
- 2FA enable/disable/reset increments `authVersion` and revokes other sessions;
- recovery must not silently remove 2FA;
- no routine email is required for password + authenticator login.

## Account suspension/termination

Still required before broad customer adoption:

```text
active
suspended
terminated
```

The future enforcement must block, as appropriate:

- password login;
- magic-link authentication;
- existing sessions;
- API-key authorization;
- new key issuance;
- billing/customer actions;
- queued/hosted execution.

It must also preserve an auditable administrative reason/action record.

---

# 14. Security truthfulness rule

When describing SolveLang externally, distinguish clearly between:

**Implemented/live:**

- verified customer accounts;
- magic-link authentication;
- username/email + password authentication;
- scrypt password storage;
- login throttling;
- single-use/version-bound magic links;
- auth-version session revocation;
- server-side logout;
- CSRF protection;
- unique usernames/account identity controls;
- duplicate/idempotency protections for supported storage/payment-foundation operations;
- API-key fingerprinting/collision handling/plan limits;
- protected attempt-aware production deployments;
- production billing interlock.

**Planned/not live yet:**

- authenticator-app 2FA;
- backup codes;
- account suspension/termination;
- production subscription billing;
- paid priority processing;
- broad managed hosted execution.

Do not present a planned control as an active production guarantee.

---

# 15. Recommended next security sequence

1. Preserve this successful password-auth canary as production evidence.
2. Implement optional authenticator-app 2FA + backup codes in an isolated reviewed PR.
3. Test 2FA setup, challenge, backup-code recovery, reset, session invalidation, throttling, and encryption boundaries.
4. Deploy 2FA only after a separate production preflight/deployment approval.
5. Run one controlled owner TOTP canary.
6. Implement durable account suspension/termination enforcement.
7. Reconcile public README/roadmap/security documentation with the verified production state.
8. Only after the account-security foundation is complete, proceed to separately reviewed subscription-billing readiness.

