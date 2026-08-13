# Production Authenticator TOTP Rollout

**Status:** prepared, not yet enabled in production  
**Production API region:** `us-east-2`  
**Production API stack:** `solvelang-api-access-production`  
**Dedicated KMS stack:** `solvelang-api-access-production-totp-kms`  
**Dedicated KMS alias:** `alias/solvelang-customer-totp-production`

This runbook is an execution contract. It does not itself authorize a merge, live IAM change, KMS creation, preflight dispatch, production deployment, customer enrollment, email, billing, Stripe, webhook activation, or charge.

## Target end state

After a successful rollout:

- API access remains enabled;
- customer accounts remain enabled;
- optional authenticator-app 2FA is available to customers;
- customers who do not enroll keep the current password/magic-link behavior;
- enrolled customers must provide a valid authenticator or unused backup code after password or magic-link first factor;
- subscription billing remains disabled;
- no Stripe credentials are injected;
- no charge is performed;
- the dedicated TOTP key is customer-managed, symmetric, rotating, retained, single-region, and protected by a stable alias;
- ordinary production customer-account redeploys preserve the exact TOTP flag and KMS key ARN;
- post-deploy rollback restores the exact pre-deploy TOTP flag and KMS key ARN.

## Why KMS is separate

The production TOTP key is intentionally managed in its own CloudFormation stack. The ordinary API stack accepts only the full KMS key ARN and never creates or replaces the key.

This separation provides an explicit security gate between:

1. creating/proving the encryption key; and
2. allowing customer accounts to encrypt TOTP secrets with that key.

The KMS template applies `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. The protected KMS deployment workflow also enables CloudFormation termination protection. The deploy-role policy intentionally does not grant `kms:ScheduleKeyDeletion`, `kms:DisableKey`, `kms:PutKeyPolicy`, `kms:Encrypt`, or `kms:Decrypt`.

## Prerequisites already implemented

The customer-auth implementation provides:

- RFC 6238-compatible 6-digit TOTP;
- 30-second time steps with a bounded clock window;
- a unique 20-byte secret per enrollment;
- account-bound KMS encryption context;
- 5-minute MFA challenges;
- bounded challenge attempts and source throttling;
- no full session after only the first factor for an enrolled account;
- magic-link recovery that still requires the customer's second factor;
- ten unique one-time backup codes whose plaintext is shown only at generation;
- keyed backup-code fingerprints at rest;
- transactional one-time backup-code consumption;
- accepted TOTP time-step replay prevention;
- `authVersion` invalidation for sensitive security changes;
- fail-closed malformed/partial TOTP account state;
- feature default `CustomerTotpEnabled=false`.

## Required production sequence

Do not combine the following gates.

### Gate 1 — merge rollout preparation

Required approval:

```text
APPROVE MERGE PR #<rollout-prep-pr>
```

Before merge:

- API Access CI green;
- site CI green;
- Rust/RustSec green;
- KMS CloudFormation lint green;
- all rollout/rollback/queue tests green;
- no unresolved review finding;
- exact PR head recorded.

The merge itself still does not create a KMS key or enable TOTP.

### Gate 2 — update the live GitHub OIDC role policies

Tracked policy contracts:

- validation role: `ops/aws/production-preflight-policy.json`
- deploy role: `ops/aws/production-foundation-deploy-policy.json`

Applying these files to the live roles is an AWS/IAM mutation and requires a separate explicit owner approval.

The validation role receives read-only access to the production API/KMS stacks, dedicated tagged TOTP KMS metadata, SES readiness, and template validation.

The deploy role receives the narrowly constrained authority needed to create/manage only the tagged production TOTP KMS key/alias and to enable termination protection on only the dedicated KMS stack. It does not receive cryptographic use of the key and cannot schedule its deletion.

Do not allow the regular deploy role to self-modify its own IAM policy.

### Gate 3 — create/prove the dedicated KMS stack

Workflow:

```text
Deploy API Access Production TOTP KMS
```

Required confirmations:

- `confirm_production_totp_kms=true`
- `confirm_totp_remains_disabled=true`

This workflow must verify the current live API/customer/billing baseline before it mutates KMS.

It may create or idempotently update only:

```text
solvelang-api-access-production-totp-kms
```

It must then verify:

- exact production account and Region;
- stable stack;
- customer-managed key;
- key state enabled;
- `SYMMETRIC_DEFAULT`;
- `ENCRYPT_DECRYPT`;
- AWS KMS origin;
- single-region key;
- automatic rotation enabled;
- Project/Purpose/Environment tags;
- expected stable alias;
- default key policy retains account IAM delegation;
- CloudFormation termination protection enabled.

It must not deploy the API, enable TOTP, enroll an account, send email, use Stripe, or charge anything.

### Gate 4 — run validation-only TOTP production preflight

Workflow:

```text
Preflight API Access Production TOTP
```

Required confirmation:

```text
confirm_production_totp_preflight=true
```

The preflight assumes the read-only production validation role, not the deploy role.

It must verify:

- exact main commit checkout;
- current API stack stable;
- API access true;
- customer accounts true;
- current TOTP false for first enablement;
- subscription billing false;
- production health matches those flags;
- dedicated KMS stack/key/rotation/tags/alias/policy;
- production customer page points to the exact API base;
- deployed browser assets contain every required TOTP route and authenticator UI;
- verified SES sender and production SES access;
- API tests;
- SAM lint/build;
- KMS template validation;
- ordinary customer redeploy preserves TOTP state;
- rollback preserves exact TOTP/KMS state;
- all production mutations share attempt-aware serialization;
- no Stripe secrets exist in the TOTP deployment workflow.

The preflight performs no deployment and sends no email.

### Gate 5 — enable optional TOTP in the API stack

Workflow:

```text
Deploy API Access Production TOTP
```

Required confirmations:

- `confirm_production_totp=true`
- `confirm_billing_remains_disabled=true`

The workflow re-runs the important preflight checks before assuming the deploy role.

The KMS ARN is read from the dedicated KMS stack output. It is not supplied as a workflow input or GitHub secret.

The API deployment passes exactly:

```text
ApiAccessEnabled=true
ApiAccessMode=live
CustomerAccountsEnabled=true
CustomerTotpEnabled=true
CustomerTotpKmsKeyArn=<exact dedicated KMS stack output>
SubscriptionBillingEnabled=false
```

The deployment must never inject Stripe secrets.

Post-deploy verification requires:

- API health `enabled=true`;
- `customerAccountsEnabled=true`;
- `customerTotpEnabled=true`;
- `subscriptionBillingEnabled=false`;
- stack parameter KMS ARN exactly equals the dedicated KMS output;
- subscription webhook continues returning the billing-disabled response;
- production operations baseline is re-applied.

If post-deploy verification fails after the stack update, the rollback script restores the exact feature state captured before deployment, including the TOTP flag and KMS ARN.

No customer is enrolled and no email is sent by the deployment.

### Gate 6 — owner enrollment canary

Only after the deployment is proven healthy.

If the owner already has a valid password-authenticated session, enrollment can be performed without email. If a recovery link is needed to obtain a session, sending that email requires the separate email-canary approval.

Canary sequence:

1. Sign in with the existing owner password.
2. Confirm the account page reports authenticator support available but not enabled.
3. Begin authenticator setup.
4. Add the setup key to an authenticator app.
5. Confirm enrollment using current password + a fresh six-digit code.
6. Save the ten backup codes outside SolveLang.
7. Sign out.
8. Sign in with username/password and prove that no full session is created before TOTP.
9. Enter a fresh authenticator code and reach the dashboard.
10. Confirm ordinary password + TOTP login sends no email.
11. Sign out and perform one login using one backup code.
12. Confirm that exact backup code cannot be used again.
13. Confirm backup-code remaining count decreases.
14. Confirm a reused TOTP time-step is rejected.
15. Change the password and prove TOTP remains enabled while older sessions become invalid.
16. Confirm billing remains off and no unexpected API key/subscription state changed.

Do not consume all backup codes during the canary.

## Routine redeploy safety after TOTP is live

`Deploy API Access Production Customer Accounts` must never reset TOTP to template defaults.

Before each ordinary customer-account redeploy it now captures:

- current `CustomerTotpEnabled`;
- current `CustomerTotpKmsKeyArn`.

It validates any real KMS key before deployment, passes both values back to SAM unchanged, verifies health afterward, and exposes them to rollback.

This protects enrolled customers from an unrelated customer-account redeploy silently disabling MFA or changing the encryption key reference.

## Key-loss rule

Once any production TOTP secret has been encrypted with the dedicated key, changing to a different KMS ARN is not an ordinary configuration update. The TOTP deployment workflow fails closed if production TOTP is already enabled with a different key.

Any future key migration must be designed as a separate decrypt/re-encrypt migration with independent review, backup/recovery planning, and explicit approval.

## Billing boundary

Every authenticator rollout workflow preserves:

```text
SubscriptionBillingEnabled=false
```

The TOTP KMS workflow does not touch the API stack. The preflight does not deploy. The TOTP deployment injects no Stripe secret or webhook secret, and its post-deploy check requires the billing webhook to remain disabled.

Authenticator rollout authorization never implies billing authorization.

## Cross-chat continuation

The live project handoff is `docs/active-buildout-handoff.md`. A new chat should read that file and re-check GitHub state before continuing. The repository state, current PR SHA, hosted CI, and unresolved review threads are authoritative over remembered conversation state.
