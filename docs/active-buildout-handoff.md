# SolveLang Active Buildout Handoff

**Purpose:** durable cross-chat execution state for the approved SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  
**Major live gates remain separate:** production merge where explicitly gated, AWS/IAM/KMS mutation, production preflight dispatch, production deployment, DNS/private ingress, Admin console publication, email canary, Stripe/billing enablement, and any real charge.

This file records repository/build truth. It must not be used to infer a newer live production state than the last separately verified production record. Re-read current GitHub `main`, PR heads, hosted CI, review threads, and the current production-status document before acting.

## Current repository baseline

- `main` at the time of this sync: `668187aa8079d4c5610783aac47d80fca94fb759`.
- That commit merged PR #179, Repository Audit reuse of Solve Graph impact intelligence.
- Centralized account suspension/termination foundation is merged through PR #147.
- Admin Gateway rollout machinery is merged through PR #168.
- Deterministic private Admin console publication preparation is merged through PR #172.
- Solve Graph has progressed well beyond Phase 0: deterministic inventory extraction, query/impact analysis, JavaScript/TypeScript import relationships, bounded tool contracts, MCP/Codex integration, and a local integrity-verified explorer are merged through PRs #171, #173-#178.
- Repository Audit already contains bounded archive ingestion/extraction, deterministic inventory/classification, exact duplicate/backup/generated/large-file findings, reference/dependency analysis, HMAC-redacted secret warnings, canonical report integrity, HTML/JSON product reports, and Solve Graph impact reuse. Older text saying the scanner engine is not implemented is stale.

## Last separately verified production truth

The last repository production-status record is `docs/current-production-status-2026-08-13.md`. Until a newer live audit is performed, retain its production claims:

- API access: enabled;
- customer accounts/password authentication: enabled;
- ordinary password login sends no email;
- authenticator-app TOTP production feature: disabled;
- subscription billing: disabled;
- paid customer priority: disabled;
- real charge authorization: none.

Merged code, deployment workflows, or IAM policy files are not evidence that a production feature is enabled.

## Admin console / private gateway

### Merged safe preparation

PR #168 provides the protected manual Admin Gateway production rollout machinery, exact-stack deploy-role policy supplement, serialization, rollback/state preservation, termination protection, and post-deploy session verification.

PR #172 provides the deterministic static Admin console release builder, CSP/noindex/public-secret contract tests, CI artifact generation, and private publication runbook.

### Remaining live gates

The next Admin action is a live IAM change and therefore remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

After a separately verified IAM apply, later gates remain separate for the Admin Gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canary. Do not publish the Admin UI on a public customer origin as a shortcut.

## Production-sensitive PRs currently awaiting explicit merge approval

These branches are build/test preparation only. Refresh against current `main` before merge if `main` advances.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`.
- Refreshed head at this sync: `7ed31ea332a16a3280dae1e7c067b4d18ddeb262`.
- Preserves and verifies `AdminCrmEnabled` during shared production customer-account/TOTP rollback while billing remains OFF.
- Fresh exact-head API Access CI, general CI, and Rust/RustSec passed before this handoff update.
- Merge gate: `APPROVE PR #161 MERGE`.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`.
- Refreshed head at this sync: `8831f0d9525a75decb2b56350746c17e3e7ca84f`.
- Adds only a protected validation/preflight path; queue/customer/provider launch gates remain OFF and billing remains OFF.
- Fresh Customer Priority Production CI, API Access CI, general CI, and Rust/RustSec passed before this handoff update.
- Merge gate: `APPROVE PR #164 MERGE`.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`.
- Refreshed head at this sync: `8fdf39f6b2ac083b36b33cabcf8a6c18597e8419`.
- Adds a durable jobs/source/SQS/DLQ/alarm foundation and protected future rollout workflow while queue/customer/provider gates are forced OFF.
- Fresh Customer Priority Foundation Rollout CI, API Access CI, general CI, and Rust/RustSec passed before this handoff update.
- Merge gate: `APPROVE PR #169 MERGE`.

Merging these PRs still does not authorize workflow dispatch, IAM application, queue activation, billing, provider execution, email, or charges.

## Active safe Repository Audit buildout

PR #180 introduced a bounded Repository Audit graph pipeline that composes deterministic repository inventory/import extraction with Solve Graph impact intelligence.

PR #181 supersedes that work with a broader combined analysis pipeline on `main`. It composes inventory, bounded Solve Graph dependency/impact analysis, and HMAC-redacted secret scanning. Secondary secret scanning is restricted to files accepted by the bounded graph scan so it cannot silently bypass graph file/byte/depth limits. It remains analyze-only with network/write access false and exposes no raw secret values.

At handoff update time, #181 hosted exact-head CI was still running. Do not merge it until its final exact-head general CI and Rust/RustSec checks are green and review threads are clean.

## Solve Graph current state

Merged capabilities now include:

1. canonical `solvelang.graph.v0` contracts, stable IDs, canonical serialization, integrity digest, bounded scan semantics;
2. deterministic repository/directory/file inventory extraction;
3. integrity-gated node queries plus bounded dependency/dependent traversal and blast-radius analysis;
4. lexical JavaScript/TypeScript import extraction without repository execution;
5. bounded MCP-ready tool contracts;
6. local MCP/Codex integration for graph queries;
7. browser-local integrity-verified graph explorer;
8. Repository Audit graph hotspot/impact reuse.

Next safe direction is deeper Repository Audit composition and product/report integration, followed by richer deterministic relationships where evidence is strong. Keep repository execution, package execution, network acquisition, and remediation separate from analyze-only graph construction.

## Account/security state

PR #147 merged centralized `active` / `suspended` / `terminated` account-state enforcement, auth-version invalidation, API-key/quota enforcement, protected admin access-state endpoints, and customer-owned priority verification hooks. Merge status does not prove a production deployment of newer account-state code; verify live stack state before making that claim.

Authenticator TOTP implementation and rollout preparation exist in the repository, but production enablement remains separately gated. Do not infer TOTP/KMS live state from merged code.

## Customer priority

Customer-priority source storage/upload, same-host API attachment, worker foundations, entitlement/account checks, and production-off rollout preparation exist in code. Customer paid priority remains OFF unless a separately verified production rollout explicitly changes that state.

Safe build work may continue on queue/provider reliability, idempotency, DLQ/retry/lease behavior, preflight validation, and operations tests while every launch gate remains OFF.

## Billing

Billing/Checkout/webhook/management code exists, but production billing remains OFF in the last verified production record. Continue safe hardening only: webhook idempotency/replay handling, subscription lifecycle correctness, payment-method ownership, upgrade/downgrade/cancellation behavior, and production preflight preparation. Any live Stripe configuration, billing activation, or real-charge canary remains separately approved.

## Repository Audit next work

Continue read-only-first development in this order:

1. finish and verify the combined inventory + Solve Graph + redacted-secret analysis pipeline;
2. integrate bounded graph hotspots/impact and redacted secret warnings into browser-local product output without exposing raw values;
3. preserve canonical report integrity and deterministic ordering when graph intelligence is added to a versioned report contract;
4. expand deterministic code/dependency/reference intelligence where evidence is reliable;
5. keep remediation/write mode separate, branch-based, reversible, and human-approved.

## Server Audit next work

Server Audit remains read-only-first. Continue the constrained collector, explicit command allowlist, OS/package/service/port/process/scheduled-job inventory, disk/log/cache/backup posture, web/domain/SSL/public-file checks, permission/version findings, redacted evidence, bounded execution, and deterministic reports. No live remediation without individual approval.

## Language/runtime and DX

Continue independent correctness work after higher-priority safe build items, including imported-file source provenance, formatter/linter work, stronger semantic/type checks, module/package design, and diagnostics. Preserve deterministic tests and do not introduce network/package execution into analysis paths.

## Safety boundary for continuing work

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, and rebuild stale PRs without overwriting newer work.

Do not automatically:

- apply live AWS/IAM/KMS changes;
- deploy production stacks;
- configure DNS/private ingress;
- publish the production Admin UI;
- enable TOTP, paid customer priority, or billing;
- use Stripe for live activity or perform a charge;
- send email;
- mutate production customer/CRM data;
- merge a production-sensitive PR whose exact merge is separately gated.

If a production gate blocks one track, record the exact approval phrase and continue the next safe unblocked engineering task instead of idling.
