# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

This file records repository state, not a newer production audit. Before acting, re-read current `main`, open PR heads, hosted/self-hosted CI, review threads, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `9f464238a42fceb7c878946a0ce97c4b5c8d5f39`.
- PR #186 is merged: the browser-local Repository Audit exports product JSON, printable HTML, and a versioned integrity-covered canonical JSON evidence artifact. It also added the trusted push-only Mac CI workflow for `agent/mac-*` branches.
- PRs #181, #183, #184, and #185 are merged: bounded inventory + Solve Graph + redacted secret analysis are composed into Repository Audit; product/canonical reports carry graph/security intelligence; the browser surfaces dependency/blast-radius hotspots and redacted credential-pattern warnings.
- Solve Graph capabilities are merged through PRs #171 and #173-#179: deterministic inventory, dependency/dependent traversal, impact analysis, lexical JavaScript/TypeScript import relationships, bounded tools, MCP/Codex integration, local explorer, and Repository Audit reuse.
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

All three protected backlog PRs below were replayed on `main` `9f464238a42fceb7c878946a0ce97c4b5c8d5f39` as one clean commit each on 2026-08-17. Re-read their exact-head hosted CI before any approved merge. Do not dispatch their production workflows from automation.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`.
- Current head: `c86077640ca54d178e3f8641a28ad4e233f14a80`.
- Diff: four files, one commit on current `main`.
- Preserves and verifies `AdminCrmEnabled` during shared production customer-account/TOTP rollback while billing remains OFF.
- Merge gate: `APPROVE PR #161 MERGE`.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`.
- Current head: `cabf7325226e62459db3c7bc94f4e0a4f62cdefd`.
- Diff: three files, one commit on current `main`.
- Adds a protected validation/preflight path only; queue/customer/provider launch gates and billing remain OFF.
- Merge gate: `APPROVE PR #164 MERGE`.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`.
- Current head: `101996dfdbdfd95a932f09c9ebca4e5c9a9312dc`.
- Diff: eight files, one commit on current `main`.
- Adds durable jobs/source/SQS/DLQ/alarm foundation preparation while queue/customer/provider gates are forced OFF.
- Merge gate: `APPROVE PR #169 MERGE`.

Merging any of these PRs would still not authorize workflow dispatch, IAM application, queue activation, provider execution, billing, email, or charges.

## Active safe Repository Audit / Solve Graph buildout

PR #188 is the active safe graph step on branch `agent/mac-solve-graph-python-imports`, head `3c75eeb6a34d3751689c1acf83677fb8682088cb` at this sync.

It adds deterministic lexical Python import relationships for `.py` and `.pyi`, resolves repository-local modules/packages only, composes them with the existing JavaScript/TypeScript graph, and feeds the combined graph into Repository Audit impact analysis. It does not execute repository code and deliberately does not invent external Python package dependency nodes. Existing node/edge/evidence bounds remain authoritative.

Exact-head hosted CI and Rust/RustSec passed for #188 before this handoff sync. The trusted Mac job targets `[self-hosted, macOS, ARM64]` and was still queued; do not claim Mac validation unless that exact-head job actually completes successfully. Windows runners are not part of this trusted workflow.

After Python import relationships, continue deterministic Repository Audit v1 intelligence where evidence is reliable: dependency consistency, additional language relationships where bounded/non-executing extraction is practical, dead-code candidates with conservative confidence, and test/documentation coverage mapping.

## Trusted Mac runner path

`.github/workflows/trusted-mac-ci.yml` is merged on `main` and runs only on pushes to `agent/mac-*` branches. It targets `[self-hosted, macOS, ARM64]`, has read-only repository permissions, and runs Repository Audit/Studio tests, lint, static build, and i18n export verification.

GitHub runner-inventory API access is unavailable to the current connector, so runner online/idle state cannot be inferred from inventory. A queued Mac job means only that GitHub has not assigned it yet; do not guess why. Never substitute a Windows runner for this trusted Mac path.

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

PR #188 extends the analyze-only dependency layer with bounded local Python import relationships. Keep repository execution, package execution, network acquisition, and remediation separate from graph construction.

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
