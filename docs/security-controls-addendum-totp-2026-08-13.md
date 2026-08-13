# Security Controls Addendum — Authenticator TOTP

**Status date:** 2026-08-13  
**Applies after:** PR #141 and PR #142 merged to `main`  
**Current `main` at time of verification:** `812f3a41287296d43df0b911ea831356fcb42922`

This addendum updates `security-controls-status-2026-08-13.md` after the optional authenticator-app implementation and its guarded rollout package were merged.

## Important production boundary

Authenticator-app 2FA is **implemented in the repository but not enabled in production yet**.

Current production boundary remains:

- API access: enabled;
- customer accounts: enabled;
- password sign-in: enabled and owner-canary verified;
- subscription billing: disabled;
- authenticator TOTP feature: disabled;
- dedicated production TOTP KMS key: not created;
- owner/customer TOTP enrollment: not performed;
- no TOTP rollout email sent;
- no Stripe/billing activation or charge performed.

A merged feature is not the same thing as a production-enabled feature.

## TOTP controls now implemented in code

The merged implementation adds:

- RFC 6238-compatible TOTP;
- six-digit codes;
- 30-second steps with a bounded ±1-step verification window;
- a unique random 20-byte secret per enrollment;
- KMS-based TOTP secret encryption;
- account-bound KMS encryption context;
- a short-lived opaque MFA challenge after the first factor;
- no full authenticated session before the second factor succeeds for an enrolled account;
- password first factor followed by TOTP/backup code;
- magic-link recovery that still requires the second factor;
- ten unique one-time backup codes;
- keyed backup-code fingerprints instead of plaintext persistence;
- atomic one-time backup-code consumption;
- accepted-TOTP-step persistence to prevent reuse of the same rotating code;
- five-minute MFA challenge expiry;
- bounded MFA attempts and source throttling;
- `authVersion` invalidation when authenticator security state changes;
- password replacement that preserves enabled TOTP instead of silently removing MFA;
- fail-closed behavior when TOTP/KMS support is unavailable;
- fail-closed handling for malformed partial TOTP account state.

## Duplicate/replay protections added by TOTP

The authenticator implementation extends the repository's duplicate/idempotency controls:

- enrollment secrets are independently random per setup;
- backup codes are generated uniquely within a set;
- a backup-code fingerprint is removed atomically on use;
- the same backup code cannot satisfy another challenge after successful consumption;
- the last accepted TOTP time step is conditionally advanced;
- a previously accepted TOTP time step cannot satisfy a later challenge;
- MFA challenge records are opaque, short-lived, and bounded by attempt count;
- security-state updates advance account `authVersion`, invalidating older sessions and version-bound recovery links.

## KMS least-privilege runtime boundary

The merged SAM definition grants the customer-auth runtime only the KMS cryptographic operations needed for TOTP material when the feature is enabled:

- `kms:Encrypt`;
- `kms:Decrypt`.

Those operations are scoped to the configured full KMS key ARN and further constrained by encryption context:

- `purpose = solvelang-customer-totp`;
- `accountId = acct_*`;
- only the expected `purpose` and `accountId` context keys are accepted.

This binds ciphertext use to the intended SolveLang customer-TOTP purpose and account context.

## Production rollout controls now merged

PR #142 adds the reviewed rollout package while leaving production TOTP OFF:

- separate retained/rotating KMS stack definition;
- protected/manual KMS bootstrap workflow;
- validation-only production TOTP preflight;
- protected/manual TOTP API deployment workflow;
- exact production KMS ARN derived from stack output rather than user input;
- ordinary production customer-account redeploys preserve the current TOTP flag and KMS ARN;
- rollback restores the exact pre-deploy TOTP flag and KMS ARN;
- production deployment requests share the attempt-aware queue;
- subscription billing remains forced off during the authenticator rollout;
- TOTP deployment workflows contain no production Stripe secret references;
- deployment itself enrolls no customer and sends no email.

## Still not implemented/live

Centralized customer account suspension/termination enforcement is **not yet merged or live**. It remains a separate buildout stage and must not be claimed as an active security control.

Production TOTP also remains disabled until its remaining IAM/KMS/preflight/deployment gates are safely completed and an owner canary passes.
