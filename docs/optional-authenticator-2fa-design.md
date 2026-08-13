# Optional Authenticator-App Two-Factor Authentication

**Status:** implementation PR design and rollout contract  
**Feature:** optional customer TOTP two-factor authentication  
**Production state while this PR is under review:** OFF  

> This document is an implementation and rollout contract. It does not authorize merge, KMS creation, production configuration, deployment, email sending, billing, Stripe changes, or customer account mutation.

## Goal

Allow a SolveLang customer to opt into authenticator-app two-factor authentication after password sign-in is configured. Once a customer enables 2FA, both ordinary password login and magic-link recovery require a second factor before a normal authenticated session is created.

Compatible apps include standards-compatible TOTP authenticators such as Google Authenticator, Microsoft Authenticator, 1Password, Authy, and similar clients.

## Non-goals

This PR does not:

- force 2FA on customers who have not opted in;
- enable 2FA in production;
- create or configure a production KMS key;
- enable subscription billing;
- alter Stripe configuration;
- send an enrollment email;
- add SMS OTP;
- add WebAuthn/passkeys;
- implement administrator-driven account suspension/termination;
- provide a support-agent bypass around a customer's second factor.

## Protocol

The implementation uses RFC 6238-style TOTP with:

- unique random secret per enrollment;
- 20 random secret bytes encoded as Base32;
- HMAC-SHA1 for broad authenticator compatibility;
- 6 decimal digits;
- 30-second time step;
- verification window of current step plus one adjacent step in either direction;
- accepted time-step replay prevention.

The TOTP secret is not a password verifier and cannot be stored only as a hash because the server must compute future TOTP values. SolveLang therefore encrypts it with AWS KMS.

## KMS protection

The runtime expects an existing dedicated symmetric KMS key ARN when the feature is enabled.

The application is granted only:

- `kms:Encrypt`
- `kms:Decrypt`

against that key ARN.

The encryption context is non-secret metadata:

```text
purpose=solvelang-customer-totp
accountId=<SolveLang account ID>
```

The same context is required at decryption time, cryptographically binding encrypted TOTP material to the account for which it was created.

The KMS key is deliberately not created by this PR. Production key creation, key policy review, configuration, and feature enablement require a later separately approved rollout.

## Feature flag and safe merge behavior

The SAM parameter is:

```text
CustomerTotpEnabled=false
```

by default.

The runtime environment receives:

```text
API_CUSTOMER_TOTP_ENABLED=false
```

unless a future deployment explicitly enables the feature and supplies a full KMS key ARN in:

```text
API_CUSTOMER_TOTP_KMS_KEY_ARN
```

The CloudFormation parameter is likewise named `CustomerTotpKmsKeyArn` and is constrained to an ARN-shaped value. While the feature is disabled it uses an inert syntactically valid placeholder ARN solely so CloudFormation/IAM linting can prove the `Resource` shape. The `CustomerTotpRequirements` rule rejects that placeholder whenever `CustomerTotpEnabled=true`, so real enablement requires an explicit dedicated KMS key ARN.

Therefore merging this PR cannot by itself activate authenticator 2FA.

## Enrollment flow

Prerequisites:

1. customer has a valid authenticated session;
2. password sign-in is already configured;
3. authenticator feature is enabled for the environment;
4. customer does not already have TOTP enabled.

Flow:

1. Customer chooses **Set up authenticator app**.
2. Server generates a unique random TOTP secret.
3. Server encrypts the secret through the configured KMS key using account-bound encryption context.
4. A pending setup record is stored with a 10-minute TTL.
5. Browser receives the Base32 setup key and an `otpauth://` URI.
6. No external QR-code service receives the secret.
7. Customer adds the key to their authenticator app.
8. Customer submits their current password plus a fresh 6-digit TOTP.
9. Server re-verifies the password and validates the TOTP.
10. A transaction consumes the pending setup, enables TOTP, stores the encrypted secret, stores one-time backup-code fingerprints, records the accepted TOTP time-step, increments `authVersion`, and upgrades only the current session.
11. Every other session immediately becomes stale.
12. Ten plaintext backup codes are returned once to the browser.

If any transactional condition fails, enrollment fails closed.

## Backup codes

Enrollment creates ten unique backup codes.

Each code:

- contains 80 bits of random material before Base32 presentation;
- is normalized before verification;
- is returned in plaintext only at enrollment or explicit regeneration;
- is persisted only as an HMAC-SHA256 fingerprint bound to the account;
- can be used only once.

A successful backup-code login transaction removes exactly the matched fingerprint and decrements the remaining count.

Regenerating backup codes replaces the entire previous set, immediately invalidating all old unused backup codes.

## Password login with 2FA

For an account without 2FA:

```text
password -> full session
```

For an account with 2FA:

```text
password
  -> short-lived MFA challenge only
  -> authenticator or backup proof
  -> full session
```

A correct password never creates the full session before the second factor succeeds.

The MFA challenge:

- is opaque;
- has independent random ID and secret material;
- is stored server-side only by fingerprint;
- expires after five minutes;
- is bound to account and `authVersion`;
- permits at most five verification attempts;
- is also subject to source throttling;
- is deleted atomically when the full session is created.

## Magic-link recovery with 2FA

A magic link is not a 2FA bypass.

For an account with TOTP enabled:

```text
valid single-use email link
  -> short-lived MFA challenge only
  -> authenticator or backup proof
  -> full session
```

This keeps email recovery useful for password recovery while preserving the customer's chosen second factor.

If a customer loses both the authenticator and every backup code, there is intentionally no automatic weak bypass in this PR. A future identity-recovery/support process must be separately designed and security-reviewed.

## TOTP replay prevention

SolveLang records the most recent successfully used TOTP time-step on the account.

A login/security transaction using TOTP requires:

```text
newStep > totpLastStep
```

The check and update happen in the same DynamoDB transaction that creates the session or changes security state.

This prevents the same rotating code/time-step from being replayed for a second authenticated session or security operation.

Because of this strict replay rule, a customer who has just used a TOTP code to sign in may need to use the next 30-second code before performing another sensitive operation such as disabling 2FA or regenerating backup codes.

## Sensitive security changes

The following operations require both:

1. current password; and
2. fresh TOTP or one unused backup code.

Operations:

- regenerate backup codes;
- disable authenticator 2FA.

Successful changes increment `authVersion` and upgrade only the current session. Other sessions become invalid immediately.

## Password changes while 2FA is enabled

The existing password-change flow remains protected by authenticated session + CSRF and still increments `authVersion`.

Changing the password does not silently disable TOTP.

After password replacement:

- TOTP remains enabled;
- old sessions become stale;
- older version-bound magic links become invalid;
- the current password-changing session is upgraded atomically.

## Fail-closed behavior

If an account has TOTP enabled but the runtime cannot perform authenticator verification—for example KMS/TOTP support is unavailable—the system must not downgrade to password-only login.

The login/recovery attempt fails with service-unavailable behavior until the second-factor service is healthy again.

Likewise, malformed account MFA state, expired challenges, exceeded challenge attempts, account-version changes, replayed TOTP steps, or already-used backup codes fail closed.

## Enumeration and brute-force protection

Existing password protections remain:

- generic invalid-credential responses;
- dummy scrypt work for unknown/non-password identities;
- source throttling;
- identifier throttling.

MFA adds:

- five-attempt hard cap per challenge;
- source throttling for challenge verification;
- challenge expiration after five minutes;
- generic invalid authenticator/backup-code response.

## Session and CSRF boundaries

The existing session model remains:

- opaque random session token;
- only server-side fingerprint persists;
- HttpOnly;
- Secure;
- SameSite=None;
- Partitioned;
- server-side revocation;
- seven-day maximum session TTL;
- CSRF required for customer mutations;
- account ownership derived from authenticated server session, not browser-supplied IDs.

MFA does not weaken any of those boundaries.

## Duplicate/idempotency protections added or preserved

Authenticator implementation preserves the project's duplicate-prevention model:

- pending TOTP setup is account-keyed;
- MFA challenge IDs are conditionally unique;
- session IDs are conditionally unique;
- backup codes within a generated set are unique;
- a backup-code fingerprint is removed after first use;
- TOTP replay is rejected using monotonic accepted time-step state;
- enrollment is conditional on TOTP not already being enabled;
- security updates are conditional on the exact current `authVersion`;
- current-session version updates are transactional with security changes;
- existing username uniqueness, API-key collision retries, usage idempotency, checkout idempotency, event ordering, and deployment serialization remain unchanged.

## Frontend behavior

The production account surface gains an **Authenticator app** section only when the backend reports the feature available.

State exposed to the browser is limited to:

```json
{
  "totpAvailable": true,
  "totpEnabled": true,
  "backupCodesRemaining": 8
}
```

The encrypted TOTP secret is never returned after setup.

The plaintext setup secret is shown only while enrollment is pending. Plaintext backup codes are shown only when they are generated.

For mixed/rolling frontend-backend deployments, missing TOTP fields are treated as unavailable/off; existing password behavior remains usable until the backend feature is deliberately enabled.

## Production rollout required later

After this implementation PR is reviewed and merged, production enablement must still be a separate process:

1. verify post-merge CI;
2. create/review a dedicated symmetric KMS key and key policy;
3. verify production deploy role can pass the KMS ARN without gaining unrelated KMS rights;
4. extend a production TOTP preflight to validate KMS access and current account/billing state without enabling TOTP;
5. separately approve production TOTP deployment;
6. deploy with `CustomerTotpEnabled=true` and the exact `CustomerTotpKmsKeyArn` while keeping subscription billing false;
7. verify health and all existing password/magic-link behavior before enrolling any account;
8. separately approve one owner TOTP enrollment canary;
9. owner enables authenticator, saves backup codes, signs out;
10. prove password + TOTP login;
11. prove one backup-code login and one-time invalidation;
12. prove TOTP replay rejection;
13. prove password change keeps TOTP enabled and invalidates older sessions;
14. only then consider the feature ready for optional customer use.

## Approval boundaries

This implementation PR authorization includes code, tests, UI, documentation, and opening a PR.

It does **not** authorize:

- merge;
- KMS key creation or key-policy mutation;
- production preflight dispatch;
- deployment;
- enabling `CustomerTotpEnabled`;
- enrolling the production owner account;
- sending email;
- subscription billing;
- Stripe changes;
- charges.
