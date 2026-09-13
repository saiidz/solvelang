# API access production data recovery

This runbook covers the durable customer/account state required for a safe SolveLang API-access recovery. It is deliberately split into a read-only readiness check and a separately approved recovery action.

## Protected state

The production readiness verifier checks the tables that contain durable customer identity and subscription state (`ApiAccountsTable`), API-key state (`ApiKeysTable`), customer authentication/TOTP state (`ApiCustomerAuthTable`), and Stripe subscription webhook replay protection (`ApiSubscriptionEventsTable`).

The existing production foundation process enables DynamoDB point-in-time recovery (PITR). Repository merges or a successful verifier do not authorize a restore, table replacement, CloudFormation update, customer mutation, billing activation, or any other production write.

## Read-only readiness check

From `services/api-access`, run:

```bash
bash scripts/verify-production-data-protection.sh solvelang-api-access-production us-east-2
```

The verifier uses only CloudFormation and DynamoDB describe operations. For every protected table it fails unless:

- the CloudFormation logical resource resolves to a physical table;
- the DynamoDB table is `ACTIVE`;
- server-side encryption is `ENABLED`;
- PITR is `ENABLED`;
- DynamoDB reports both earliest and latest restorable timestamps.

Successful output is one JSON object per table containing only resource identifiers and recovery posture. Store that output with the launch/recovery evidence; it contains no credentials or table records.

## Recovery decision gate

A production restore is an explicit owner/protected operation. Before any restore, record:

1. the incident and affected table(s);
2. the desired recovery timestamp and why it is safe;
3. the current table names and latest restorable timestamps;
4. the expected customer/account impact;
5. the reconciliation plan for events that occurred after the recovery timestamp;
6. the rollback path if the recovered data is incomplete or inconsistent.

Do not restore directly over the active table. DynamoDB point-in-time recovery creates a new table. The recovered table must be treated as a candidate until it is independently verified.

## Owner-approved restore procedure

Only after the exact recovery action is approved:

1. Restore the affected source table to a new, uniquely named recovery table at the approved timestamp.
2. Wait for the restored table to become `ACTIVE` and confirm encryption/PITR posture before reading records.
3. Compare bounded counts and selected account/key/auth invariants against the incident evidence. Do not expose password material, TOTP ciphertext, API-key hashes, Stripe identifiers, or customer data in exported evidence.
4. Reconcile post-restore facts that must not be replayed incorrectly, especially subscription/webhook ordering, key revocations, authentication-version changes, suspensions/terminations, and TOTP changes.
5. Prepare a separate reviewed cutover or data-repair change. Never point production traffic at the recovered table merely because restoration succeeded.
6. Verify application health, authentication, API-key authorization, subscription state, monitoring, and rollback independently after any approved cutover.

## Rollback

If validation fails, leave the active production table untouched and discard the recovery candidate only under the approved cleanup scope. If a cutover was already approved and executed, rollback must use the preserved pre-cutover table/reference rather than attempting an unreviewed second restore.

## Evidence boundary

Acceptable evidence: logical/physical table identifiers, table status, SSE status, PITR status, restorable timestamp window, workflow/run identifiers, and sanitized validation outcomes.

Do not export table contents, credentials, password hashes, TOTP ciphertext, backup codes, API-key hashes, Stripe secrets, webhook secrets, or customer source data into issues, pull requests, logs, or recovery evidence.
