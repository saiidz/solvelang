# SolveLang production-readiness repository audit — 2026-09-13

This document records a **repository-only** audit of the remaining production-launch gates in Issue #113 after repository-safe completion. It does not claim access to the AWS, Stripe, Cloudflare, PostHog, or other live production consoles, and it does not authorize any live mutation.

## Scope and authority

Reviewed repository state on current `main` after the project-completion report. This audit may classify a control as implemented, repository-verifiable, or live-only. It must not convert repository evidence into a claim that a production alarm, secret, webhook, restore drill, provider credential, charge, deployment, or external configuration is active.

No deployment, provider request, credential use, Stripe action, charge/refund, customer mutation, email, release publication, or Solve Runner/Solblend action is authorized by this document.

## Repository-side findings

### Billing gate and Stripe initialization

**Repository status: implemented and fail-closed. Live status: unverified.**

- `SubscriptionBillingEnabled` defaults to false in infrastructure/configuration contracts.
- The runtime only constructs the Stripe-backed subscription management application when the billing flag is enabled.
- Configuration tests verify that disabled billing does not require or expose Stripe secret material.
- The customer checkout path and the internal/admin subscription checkout/provisioning paths are independently gated by `subscriptionBillingEnabled`.
- Repository tests cover webhook replay/idempotency, checkout ownership binding, payment-failure/recovery ordering, and the billing-off side-effect boundary.

Remaining live-only evidence:

- production Stripe account/resource identity;
- production webhook endpoint/signing-secret identity;
- current live feature-flag value;
- production Price/Product identifiers and seller/business identity;
- real webhook delivery health;
- any charge/refund or billing enablement canary.

No real-charge authorization exists from repository state.

### Monitoring, alerts, and queue/DLQ posture

**Repository status: monitoring contract defined. Live activation: not proven.**

`docs/production-operations.md` defines the required alert baseline for API Lambda errors/throttles/duration, authorizer errors/throttles, repeated billing/webhook failures, and any future priority-queue depth/age/DLQ/worker failures. It also requires owner-controlled notification routing.

The repository does **not** establish that these alarms and notification targets are deployed and currently firing correctly in production. Paid priority must remain disabled until queue workers and required alarms are deployed and verified.

### Log redaction and retention

**Repository status: policy defined and sanitizer-oriented implementation exists. Live retention/IAM: unverified.**

The operations contract requires structured logs and explicitly forbids plaintext API keys, auth/session tokens, peppers, Stripe keys/webhook secrets, full payment credentials, raw request/response bodies, caught exception messages/stack traces, and customer workflow/source material. It requires allowlisted correlation fields and sanitized error codes.

Production log retention must be configured explicitly rather than indefinite. The repository recommends an initial 90-day target subject to owner/legal/compliance review, but repository state does not prove the live CloudWatch retention period or IAM access controls.

### DynamoDB protection and restore readiness

**Repository status: read-only verifier implemented. Live PITR result: requires execution against production.**

`services/api-access/scripts/verify-production-data-protection.sh` performs read-only table/continuous-backup inspection. The verifier requires active tables, server-side encryption, PITR enabled, and a valid restorable window for durable account/subscription/API-key/auth/TOTP/webhook-replay state.

`docs/production-operations.md` defines a safe restore-drill procedure that restores only to a separate table name, verifies isolation and encryption/access controls, retains sanitized aggregate evidence, and never overwrites a healthy table.

Repository tests and scripts do not prove that a current production restore drill has actually completed. A restore remains an owner/protected operation.

### Rollback and disable paths

**Repository status: procedures and fail-closed controls exist. Live drill state: unverified.**

Repository guidance covers site rollback, API/CloudFormation rollback, and billing incident response. Billing correctness incidents must stop new checkout/plan-change mutations before any broader action, preserve reconcilable webhook ingestion when safe, and avoid ad-hoc entitlement rewrites.

The billing-off gate is enforced in code, including internal/admin mutation paths. Historical production workflows also preserve `SubscriptionBillingEnabled=false` on rollback paths.

Repository state does not prove a recent live rollback drill for every deployed surface.

### Incident response and secret rotation

**Repository status: operational contract defined. Live contacts/records: external.**

The operations document defines the sanitized incident record, required owner roles, recovery/handoff conditions, and rotation guidance for API-key pepper, customer-auth pepper, Admin secret, Stripe secret key, and webhook signing secret.

Personal contacts and recovery material correctly remain outside source control. Therefore their current existence and accuracy are live/operator evidence, not repository evidence.

### Account/Admin/TOTP production state

**Repository status: historical verified production evidence exists; fresh live re-verification still belongs to #113.**

The repository records previously verified API access/customer accounts/password auth, private Admin ingress/UI, Admin password rotation/read-only lookup, and TOTP KMS/IAM/API foundations. Those records must not be interpreted as perpetual proof of current production configuration. A fresh launch step should re-check only what is needed for the planned launch action.

### PostHog / Self-Driving

**Repository status: prerequisite boundaries implemented. Live canary: intentionally blocked by #833.**

Repository code now contains the bounded one-request PostHog canary contract, sanitizer/stream limits, single-use approval/claim chain, runtime auth gate, injected credential source, kill switch, and lifecycle/finalization boundaries.

Still live-only and owner-gated:

- current PostHog tenant/project/region/endpoint verification;
- exact key scope and secret reference;
- concrete reviewed live credential/secret-store implementation;
- deployed/verified kill switch;
- fresh owner authorization;
- the one real read-only canary request and lifecycle evidence.

Issue #833 must remain open until those facts are verified. No credential value belongs in GitHub, chat, logs, screenshots, or repository files.

### Release/publication readiness

**Repository status: release controls implemented. Publication: owner-gated.**

The repository has non-publishable Linux x86_64 release-candidate regeneration, annotated-tag regeneration checks, provenance/version binding, and release-truth reconciliation. Linux x86_64 is the only currently evidenced CLI artifact target.

macOS ARM64 and Windows x64 must not be advertised as released CLI artifact targets without exact-platform evidence on the selected release commit. Tag creation, GitHub Release publication, assets/packages, and marketplace publication remain explicit owner actions.

### Legal/customer-facing launch decisions

**Repository status: decision checklist exists. Decisions: owner/counsel/business gate.**

The repository now has an explicit checklist for Terms, Privacy, recurring billing, refund/cancellation, retention, seller identity, invoices/receipts/tax expectations, support, incident communication, suspension/termination/acceptable use, AI/provider/Self-Driving disclosures, and release/platform claims.

The checklist deliberately does not invent legal commitments. These decisions remain external to engineering completion.

## #113 gap classification

### Repository-complete / no additional code implied by current evidence

- billing kill-switch and fail-closed mutation gates;
- webhook replay/idempotency and delivery-ledger repository proof;
- checkout ownership binding;
- payment-failure/recovery ordering proof;
- read-only production data-protection verifier;
- rollback/incident/secret-rotation operational contracts;
- log-redaction policy;
- legal/customer launch decision checklist;
- current-main security review and repository completion report;
- Codex/Claude repository integration proof;
- PostHog canary safety boundaries through the owner gate.

### Requires live read-only verification when production access is available

- actual production billing flag and Stripe resource/webhook identities;
- actual CloudWatch alarms/notification routing;
- actual queue/DLQ posture if any queue-backed feature is considered for activation;
- actual CloudWatch log retention and IAM restrictions;
- current DynamoDB PITR/restorable-window evidence;
- current production IAM/least-privilege and environment/key separation for the exact planned rollout;
- current account/Admin/TOTP configuration needed for the planned launch step;
- current PostHog project/key-scope and external secret/lifecycle backend prerequisites.

### Requires explicit owner/protected action — do not perform from repository state

- enabling billing or paid priority;
- any Stripe charge/refund or live billing canary;
- any deployment or AWS/IAM/KMS/DNS/Cloudflare/Admin mutation;
- a DynamoDB restore drill or configuration switch;
- TOTP account canaries or customer mutations;
- the first live PostHog canary (#833);
- public tag/release/package/marketplace publication;
- legal/business approvals;
- Solve Runner/Solblend provisioning, registration, pricing, or rollout.

## Current conclusion

No new source-level launch blocker was identified by this repository-only pass. The remaining #113 blockers are predominantly **live configuration evidence, operational exercises, publication choices, and owner/business/legal decisions**, not an unbounded request for more repository feature development.

Until live read-only evidence can be collected, billing, paid priority, provider activation, general managed execution, and the first live PostHog canary must remain unclaimed/off unless separately verified and authorized.
