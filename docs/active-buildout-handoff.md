# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

This file records repository state, not a newer production audit. Before acting, re-read current `main`, open PR heads, hosted/self-hosted CI, review threads, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `f0cb25c08a5ab3997f2f123380a023f1315bbfef`.
- PR #189 is merged: the durable handoff was synchronized after the canonical Repository Audit evidence/Mac-CI step.
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

The protected backlog branches below are refreshed on current `main`. Re-read each exact head and CI before an approved merge. Do not dispatch their production workflows from automation.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`.
- Current head: `2bce364a615935b7aea3d9df4f8ad84a01d96214`.
- Diff: four files, one build-only production-safety commit on current `main`.
- Preserves and verifies `AdminCrmEnabled` during shared production customer-account/TOTP rollback while billing remains OFF.
- Merge gate: `APPROVE PR #161 MERGE`.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`.
- Current head: `e621b02fa155f4afd07b5b8b36bb66d88beb8a79`.
- Diff: three files on current `main`.
- Adds a protected validation/preflight path only; queue/customer/provider launch gates and billing remain OFF.
- Merge gate: `APPROVE PR #164 MERGE`.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`.
- Current head: `499e52c0f266f3e6fac116fd8dfb83e81904f248`.
- Diff: eight files on current `main`.
- Adds durable jobs/source/SQS/DLQ/alarm foundation preparation while queue/customer/provider gates are forced OFF.
- Merge gate: `APPROVE PR #169 MERGE`.

Merging any of these PRs would still not authorize workflow dispatch, IAM application, queue activation, provider execution, billing, email, or charges.

## Active safe Repository Audit / Solve Graph buildout

PR #188 remains the active Python graph step on branch `agent/mac-solve-graph-python-imports`, current head `bcaedc164f31ceb18a80300ddbb05dce2bfc5bc0` at this sync.

It adds deterministic lexical Python import relationships for `.py` and `.pyi`, resolves repository-local modules/packages only, composes them with the existing JavaScript/TypeScript graph, and feeds the combined graph into Repository Audit impact analysis. It does not execute repository code and deliberately does not invent external Python package dependency nodes. Existing node/edge/evidence bounds remain authoritative.

Exact-head hosted CI/Rust have passed for the refreshed branch. The trusted Mac job targets `[self-hosted, macOS, ARM64]` and is still queued. Do not claim Mac validation or merge solely on the basis of the queued run; if it remains queued, continue independent safe work.

After Python import relationships, continue deterministic Repository Audit intelligence where evidence is reliable: dependency consistency, additional bounded/non-executing language relationships, conservative dead-code candidates, and test/documentation/workflow coverage mapping.

## Trusted Mac runner path

`.github/workflows/trusted-mac-ci.yml` is merged on `main` and runs only on pushes to `agent/mac-*` branches. It targets `[self-hosted, macOS, ARM64]`, has read-only repository permissions, and runs deterministic Studio/audit tests, lint, static build, and i18n export verification.

GitHub runner-inventory API access is unavailable to the current connector, so runner online/idle state cannot be inferred from inventory. A queued Mac job means only that GitHub has not assigned it yet; do not guess why. Never substitute a Windows runner for this trusted Mac path unless a separately existing Windows-specific workflow is explicitly required for cross-platform validation.

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

## Server Audit current state and next stages

Server Audit is no longer just a roadmap stub. Current `main` contains a browser-local Server Audit surface and deterministic core modules for snapshot parsing, analysis, types, and report generation. Existing analysis already treats uploaded snapshot data as read-only input and reports high-signal posture findings without remediation execution.

Two safe hardening PRs are active:

- PR #190, branch `agent/mac-server-audit-command-surface-contract`, head `d486a8a7e533018c70d7c92252fcbe056919ddc7`: pins the reviewed read-only collector executable surface and rejects dynamic/shell execution primitives. Hosted validation is green; trusted Mac validation remains queued.
- PR #191, branch `agent/mac-server-audit-snapshot-invariants`, head `22fb946280d03a31795c80f49bb732b214563f94`: rejects impossible memory/filesystem capacity relationships before analysis and adds focused parser regression tests. Hosted deterministic Studio/preflight tests and lint are already passing while remaining exact-head workflows finish; trusted Mac validation is queued.

Continue Server Audit read-only-first after these hardening steps with evidence-backed improvements rather than duplicating already-implemented parser/analyzer/report work. Useful next increments include stricter timestamp/inventory consistency, bounded collector evidence, package/service/version posture, web/TLS/public-file checks, redaction guarantees, and deterministic report coverage. Do not add mutation/remediation execution without individual approval gates, backup requirements, and rollback design.

## Language/runtime and product hardening

Imported-file source provenance is already merged. Continue independent safe work after higher-priority audit/security tasks: formatter/linter, stronger semantic/type checks, module/package design, diagnostics, editor support, and deterministic tests.

Authenticator TOTP implementation and rollout preparation exist in code, but production enablement remains separately gated. Customer-priority foundations exist in code, but paid customer priority remains OFF. Billing/Checkout/webhook/management code exists, but production billing remains OFF. Safe work may continue on replay/idempotency, subscription lifecycle correctness, queue retries/DLQs/leases, provider isolation, and preflight preparation.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, and rebuild stale PRs without overwriting newer work.

Do not automatically apply live AWS/IAM/KMS changes, deploy production, configure DNS/private ingress, publish the production Admin UI, enable TOTP/paid priority/billing, use Stripe live, charge, send email, mutate production customer/CRM data, or merge an explicitly production-sensitive PR without its exact approval phrase.

If a production gate or queued trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
