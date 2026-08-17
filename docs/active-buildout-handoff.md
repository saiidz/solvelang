# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17

This file records repository state, not a newer production audit. Before acting, re-read current `main`, open PR heads, hosted/self-hosted CI, review threads, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `d171f8bcc699dd6e35db84bc489ceb569cbe4406`.
- PR #201 is merged: Server Audit now detects conflicting duplicate package, service, filesystem, and web-root inventory evidence with bounded structural/redacted findings.
- PR #198 is merged: Server Audit has deterministic read-only temporal consistency analysis for certificate/log timestamps with bounded redacted evidence.
- PR #199 is merged: temporal consistency issues are composed into canonical Server Audit findings/reports with deterministic IDs and structural/redacted evidence.
- PR #192 is merged: ROADMAP/buildout truth was synchronized after the earlier Repository Audit and Server Audit hardening work.
- PR #186 is merged: Repository Audit browser-local product JSON, printable HTML, canonical integrity-covered evidence export, and the trusted push-only Mac CI workflow are on `main`.
- Solve Graph capabilities merged before this sync include deterministic inventory, dependency/dependent traversal, impact analysis, JavaScript/TypeScript lexical import relationships, bounded tools, MCP/Codex integration, local explorer, and Repository Audit reuse.
- Centralized account suspension/termination foundations are merged through #147.
- Imported-file source provenance is merged through #159.
- Customer-priority production-OFF source/upload/API foundations are merged through #160/#165/#166.
- Admin Gateway rollout machinery is merged through #168; deterministic private Admin console publication preparation is merged through #172.

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

All safe repository preparation for the current Admin Gateway step is complete. The next action is live IAM and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canary gates remain separate. Never publish the Admin UI on the public customer origin as a shortcut.

## Production-sensitive PRs awaiting exact owner approval

These PRs are build-only preparation and remain intentionally unmerged. `main` has advanced since their latest refreshes, so replay each safely onto the then-current `main` before any approved merge and rerun exact-head CI.

- **#161** `fix(prod): preserve Admin CRM through auth rollbacks`, head `00391a5305de3b83edb2fbd80bcbcf40db1e0476` — gate: `APPROVE PR #161 MERGE`.
- **#164** `feat(priority): add validation-only production preflight`, head `c528ad496f52200bf84e47fa84abe510f71ccf55` — gate: `APPROVE PR #164 MERGE`.
- **#169** `ops(priority): prepare dormant production queue foundation rollout`, head `0b97431e796e68d50c471fab0b0e4a399f6946ce` — gate: `APPROVE PR #169 MERGE`.

Merging any of these PRs would still not authorize workflow dispatch, IAM application, queue activation, provider execution, billing, email, or charges.

## Active safe Solve Graph / Repository Audit work

The active non-production backlog is intentionally split into isolated PRs so work can continue while trusted Mac validation is unavailable:

- **#188** — deterministic repository-local Python import relationships and multi-language graph composition. Exact-head GitHub-hosted CI/Rust passed at `b553db72f22cba9fd40dd9e5b4c368e90853c95a`; Trusted Mac run #17 remains pending. Reconcile on current `main` before merge and do not bypass that Mac gate.
- **#193** — bounded dependency declaration consistency analysis.
- **#194** — bounded direct test/import and documentation-link evidence mapping.
- **#195** — conservative dead-code candidates that suppress on incomplete graph/import evidence.
- **#196** — bounded package/workflow configuration-reference evidence.
- **#197** — bounded GitHub Actions working-directory/cache-dependency-path evidence and reverse workflow impact mapping.

All of these are analyze-only. Keep graph construction deterministic and bounded; do not execute repository code, package hooks, workflows, or remediation during graph/audit construction.

After these land, compose the new evidence stages into canonical/product Repository Audit reporting and browser surfaces, then continue affected-tests/workflows mapping, architecture/security path summaries, MCP/Codex quality, and local visual explorer improvements.

## Trusted Mac runner path

`.github/workflows/trusted-mac-ci.yml` runs only on pushes to trusted `agent/mac-*` branches and targets `[self-hosted, macOS, ARM64]` with read-only repository permissions.

Runner inventory is not exposed by the current connector. Infer only from GitHub Actions run/job metadata. The current #188 exact-head Mac run is still pending; do not interrupt queued/running jobs, rewrite runner registration, weaken branch trust, or route trusted Mac work to Windows merely to bypass queueing.

No repository workflow targeting an existing Windows self-hosted runner was identified during this sync. Do not invent Windows routing.

## Server Audit current state and next stages

Server Audit is a real read-only implementation on `main`, not a roadmap-only stub. Current merged code includes strict snapshot parsing, deterministic findings/report generation, browser-local analysis, constrained collector contracts, temporal consistency analysis/reporting (#198/#199), and bounded duplicate inventory consistency analysis (#201).

Active hardening:

- **#190** — pins the collector executable surface to the reviewed read-only allowlist and rejects dynamic/shell execution primitives; hosted validation is green, Trusted Mac remains queued.
- **#191** — rejects impossible memory/filesystem capacity relationships before analysis; hosted validation is green, Trusted Mac remains queued.

Continue Server Audit read-only-first with report composition for inventory consistency, package/service/version posture, bounded collector evidence, web/TLS/public-file checks, redaction guarantees, deterministic report coverage, and constrained collector/report cross-checks. Do not add remote mutation/remediation execution.

## Language/runtime and DX

Imported-file source provenance is already merged. After higher-priority audit/security work, continue formatter/linter, stronger semantic/type checks, `for` loops, stable module/package design, diagnostics, VS Code/editor support, deterministic golden tests, and cross-platform compatibility.

## Customer priority, TOTP, and billing

Safe build work may continue while all launch gates remain OFF:

- customer-priority queue/provider/executor foundations, retries/leases/DLQs, observability, source integrity, account/entitlement enforcement, and preflight;
- TOTP IAM/KMS/preflight/deployment validation and rollback/state-preservation tests;
- billing webhook replay/idempotency, subscription lifecycle, checkout ownership, upgrade/downgrade/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight.

Do not enable customer priority, TOTP, or billing; do not use live Stripe, consume production provider credits, send email, charge/refund, create live KMS resources, or mutate production customer/CRM data without exact separate owner approval.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, close/supersede duplicates with evidence, and merge non-production PRs only when exact-head checks are green, mergeable, and review-clean.

Never automatically live-apply AWS/IAM/KMS, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/priority/billing, use Stripe live, charge/refund, send email, mutate production customer/CRM data, execute uploaded customer source in production, or merge an explicitly production-sensitive PR without its exact approval phrase.

If one track is blocked by an approval or queued trusted-runner validation, record it and continue another safe engineering task instead of idling.
