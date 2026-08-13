# SolveLang Security Controls and Production Authentication Status

**Status date:** 2026-08-13  
**Repository:** `saiidz/solvelang`

> This document records implemented security controls and verified production state. It is not authorization to deploy, change AWS/IAM/KMS, send email, enable billing, use Stripe, charge customers, mutate production data, or suspend/terminate accounts.

## Current production boundary

Verified production state:

```text
API_ACCESS_MODE=live
API_ACCESS_ENABLED=true
CUSTOMER_ACCOUNTS_ENABLED=true
SUBSCRIPTION_BILLING_ENABLED=false
```

Verified customer-authentication state:

- customer-account frontend is live;
- username/email + password authentication is live;
- owner password-login canary passed;
- normal password login sends no email;
- magic-link first-sign-in/recovery remains available;
- optional authenticator-app TOTP is implemented in the repository but is **not enabled in production yet**;
- no production TOTP KMS key has been created yet;
- no production account has been enrolled in TOTP through this rollout;
- subscription billing is disabled;
- paid-priority customer selection is disabled;
- no charge was performed by the authentication rollout.

The owner mailbox, password, session cookie, CSRF token, TOTP material, backup codes, and all other authentication secrets are intentionally omitted.

---

# 1. Identity and duplicate-prevention controls

## Deterministic account identity

Customer account IDs are derived deterministically from the normalized verified email identity using the customer-authentication pepper.

Account creation uses a conditional DynamoDB write so an existing identity record is not overwritten. If the account already exists, the service reads the existing record and requires the stored identity to be consistent.

This prevents the supported account-creation flow from silently creating multiple account identities for the same normalized verified email.

## Unique usernames

Usernames are normalized to lowercase and constrained to:

```text
^[a-z0-9][a-z0-9._-]{2,31}$
```

Controls include:

- 3–32 characters;
- no `@`;
- unique dedicated `username#<username>` identity record;
- conditional claim with `attribute_not_exists(authKey)`;
- transactional account + username + current-session auth-version update;
- username immutability through the current customer credential flow.

Two accounts cannot successfully claim the same username through the supported transaction.

## Magic-link token uniqueness

Magic links use random opaque token IDs/secrets. Token records are inserted conditionally rather than overwriting an existing token key.

## Session ID uniqueness

Server sessions use random opaque IDs and conditional creation. A generated session ID cannot overwrite an existing session record.

## API-key collision handling

API keys contain random identifiers and secrets. Key insertion is conditional on the key ID not already existing. A generated key-ID collision is detected and key generation is retried rather than overwriting the existing record.

## Duplicate API scopes removed

Requested scopes are normalized through a set before validation, so repeated scope strings do not create duplicate effective permissions.

## Usage idempotency

Usage metering uses a deduplication record keyed by account, billing period, and idempotency key. The idempotency record and usage counter update occur in a DynamoDB transaction.

Behavior:

- first request consumes the intended credit amount;
- same idempotency key + same amount is treated as a duplicate and does not consume twice;
- same idempotency key + different amount is rejected as an idempotency conflict;
- quota overflow is rejected without partially committing usage.

## Checkout reservation duplicate protection

The subscription foundation reserves a bounded checkout request ID on the account.

Implemented behavior includes:

- same active request ID can be recognized as the same request/retry;
- another concurrent active/pending subscription attempt is rejected;
- expired reservations may be replaced;
- an existing non-replaceable subscription blocks another reservation.

Production subscription billing is currently disabled, so this foundation is not an active paid production lifecycle.

## Subscription lifecycle ordering

Subscription account updates carry a strict event order. DynamoDB accepts an account lifecycle update only when it is newer than the stored order.

This prevents older/stale subscription lifecycle state from reverting a newer stored account state.

## Stripe webhook duplicate limitation — important

The subscription event store has a conditional uniqueness record for Stripe event IDs, **but the current implementation must not be described as exactly-once webhook processing**.

At present, some external subscription/payment-method normalization can occur before `putEventIfAbsent` records the Stripe event as already processed. A duplicate webhook delivery can therefore repeat those external normalization calls before the duplicate event is recognized.

Because production subscription billing is disabled, this is not currently an active paid-production path. Before billing is enabled, the billing rollout must do one of the following and prove it with tests:

- move duplicate-event reservation/detection ahead of external lifecycle side effects; or
- prove every external operation that can occur before deduplication is independently idempotent and safe under replay.

Until that is completed, the correct claim is **ordered account-state protection plus an event uniqueness record**, not globally exactly-once webhook side effects.

---

# 2. Password security

## No plaintext password storage

Customer passwords are not persisted in plaintext.

Current password derivation:

```text
scheme: scrypt-v1
N: 32768
r: 8
p: 1
derived key: 32 bytes
salt: random 16 bytes
max memory: 64 MiB
```

A password setup or replacement receives a new random salt. Stored account data contains the salt, password verifier/hash, scheme, and update metadata—not the plaintext password.

## Password length boundary

Credential setup requires:

```text
12 <= password length <= 128
```

Oversized/unusable login input is rejected safely.

## Constant-time comparison

Timing-safe comparison is used for security-sensitive derived/fingerprint values where appropriate, including password verification, session fingerprints, and API-key fingerprints.

## Enumeration resistance

Unknown identities and incorrect passwords return the same public error:

```text
Email/username or password is incorrect.
```

Unknown/no-password identities also execute a dummy scrypt operation so a trivial timing distinction is reduced.

## Password login sends no email

Normal username/email + password authentication does not invoke the magic-link email gateway. This was verified by the production owner canary.

---

# 3. Login throttling and abuse resistance

## Password source throttling

Password attempts have a bounded source/IP-derived throttle:

```text
10 requests per minute window
```

## Password identifier throttling

Attempts also have a normalized email/username throttle:

```text
5 requests per minute window
```

## Magic-link source throttling

Magic-link requests use a bounded source counter model.

## Magic-link email throttle

A normalized email identity has a separate short request reservation. Repeated requests within the reservation period receive the accepted-style public response without repeatedly sending email.

## Infrastructure failures remain visible internally

Expected conditional throttle conflicts are classified as rate-limit conditions. Unrelated DynamoDB/infrastructure failures are not silently converted into a rate-limit response internally.

---

# 4. Magic-link security

Controls include:

- 15-minute lifetime;
- opaque random token ID and secret;
- fragment-based browser delivery;
- fingerprint-only server persistence;
- transactional single-use consumption;
- session creation conditioned on a unique session ID;
- account `authVersion` binding at issuance.

If account security changes before an unused link is consumed, the old link becomes invalid because its authentication version is stale.

---

# 5. Session security

## Opaque server-side sessions

Sessions are opaque `sess_...` credentials backed by server-side DynamoDB records. Browser state is not trusted as the source of account authorization.

## Cookie protections

The current customer session cookie uses:

```text
HttpOnly
Secure
SameSite=None
Partitioned
Path=/
7-day maximum age
```

## Fingerprint validation

The server stores a keyed fingerprint for the opaque session token and timing-safely verifies the presented token.

## Expiry and revocation

Expired or revoked sessions are rejected. Logout revokes the server session and clears the browser cookie.

## Authentication version

A session is accepted only when its authentication version matches the current account authentication version.

Legacy versionless records are treated as version 1 for migration compatibility; malformed versions fail closed.

## Password changes invalidate other sessions

Password setup/replacement increments the account auth version and upgrades only the current session performing the security change. Other sessions remain on the previous version and become unusable.

The account/password/current-session update is transactional.

---

# 6. CSRF and ownership controls

Authenticated customer mutations require the session-derived CSRF token.

Protected customer operations derive account ownership from the authenticated server session rather than trusting a browser-supplied account ID.

This model applies to supported customer mutations including credentials, API keys, subscription-management actions when enabled, authenticator security changes, and logout.

---

# 7. API-key security

## Environment separation

Keys identify their intended environment:

```text
sl_test_...
sl_live_...
```

The authorizer rejects a key whose mode does not match the active environment.

## Random credentials and fingerprint storage

API keys contain random IDs/secrets. Persistent verification uses a keyed fingerprint rather than storing the usable full credential as the verifier.

The full key is returned only when issued; later account views expose safe metadata rather than the secret.

## Ownership and revocation

Customer key revocation requires the key to belong to the authenticated account. Revoked keys fail authorization.

## Atomic plan limits

Key issuance transactionally inserts the unique key and increments the active-key counter only when the plan limit allows it. Revocation transactionally marks the key revoked and decrements the counter.

## Subscription eligibility

Key issuance/authorization requires the appropriate account/subscription eligibility. The production owner account remains unsubscribed with zero API keys as expected.

---

# 8. Credit and quota security

Monthly usage updates are atomic and bounded by plan limits.

The service fails closed when:

- quota would be exceeded;
- an idempotency key is reused with a conflicting amount;
- account/subscription eligibility is insufficient;
- usage input is invalid.

Paid priority remains disabled for normal customers until its separate queue-backed rollout is validated and intentionally enabled.

---

# 9. Billing interlocks

Production currently requires subscription billing disabled.

Verified boundary:

- billing feature false;
- production subscription webhook returns the billing-disabled boundary;
- production customer-account/auth deployments do not inject subscription Stripe secrets;
- no charge is performed by those workflows.

The customer UI may display plan information, but the backend production feature gate is authoritative.

Billing requires a separately reviewed/preflighted/deployed rollout and any real-charge canary requires its own explicit approval.

---

# 10. Secret separation

Distinct production trust boundaries use distinct secrets, including:

- `CUSTOMER_AUTH_PEPPER`;
- `API_KEY_PEPPER`;
- `API_ACCESS_ADMIN_SECRET`.

Production validation checks required length and rejects unsafe equality/reuse between these secret roles.

Secrets must not be exposed through public frontend variables, logs, documentation, or report artifacts.

---

# 11. Authenticator-app TOTP controls implemented in code

Authenticator-app 2FA was merged in PR #141, but remains production-disabled until the separate rollout gates complete.

Implemented controls include:

- RFC 6238-compatible TOTP;
- six-digit codes;
- 30-second timestep;
- bounded ±1-step clock window;
- unique random 20-byte enrollment secret;
- KMS encryption of TOTP seed material;
- account-bound KMS encryption context;
- no external QR service receiving the secret;
- manual Base32/`otpauth://` enrollment support;
- first-factor password or magic-link proof creates only a short-lived MFA challenge for enrolled accounts;
- no full authenticated session before the second factor succeeds;
- magic-link recovery does not bypass TOTP;
- ten one-time backup codes;
- keyed backup-code fingerprints only at rest;
- atomic backup-code consumption/removal;
- accepted TOTP timestep persistence to block code replay;
- five-minute MFA challenge lifetime;
- bounded challenge attempts plus source throttling;
- password proof + second factor for sensitive authenticator changes;
- `authVersion` invalidation when authenticator security state changes;
- password changes preserve enabled TOTP rather than silently removing it;
- fail-closed behavior when required TOTP/KMS support is unavailable;
- fail-closed handling of partial/malformed TOTP account state.

## Runtime KMS least privilege

When TOTP is enabled, runtime KMS use is limited to the configured full key ARN and required cryptographic operations. The merged SAM policy also constrains the expected encryption context to the SolveLang customer-TOTP purpose and account context.

## Production rollout remains incomplete

PR #142 merged the guarded rollout package, including:

- dedicated retained/rotating KMS stack IaC;
- protected/manual KMS bootstrap workflow;
- validation-only TOTP production preflight;
- protected/manual TOTP API deployment workflow;
- ordinary customer redeploy preservation of exact TOTP flag and KMS ARN;
- state-preserving rollback of exact TOTP flag and KMS ARN;
- attempt-aware serialization with other production mutation workflows;
- billing forced disabled through the TOTP rollout;
- no production Stripe secret injection by the TOTP deployment workflow;
- no customer enrollment/email as part of deployment itself.

As of this status record:

- production TOTP feature is OFF;
- dedicated production TOTP KMS key has not been created;
- owner TOTP canary has not been run.

---

# 12. Production deployment safety

## Protected/manual production mutation

Production mutation workflows are manually dispatched and use the protected `api-access-production` GitHub Environment boundary.

## Main/exact-SHA checks

Production workflows require the intended `main` source and verify the checked-out commit matches the workflow SHA.

## Attempt-aware deployment ordering

Each workflow attempt is treated as a distinct production queue request using run ID and `GITHUB_RUN_ATTEMPT` plus actual attempt-start metadata.

Ordering has deterministic tie-breaking and fails closed on missing/malformed/ambiguous metadata. This prevents an old run-ID rerun from incorrectly jumping ahead of a newer production deployment that actually started first.

## Test deployment separation

Test deployment remains outside the production deployment queue/boundary.

## Exact pre-deploy state capture and rollback

Production deployment captures the relevant starting feature state and post-deploy rollback restores that captured state rather than blindly forcing features off.

After the TOTP rollout package, ordinary customer-account redeploy and rollback also preserve the exact current TOTP flag and configured KMS ARN.

## Post-deploy verification

Production workflows verify health and the billing-disabled boundary before declaring success, and re-apply/re-verify the operations baseline where required.

---

# 13. Production evidence completed

## Magic-link owner canary

Previously verified:

- exactly one requested sign-in email;
- successful single-use link verification;
- production dashboard session;
- no subscription/charge;
- successful logout and server-side invalidation.

## Password owner canary

Verified:

- password sign-in UI live;
- password backend deployed;
- existing verified account reports password sign-in enabled;
- username or email + password authenticates successfully;
- production dashboard loads;
- normal password login sends no email;
- owner remains unsubscribed with zero API keys during the canary;
- billing remains disabled.

---

# 14. Security controls still not active

## Centralized account suspension/termination

This is **not merged or live yet**.

The intended states are:

```text
active
suspended
terminated
```

Future centralized enforcement must cover, as appropriate:

- password authentication;
- magic-link issuance/consumption;
- existing sessions;
- TOTP/MFA challenges;
- API-key authorization;
- new API-key issuance;
- checkout/subscription actions;
- future customer-owned queued work.

Security-state transitions should invalidate older authentication artifacts through `authVersion` and produce durable administrative audit evidence.

## Broad production TOTP

Although implementation and rollout code are merged, production TOTP remains disabled until the remaining IAM/KMS/preflight/deployment gates are safely completed and an owner canary succeeds.

## Public paid billing

Production subscription billing, self-service checkout activation, and any real charge remain separately gated.

---

# 15. Security follow-ups before broad paid launch

Priority security work before broad customer adoption includes:

1. finish the safe production TOTP IAM/KMS/preflight/deployment sequence and owner canary;
2. implement centralized suspension/termination enforcement;
3. fix/prove Stripe webhook replay behavior before live billing—do not claim globally exactly-once external side effects under the current event-ordering sequence;
4. run dedicated production billing preflight before enabling Stripe-backed customer billing;
5. keep paid priority disabled until real customer-owned queue execution and entitlement/account checks are validated;
6. keep security/status documentation synchronized with actual production state.

---

# Summary

Current SolveLang production authentication uses layered controls across identity uniqueness, password derivation, throttling, opaque sessions, CSRF, auth-version revocation, magic-link recovery, API-key fingerprinting, quota/idempotency transactions, protected deployments, attempt-aware production ordering, and exact-state rollback.

Optional authenticator-app TOTP is implemented and guarded by a reviewed rollout package but is **not production-enabled yet**. Centralized suspension/termination and live subscription billing remain incomplete.

The Stripe subscription foundation has strong lifecycle ordering and an event uniqueness record, but webhook external side effects must **not** be described as globally exactly-once until duplicate detection is moved before replayable side effects or those effects are independently proven idempotent.
