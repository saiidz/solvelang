# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

This file records repository state, not a newer production audit. Before acting, re-read current `main`, open PR heads, hosted/self-hosted CI, review threads, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `3d1257d5123a53e8d3aa3015c2b4dcc1c7b2eeb8`.
- PR #185 is merged: the browser-local Repository Audit now surfaces bounded dependency/blast-radius hotspots and redacted credential-pattern warnings.
- PR #184 is merged: canonical Repository Audit reports use schema `1.1.0` when graph/security intelligence is present, with integrity-covered canonical serialization.
- PR #183 is merged: product/HTML reports export bounded graph intelligence and redacted credential warnings without keyed HMAC correlation fingerprints.
- PR #181 is merged: bounded Repository Audit inventory + Solve Graph + secret-analysis composition.
- Solve Graph capabilities are merged through PRs #171 and #173-#179: deterministic inventory, dependency/dependent traversal, impact analysis, lexical JS/TS import relationships, bounded tools, MCP/Codex integration, local explorer, and Repository Audit reuse.
- Centralized account suspension/termination foundations are merged through PR #147.
- Imported-file source provenance is merged through PR #159.
- Customer-priority production-off source/upload/API foundations are merged through PRs #160, #165, and #166.
- Admin Gateway rollout machinery is merged through PR #168; deterministic private Admin console publication preparation is merged through PR #172.

## Last separately verified production truth

Until a newer live audit is performed, retain the facts in `docs/current-production-status-2026-08-13.md`:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP production feature: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

Merged code or rollout workflows are not evidence that a production feature is enabled.

## Admin console / private gateway

PR #168 provides the protected manual Admin Gateway production rollout machinery, exact-stack deploy-role policy supplement, production serialization, state-preserving rollback, termination protection, and post-deploy session verification. PR #172 provides the deterministic static Admin console release builder, CSP/noindex/public-secret checks, CI artifact generation, and private publication runbook.

All safe repository preparation for the current Admin Gateway step is complete. The next action is live IAM and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later gates remain separate for gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canary. Never publish the Admin UI on the public customer origin as a shortcut.

## Production-sensitive PRs awaiting explicit merge approval

These remain build/test preparation only. Refresh against current `main` before an approved merge whenever `main` has advanced.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`.
- Last known head before this sync: `7ed31ea332a16a3280dae1e7c067b4d18ddeb262`.
- Preserves and verifies `AdminCrmEnabled` during shared production customer-account/TOTP rollback while billing remains OFF.
- It is currently behind newer `main` and requires refresh/retest before merge.
- Merge gate: `APPROVE PR #161 MERGE`.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`.
- Adds a protected validation/preflight path only; queue/customer/provider launch gates and billing remain OFF.
- Refresh/retest against current `main` before merge.
- Merge gate: `APPROVE PR #164 MERGE`.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`.
- Adds durable jobs/source/SQS/DLQ/alarm foundation preparation while queue/customer/provider gates are forced OFF.
- Refresh/retest against current `main` before merge.
- Merge gate: `APPROVE PR #169 MERGE`.

Merging any of these PRs would still not authorize workflow dispatch, IAM application, queue activation, provider execution, billing, email, or charges.

## Active safe Repository Audit buildout

PR #186 is the active browser evidence step on branch `agent/mac-repository-audit-canonical-export`. It adds a browser-local canonical `1.1.0` JSON evidence artifact with report ID and integrity SHA-256, while retaining product JSON and HTML reports. Secret values and keyed HMAC correlation fingerprints remain excluded from portable reports.

PR #186 also introduces a trusted push-only Mac CI path for `agent/mac-*` branches using `[self-hosted, macOS, ARM64]`; it does not expose the self-hosted runner to arbitrary pull-request code and does not target Windows.

Do not merge #186 until its exact current head is green in hosted CI/Rust and review threads are clean. Prefer a successful Mac validation as well; if the Mac job remains queued, record that fact rather than claiming it ran.

After the canonical browser evidence step, continue deterministic Repository Audit v1 intelligence where evidence is reliable: reference/import graphs beyond the existing lexical JS/TS subset, dependency consistency, dead-code candidates with conservative confidence, and test/documentation coverage mapping. Keep all analysis bounded and non-executing.

## Solve Graph current state

Merged capabilities include:

1. canonical `solvelang.graph.v0` contracts, stable IDs, serialization, integrity digest, and bounded scan semantics;
2. deterministic repository/directory/file extraction;
3. integrity-gated node queries and bounded dependency/dependent traversal;
4. blast-radius/impact analysis;
5. lexical JavaScript/TypeScript import extraction without executing repository code;
6. bounded MCP-ready query tools;
7. local MCP/Codex integration;
8. browser-local integrity-verified visual explorer;
9. Repository Audit hotspot/impact reuse.

Keep repository execution, package execution, network acquisition, and remediation separate from analyze-only graph construction.

## Server Audit next stages

Server Audit remains read-only-first. Build in isolated stages:

- constrained collector with explicit command allowlist;
- OS/package/service/port/process/scheduled-job inventory;
- disk/log/cache/backup posture;
- web roots/domains/SSL/public-file checks;
- ownership/permission/version findings;
- redacted bounded evidence bundle;
- deterministic JSON/HTML reports.

Do not add mutation/remediation execution without individual approval gates, backup requirements, and rollback design.

## Language/runtime and product hardening

Imported-file source provenance is already merged. Continue independent safe work after higher-priority audit/security tasks: formatter/linter, stronger semantic/type checks, module/package design, diagnostics, and deterministic tests.

Authenticator TOTP implementation and rollout preparation exist in code, but production enablement remains separately gated. Customer-priority foundations exist in code, but paid customer priority remains OFF. Billing/Checkout/webhook/management code exists, but production billing remains OFF. Safe work may continue on replay/idempotency, subscription lifecycle correctness, queue retries/DLQs/leases, provider isolation, and preflight preparation.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, and rebuild stale PRs without overwriting newer work.

Do not automatically apply live AWS/IAM/KMS changes, deploy production, configure DNS/private ingress, publish the production Admin UI, enable TOTP/paid priority/billing, use Stripe live, charge, send email, mutate production customer/CRM data, or merge an explicitly production-sensitive PR without its exact approval phrase.

If a production gate blocks one track, record the exact approval phrase and continue another safe engineering task instead of idling.
