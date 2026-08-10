# SolveLang production operations controls

Status: **design complete; activation requires a future approved production deployment**.

These controls define the minimum operational baseline for the API access/billing stack. They do not deploy resources by themselves.

## Monitoring baseline

Production must have alerts routed to an owner-controlled notification target for:

### API Lambda

- `Errors >= 1` over 5 minutes for the customer/API handler.
- `Throttles >= 1` over 5 minutes.
- sustained duration approaching the configured timeout.

### API-key authorizer

- `Errors >= 1` over 5 minutes.
- `Throttles >= 1` over 5 minutes.
- abnormal authorization-denial spikes should be investigated through sanitized structured logs, not by logging credentials.

### Billing/webhooks

Application logs already classify subscription-management errors and webhook processing outcomes. Production alarm design must surface repeated webhook failures or Lambda errors on the webhook path. Stripe webhook delivery health must also be reviewed during incidents.

### Queue-backed features

Any future priority queue enabled in production must alarm on:

- visible messages building unexpectedly;
- age of oldest message;
- messages arriving in a DLQ;
- worker Lambda errors/throttles.

Paid priority must remain disabled until those alarms and queue workers are deployed and verified.

## Log policy

- Use structured logs with no plaintext API keys, magic-link tokens, session tokens, peppers, Stripe secret keys, webhook secrets, or full payment credentials.
- Keep request IDs and sanitized error codes so incidents can be correlated without secrets.
- Production log retention must be explicitly configured rather than left indefinite.
- Access to logs must be restricted through IAM.

Recommended initial retention target: 90 days, subject to owner/legal/compliance review.

## DynamoDB recovery

Persistent production tables containing customer/account/key state must have point-in-time recovery enabled before customer access is opened.

At minimum:

- API accounts
- API keys
- customer authentication/session state where recovery is appropriate
- subscription event/idempotency state where restoration semantics have been reviewed

TTL-based ephemeral data can still use PITR, but restoration must not be treated as a way to resurrect expired credentials. After a restore, expired sessions/magic links remain invalid according to application timestamps/TTL semantics.

### Restore drill

Before public production availability:

1. document each production table name and retention setting;
2. restore a table to a new recovery table name;
3. verify encryption and access controls;
4. validate representative records without exposing secret material;
5. document how application configuration would be switched to restored data if required;
6. delete the drill recovery table only after evidence is retained.

Never overwrite a healthy production table during a drill.

## Rollback

### Site

- identify the last known-good commit/build;
- redeploy/revert only the site artifact;
- verify account and pricing pages still match backend capability.

### API stack

- retain the last known-good CloudFormation/SAM commit SHA;
- prefer CloudFormation rollback/redeploy rather than ad-hoc console mutations;
- verify `/health` and enabled feature flags after rollback;
- do not delete account/billing tables as a rollback mechanism.

### Billing

If billing correctness is uncertain:

1. stop new checkout/plan-change mutations first;
2. preserve signed webhook ingestion when safe so Stripe remains reconcilable;
3. avoid manually rewriting entitlements unless the incident runbook explicitly requires it;
4. reconcile customer/invoice/subscription state before re-enabling mutations.

## Secret rotation

Production secrets must be independent from test and rotated one class at a time with rollback evidence.

### API key pepper

Changing the API-key fingerprint pepper can invalidate existing key lookup/verification behavior. Do not rotate it casually. A migration/dual-read strategy must be designed before rotation if existing keys are to survive.

### Customer-auth pepper

Rotation can invalidate active session/magic-token fingerprints. Plan a controlled session reset or a versioned/dual-pepper transition.

### Admin secret

Rotate by updating the protected production environment and redeploying the approved stack. Confirm old secret rejection after the new version is live.

### Stripe secret key

Use Stripe-supported key rotation. Update the protected production secret, deploy/validate, then retire the old key. Never paste the live key into issues, PRs, logs, screenshots, or chat.

### Stripe webhook signing secret

When rotating the webhook endpoint/signing secret, support an overlap strategy if required so legitimate deliveries are not dropped during cutover. Verify signed delivery before retiring the prior endpoint/secret.

## Incident ownership

Before production launch, record outside source code:

- primary technical owner;
- backup technical owner;
- business/billing owner;
- customer-support contact;
- status/incident communication channel;
- Stripe/AWS account access recovery contacts.

The repository may describe roles, but personal phone numbers, credentials, or secret recovery material must not be committed.
