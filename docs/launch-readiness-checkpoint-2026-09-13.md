# SolveLang launch-readiness checkpoint — 2026-09-13

This checkpoint records repository evidence only. It does **not** authorize production deployment, billing enablement, live Stripe activity, a real charge/refund, provider credentials, the first live PostHog canary, production customer/source mutation, publication, or Solve Runner/Solblend work.

## Exact repository checkpoint

- `main` after the current-main rendering security fix: `e22a39a10f955945cad7497f3afa82cee3f9c5a4` (merge of #877).
- Open production/completion issues remain #113, #820, and #833.
- Subscription billing and paid priority remain off unless separately owner-approved and verified live.
- #833 remains the explicit owner/credential gate for the first live PostHog canary.
- Solve Runners / Solblend remains a separate product and authority boundary.

## Repository-safe work now proven

### Self-Driving / provider preparation

- #866: isolated PostHog runtime-auth gate with exact approval/claim binding, bounded activation, kill-switch checks, and callback-scoped ephemeral auth.
- #868: activation-bound injected credential-source and kill-switch infrastructure adapters without built-in secrets or live provider access.
- #869–#870: exact lifecycle/finalization authority checks and a bounded injected lifecycle operator boundary for retention/deletion/revocation evidence.
- #871: installed-package MCP protocol roundtrip proving the canonical Codex + Claude plugin package against the read-only MCP server.

These merges are prerequisites only. They do not establish a live PostHog project/key, deployed kill switch, live secret source, real provider request, marketplace publication, or production activation.

### Billing repository qualification

- #872: signed webhook replay converges on one entitlement/outbox commit; repeated durable queue deliveries retain a stable confirmation idempotency key; the delivery ledger suppresses a second confirmation after success is recorded.
- #873: checkout ownership is bound to authenticated server-side account/session state; caller-supplied account/email/customer identifiers cannot replace authoritative ownership.
- #874: a newer recovered active subscription state clears prior past-due grace state, and an older delayed failure event cannot overwrite the newer recovery.

These are repository-only proofs. Remaining billing launch work still includes live Stripe configuration/webhook identity validation, the rest of the subscription lifecycle matrix (upgrade/downgrade/cancel/resume/payment-method/refund behavior as applicable), customer-facing invoice/receipt/business identity review, approved Terms/Privacy/refund/cancellation disclosures, support readiness, and explicit owner approval before any live billing mutation or charge.

### Recovery / durability

- #875 adds a read-only production data-protection verifier for durable account/subscription, API-key, customer-auth/TOTP, and subscription-webhook replay tables.
- The verifier requires ACTIVE tables, server-side encryption, PITR enabled, and a valid DynamoDB restorable window.
- The repository includes owner-gated recovery guidance and regression coverage proving the verifier contains no restore/deploy/update mutation path.

A real production restore or table replacement remains owner/protected approved. Repository verification does not prove that a restore drill has been executed successfully in production.

### Launch reconciliation and current-main security review

- #876 reconciles the repository-safe launch checkpoint after the Self-Driving, Codex/Claude, billing, and recovery proofs while keeping live production/provider/billing/publication authority explicitly gated.
- #877 records and fixes one validated current-main rendering-boundary issue: inline JSON-LD now uses a dedicated serializer that escapes HTML/script-significant characters, preserves JSON semantics, and is covered by a hostile `</script>` regression in the enforced SEO CI lane.
- `docs/security-review-2026-09-13.md` is sanitized repository evidence for that reviewed finding. It is not a whole-product security certification or proof of deployed production controls.

## Remaining repository-safe completion lane

The next repository-safe work should focus on the items that do not require live credentials or production mutation:

1. monitoring, incident-response, and disable-path truth with deterministic tests or read-only verification where repository evidence can support it;
2. reconciliation of README, ROADMAP, active handoff, project-completion plan, public maturity/status copy, and Issue #113 against the current repository authority ladder;
3. final release regeneration/publication controls and supported-platform evidence, while keeping actual publication owner-gated;
4. customer/legal decision checklists only—do not invent legal commitments;
5. additional current-main trust-boundary review where concrete findings can be validated and fixed independently;
6. final project-completion report only after every repository-safe item is either complete or explicitly blocked by an owner/external decision.

## Owner/external gates that remain intentionally open

The following must not be inferred from green CI or repository merges:

- first live PostHog canary (#833), including current project/scope verification, production credential source, deployed kill switch, and fresh owner authorization;
- live Stripe resource/webhook verification, billing enablement, charge/refund, or real-customer billing canary;
- production deployments or AWS/IAM/KMS/CloudFormation/DNS/Cloudflare/Admin mutations;
- customer-account TOTP enrollment/login/backup-code canary or future TOTP infrastructure mutation;
- paid-priority queue/provider activation or customer source execution;
- marketplace/release publication;
- legal/business approval of Terms, Privacy, refund/cancellation, invoices/receipts, support, and retention commitments;
- Solve Runner/Solblend provisioning, pricing, registration, or rollout.

## Merge discipline

Every further repository PR must use the exact proposed head, applicable green CI/security lanes, clean mergeability, resolved blocking review threads, and expected-head protection. Missing, queued, stale, skipped, cancelled, or unobserved checks are not success.
