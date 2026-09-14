# SolveLang production operations controls

Status: **design complete; activation requires a future approved production deployment**.

These controls define the minimum operational baseline for the API access/billing stack. They do not deploy resources by themselves.

## Monitoring baseline

Production must have alerts routed to an owner-controlled notification target for:

The provider-neutral, repository-only [monitoring readiness contract](production-monitoring-contract.json) locks the required future signals and activation gates for customer authentication, subscription billing, and priority queues. It contains no provider account, resource, notification target, or deployment configuration and does not authorize activation.

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

### Connected support automation

The repository support stack defines five bounded signals while activation and sending remain independently OFF by default:

- support-worker Lambda invocation errors;
- handled account-processing failures (`FAILED`, source-initialization failure, or source-identity mismatch) surfaced as the sanitized `support_automation_worker_failure` marker, because these paths can return a successful Lambda invocation while the account did not process safely;
- EventBridge poll-schedule failed invocations;
- `support_automation_action_unknown`, meaning an external action has an ambiguous outcome and must not be retried blindly;
- `support_automation_message_age_exceeded`, emitted without message identity/body when a provider message is older than the configured processing-age threshold at read time.

The default message-age threshold is 15 minutes and is bounded by configuration to 5 minutes through 24 hours. The alarm destination is an explicit SNS topic ARN parameter. Repository configuration refuses activation when that destination is empty; this is configuration evidence only, not proof that a future topic/subscription is live or delivering alerts.

Before any separately authorized activation, verify the intended alarm destination and the five alarm resources from the deployed stack. Do not use a customer mailbox address, raw support content, provider credentials, or customer identifiers as alarm payload dimensions.

#### Support disable procedure

A live stop is a production mutation and requires separate exact-scope owner authorization. When that authorization exists, the bounded order is:

1. turn the global support-automation activation gate OFF so the poll schedule becomes disabled;
2. keep the mail-send gate OFF, or turn it OFF at the same protected change if it had been separately enabled;
3. pause the affected tenant configuration through the authenticated support control when a tenant-specific stop is required;
4. preserve the support table, source cutover/cursor, event history and action outcome rows; do not delete them as a shutdown shortcut;
5. do not rotate/revoke credentials merely to stop processing unless credential compromise is the incident being handled;
6. verify the deployed activation flag and schedule state independently, then record only sanitized alarm/error evidence.

An `OUTCOME_UNKNOWN` action stays unknown after disable. A stopped, started, unknown, or otherwise non-newly-claimed action is not authority for a retry. Reconciliation must be an explicit future operation; recovery must never convert an ambiguous provider outcome into an automatic resend.

#### Support recovery procedure

Recovery is also a protected production operation. Before any resume:

1. inspect only the account-scoped redacted processing history and sanitized alarms/log markers; never copy raw support bodies or secrets into the incident record;
2. identify whether the stop was caused by worker/schedule failure, message-age breach, source identity/TLS/UIDVALIDITY failure, account restriction, policy review, credential failure, or ambiguous provider outcome;
3. leave any ambiguous action terminal and unretried; resolve its provider state outside the automation before considering a separately designed reconciliation path;
4. preserve the existing IMAP source identity/cutover/cursor unless an explicitly reviewed reconfiguration is required. Do not reset the cursor to sweep historical unread mail;
5. if credentials are suspected, keep processing paused and use the approved secret-rotation path; do not place credential material in issues, PRs, chat, logs, screenshots, or test fixtures;
6. re-verify account access, current policy, approved mail host, alarm destination, activation gate, and send/recipient gates before a separately authorized resume;
7. use only a controlled new-message boundary for any later live validation and independently verify stop/recovery behavior before calling the integration live.

An alert returning to `OK` is not itself recovery proof. Recovery evidence must include the intended feature/schedule state and sanitized processing outcome, and must not claim mailbox delivery/task creation unless the provider outcome was actually verified under its own authorization.

## Log policy

- Use structured logs with no plaintext API keys, magic-link tokens, session tokens, peppers, Stripe secret keys, webhook secrets, or full payment credentials.
- Do not log raw request or response bodies, caught exception messages or stack traces; retain only allowlisted correlation fields and sanitized error codes.
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

1. document each production table name, retention setting, and intended UTC recovery point;
2. before requesting a restore, verify that the recovery table name differs from the source and is not referenced by active application configuration, aliases, or traffic routes; abort the drill if that cannot be established from the approved operational record;
3. restore the source table only to that new recovery table name;
4. verify encryption and access controls;
5. validate representative records without exposing secret material;
6. document a separately approved configuration-switch and rollback path; do not switch application configuration as part of the drill;
7. delete the drill recovery table only after evidence is retained.

Before cleanup, retain a sanitized drill record outside source code with the source and recovery-table identifiers, requested UTC recovery point, isolation verification, encryption/access-control verification, aggregate-only representative-record verification result, and confirmation that no active route or configuration was changed. Do not retain record contents, secrets, sessions, credentials, or raw logs as drill evidence.

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

## Suspected API-key exposure

For a suspected API-key leak, open the owner-controlled incident record before any containment decision. Do not paste or store the plaintext key in the incident record, issue, pull request, chat, logs, screenshots, or repository.

Until a separately authorized operator has verified the scoped outcome, treat the key as untrusted and do not use it for investigation or customer work. The accountable owner must record the decision to revoke the identified key, suspend the affected account where scope cannot be bounded, or explicitly hand off the unresolved risk; do not infer the affected account from unverified reports.

If a separately authorized revoke occurs, retain only the sanitized key identifier, decision owner, timestamp, and verification that the revoked key is denied. Issue any replacement through the normal authenticated, audited path; do not rotate the API-key pepper as an incident shortcut.

### Customer-auth pepper

Rotation can invalidate active session/magic-token fingerprints. Plan a controlled session reset or a versioned/dual-pepper transition.

### Admin secret

Rotate by updating the protected production environment and redeploying the approved stack. Confirm old secret rejection after the new version is live.

### Stripe secret key

Use Stripe-supported key rotation. Update the protected production secret, deploy/validate, then retire the old key. Never paste the live key into issues, PRs, logs, screenshots, or chat.

### Stripe webhook signing secret

When rotating the webhook endpoint/signing secret, support an overlap strategy if required so legitimate deliveries are not dropped during cutover. Verify signed delivery before retiring the prior endpoint/secret.

## Incident record and redaction gate

Before any production change, outage communication, rollback decision, or post-incident review, open an owner-controlled incident record outside source code. This is an operational record, not a request to run a production command.

The initial record must contain only:

- the UTC detection time, the accountable incident owner, and the approved communication channel;
- the affected component and customer-impact statement, with unknown impact recorded as `unknown` rather than guessed;
- the reviewed commit SHA, workflow run URL/ID, stack/region identifier, and sanitized request IDs or error codes when they are relevant;
- the observed monitoring signal, its time window, and whether the signal is still firing;
- the explicit decision to observe, roll back, or disable a mutation path, plus the owner who made that decision;
- the verification result after the decision, including `/health` and feature-flag state where a separately authorized operator performed those checks.

Do not put live secrets, API keys, webhook payloads/signing secrets, session or magic-link tokens, cookies, password values or hashes, payment details, customer workflow/source content, raw log bodies, or recovery codes in the incident record, issue, pull request, chat, screenshot, or repository. Preserve the minimum sanitized evidence needed to correlate the incident; keep any protected raw evidence only in the approved restricted-access system.

An incident remains open until an accountable owner records one of: a verified recovery, a completed state-preserving rollback, or an explicit handoff with the unresolved risk and next owner. Do not mark recovery solely because an alert stopped firing; record the corresponding health, feature-state, and customer-impact verification.

## Incident ownership

Before production launch, record outside source code:

- primary technical owner;
- backup technical owner;
- business/billing owner;
- customer-support contact;
- status/incident communication channel;
- Stripe/AWS account access recovery contacts.

The repository may describe roles, but personal phone numbers, credentials, or secret recovery material must not be committed.
