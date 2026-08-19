# SolveLang repository truth — post protected merges — 2026-08-19

This repository-state checkpoint corrects older 2026-08-19 planning and handoff text that still describes pull requests #161, #164, and #169 as open or awaiting merge approval.

For repository state, this document supersedes only those stale protected-PR statements. The production-facing facts in `docs/current-production-status-2026-08-19.md` remain authoritative unless explicitly updated by later live verification.

## Repository checkpoint

At this checkpoint, `main` is:

`27b143d1a7b547e9337b1b1b1a0a3055c82ab93c`

The protected repository preparation sequence completed in this order:

1. #161 — `fix(prod): preserve Admin CRM through auth rollbacks` — merged as `fdc68a0b7aea9aecb1d6921e3c258df3d53c74f9`.
2. #164 — `feat(priority): add validation-only production preflight` — refreshed onto the post-#161 `main`, revalidated, and merged as `16d04e32f7b1be18bf7f887a320bfcc716d32c13`.
3. #169 — `ops(priority): prepare dormant production queue foundation rollout` — rebuilt as one clean commit from the reviewed eight-file payload on the post-#164 `main`, revalidated, and merged as `27b143d1a7b547e9337b1b1b1a0a3055c82ab93c`.

Immediately after #169 merged, the open pull-request queue was zero.

## What these merges changed

The repository now contains:

- explicit Admin CRM state preservation through shared production rollback;
- a protected validation-only production customer-priority preflight;
- the dormant customer-priority jobs-table/source-bucket/SQS/DLQ/alarm foundation template and guarded deployment workflow;
- attempt-aware production deployment serialization used by the dormant foundation rollout;
- regression coverage and production runbooks for those contracts.

## What these merges did not authorize or perform

Merging repository preparation is not production activation.

No action in the #161 → #164 → #169 merge sequence authorized or performed:

- deployment of the customer-priority production foundation;
- queue-worker activation;
- customer-priority exposure;
- provider execution;
- customer source upload or execution;
- customer credit consumption;
- subscription billing activation;
- Stripe live activity, webhook enablement, charge, or refund;
- email sending;
- production customer or CRM mutation;
- TOTP/KMS production rollout.

The #169 production workflow continues to force `PriorityQueueEnabled=false`, `CustomerPriorityEnabled=false`, and `ProviderExecutionEnabled=false` during the dormant-foundation deployment stage.

## Production boundaries carried forward

The latest production-status record continues to state:

- API access: enabled;
- customer accounts and password authentication: enabled;
- Admin CRM backend: enabled;
- private Admin Gateway/origin: live;
- subscription billing: disabled;
- authenticator-app TOTP production rollout: incomplete / disabled;
- paid customer priority: disabled;
- real-charge authorization: none;
- general managed hosted SolveLang workflow execution: not live;
- Repository Audit remediation/write mode: disabled;
- Server Audit remediation/mutation mode: disabled.

These are carried forward repository references, not a new live production re-audit.

## Next safe build order

With the protected merge backlog cleared, safe repository-only work can continue in parallel while production gates remain closed:

1. Repository Audit bounded evidence/query/browser/MCP quality;
2. Solve Graph bounded path/reference/impact intelligence;
3. Server Audit read-only relationship and posture quality;
4. language/runtime and developer-experience building blocks;
5. security, rollback, least-privilege, operations, and truth-document maintenance.

Any future production deployment, IAM/KMS mutation, DNS/private-ingress change, Admin publication/update, credential rotation, TOTP activation, customer-priority activation, provider use, billing/Stripe activity, email, charge/refund, or production customer/CRM mutation remains a fresh separately scoped production action.
