# SolveLang Active Buildout Handoff

**Purpose:** durable cross-chat execution state for the approved SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  
**Major live gates remain separate:** production-sensitive merges where explicitly gated, AWS/IAM/KMS mutation, production workflow dispatch, deployment, DNS/private ingress, Admin console publication, email canaries, Stripe/billing enablement, and any real charge.

This document records repository/build truth only. It must not be used to infer a newer live production state than the last separately verified production record. Before acting, re-read current `main`, PR heads, hosted CI, review threads, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `49d9b08f871f973e9b00378612eae06463adceb9`.
- PR #181 is merged: bounded Repository Audit inventory + Solve Graph + HMAC-redacted secret-analysis pipeline.
- PR #183 is merged: product/HTML exports can include bounded graph counts/hotspots and redacted credential warnings while excluding keyed HMAC correlation fingerprints.
- PR #184 is merged: canonical reports retain inventory-only schema `1.0.0` and add an integrity-covered `1.1.0` shape when bounded graph/security intelligence is supplied.
- Centralized account suspension/termination foundations are merged through PR #147.
- Admin Gateway rollout machinery is merged through PR #168.
- Deterministic private Admin console publication preparation is merged through PR #172.
- Solve Graph capabilities are merged through PRs #171 and #173-#179: canonical graph contracts, deterministic inventory extraction, dependency/dependent traversal, blast-radius analysis, lexical JS/TS import relationships, bounded tool contracts, MCP/Codex integration, a local integrity-verified explorer, and Repository Audit reuse.
- Repository Audit is now an implemented read-only scanner path, not merely a planned schema: archive extraction/ingestion, inventory/classification, duplicate/backup/generated/large-file findings, dependency/reference analysis, redacted secret warnings, canonical integrity, product reports, composed graph/security analysis, and graph/security export are present.

## Last separately verified production truth

Until a newer live audit is performed, retain the production claims in `docs/current-production-status-2026-08-13.md`:

- API access: enabled;
- customer accounts/password authentication: enabled;
- ordinary password login sends no email;
- authenticator-app TOTP production feature: disabled;
- subscription billing: disabled;
- paid customer priority: disabled;
- real charge authorization: none.

Merged code or deployment workflows are not evidence that a production feature is enabled.

## Admin console / private gateway

PR #168 provides the protected manual Admin Gateway production rollout machinery, exact-stack deploy-role policy supplement, serialization, state-preserving rollback, termination protection, and post-deploy session verification. PR #172 provides the deterministic static Admin console release builder, CSP/noindex/public-secret checks, CI artifact generation, and private publication runbook.

The next Admin action is live IAM and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later gates remain separate for the gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canary. Never publish the Admin UI on the public customer origin as a shortcut.

## Production-sensitive PRs awaiting explicit merge approval

These PRs remain build/test preparation only. Refresh against current `main` before any approved merge if `main` advances.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`.
- Last verified head: `7ed31ea332a16a3280dae1e7c067b4d18ddeb262`.
- Preserves and verifies `AdminCrmEnabled` during shared production customer-account/TOTP rollback while billing remains OFF.
- Previous exact-head API Access CI, general CI, and Rust/RustSec passed; refresh and retest before merge because `main` has advanced.
- Merge gate: `APPROVE PR #161 MERGE`.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`.
- Last verified head: `8831f0d9525a75decb2b56350746c17e3e7ca84f`.
- Adds a protected validation/preflight path only; queue/customer/provider launch gates and billing remain OFF.
- Previous Customer Priority Production CI, API Access CI, general CI, and Rust/RustSec passed; refresh and retest before merge because `main` has advanced.
- Merge gate: `APPROVE PR #164 MERGE`.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`.
- Last verified head: `8fdf39f6b2ac083b36b33cabcf8a6c18597e8419`.
- Adds durable jobs/source/SQS/DLQ/alarm foundation preparation while queue/customer/provider gates are forced OFF.
- Previous foundation, API Access, general CI, and Rust/RustSec passed; refresh and retest before merge because `main` has advanced.
- Merge gate: `APPROVE PR #169 MERGE`.

Merging any of these PRs still would not authorize workflow dispatch, IAM application, queue activation, billing, provider execution, email, or charges.

## Active safe Repository Audit buildout

PR #185 is the active browser-local integration step on branch `agent/repository-audit-browser-intelligence`, refreshed onto `49d9b08f871f973e9b00378612eae06463adceb9` at head `d2e3614ef92d78634715eafc0ca12c53b0ba00d5`. It switches the local archive flow from inventory-only analysis to the composed bounded pipeline, passes full graph/security intelligence into the product report, and surfaces dependency hotspots plus redacted credential-pattern warnings without rendering raw secret values or HMAC correlation fingerprints. It changes only `site/app/repository-audit/RepositoryAuditApp.tsx`. Do not merge until exact-head CI and Rust/RustSec finish green and review threads are clean.

After #185, the next safe audit step is to expose the versioned canonical `1.1.0` evidence artifact from the browser/product flow, preserving integrity verification and deterministic ordering, then continue richer deterministic dependency/reference intelligence where evidence is reliable.

## Solve Graph current state

Merged capabilities:

1. canonical `solvelang.graph.v0` contracts, stable IDs, canonical serialization, integrity digest, bounded scan semantics;
2. deterministic repository/directory/file inventory extraction;
3. integrity-gated node queries plus bounded dependency/dependent traversal and blast-radius analysis;
4. lexical JavaScript/TypeScript import extraction without repository execution;
5. bounded MCP-ready tool contracts;
6. local MCP/Codex integration for graph queries;
7. browser-local integrity-verified graph explorer;
8. Repository Audit hotspot/impact reuse.

Keep repository execution, package execution, network acquisition, and remediation separate from analyze-only graph construction.

## Account/security, priority, and billing boundaries

PR #147 merged centralized `active` / `suspended` / `terminated` state enforcement, auth-version invalidation, API-key/quota enforcement, protected admin access-state endpoints, and customer-owned priority verification hooks. Merge state does not prove deployment state.

Authenticator TOTP implementation and rollout preparation exist in code, but production enablement remains separately gated. Customer-priority source/upload/API/worker foundations exist in code, but paid customer priority remains OFF. Billing/Checkout/webhook/management code exists, but production billing remains OFF. Continue only safe hardening: queue/provider reliability, idempotency, DLQ/retry/lease behavior, TOTP readiness, webhook replay handling, subscription lifecycle correctness, payment-method ownership, and preflight preparation.

## Server Audit and language/runtime next work

Server Audit remains read-only-first: constrained collector, explicit command allowlist, OS/package/service/port/process/scheduled-job inventory, disk/log/cache/backup posture, web/domain/SSL/public-file checks, permission/version findings, redacted evidence, bounded execution, and deterministic reports. No live remediation without individual approval.

Imported-file source provenance is already merged. Continue independent language/runtime correctness after higher-priority safe work: formatter/linter, stronger semantic/type checks, module/package design, and diagnostics, all with deterministic tests and no network/package execution in analysis paths.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, and rebuild stale PRs without overwriting newer work.

Do not automatically apply live AWS/IAM/KMS changes, deploy production, configure DNS/private ingress, publish the production Admin UI, enable TOTP/paid priority/billing, use Stripe live, charge, send email, mutate production customer/CRM data, or merge an explicitly production-sensitive PR without its exact approval phrase.

If a production gate blocks one track, record the exact approval phrase and continue another safe engineering task rather than idling.
