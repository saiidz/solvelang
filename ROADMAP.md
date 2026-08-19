# SolveLang Roadmap

SolveLang is an early language and workflow-analysis prototype written primarily in Rust, with a production customer-account/API/Admin foundation that is further along than the general managed-execution product.

This roadmap distinguishes four states deliberately:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically production-enabled, and production account/Admin infrastructure is not evidence that general hosted SolveLang workflow execution exists. Live GitHub state, `docs/active-buildout-handoff.md`, and `docs/current-production-status-2026-08-19.md` take precedence over stale hashes or historical planning text.

## Current implementation overlay — 2026-08-19

- Centralized account suspension/termination foundations are **merged in code** through PR #147. Production-sensitive follow-up remains separately gated.
- Imported-file source provenance is **merged** through PR #159.
- Admin Gateway deployment machinery (#168), private-ingress/publication preparation (#172/#321), and repository-only IAM/preflight corrections (#308/#312) are merged. Separately approved 2026-08-19 production work deployed the private Admin Gateway, Cloudflare Access/private ingress, static Admin UI, and rotated the Admin application password. Future live changes remain separately approval-gated; prior approval phrases are not reusable authorization.
- The RustSec `h2` advisory that blocked the safe merge train was remediated through PR #229; `h2` is on the fixed 0.4.16 line and Rust/RustSec CI remains mandatory.
- Repository Audit is **implemented well beyond a v0 contract**. The deterministic Python-import/dependency/coverage/dead-code/config/workflow train (#288 → #290 → #291 → #298 → #299 → #300 → #301) is merged and must not be recreated.
- Repository Audit affected-test/workflow mapping and report composition are merged through #311/#313/#314. Canonical baseline reports remain schema `1.0.0`; graph/intelligence reports use `1.1.0`; affected-validation reports use `1.2.0` with a separate strict intelligence schema.
- Repository Audit architecture/security-boundary path analysis and pipeline composition are merged through #317/#319, with a standalone deterministic integrity-covered architecture-path evidence artifact merged through #322 and browser/export presentation through #332.
- Solve Graph deterministic ranked node search is merged in the core and MCP surfaces through #329/#335, local visual-explorer modeling through #337, and conservative repository-local PHP include/require relationships through #341. These remain bounded and analyze-only.
- Repository-local TypeScript `extends` / project-reference evidence is merged through #333.
- Server Audit is **implemented as a bounded read-only product surface** with a strict snapshot/schema parser, fixed collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, cross-platform validation, and bounded scheduled-job relationships through #340.
- Trusted Mac CI is push-only for owner-controlled `agent/mac-*` branches and targets `[self-hosted, macOS, ARM64]`; it remains mandatory wherever the repository contract requires it.
- Trusted Windows CI is push-only for owner-controlled `agent/windows-*` branches and targets `[self-hosted, Windows, X64]`; it is used for material Windows/cross-platform validation but never substitutes for a declared Trusted Mac requirement.
- Customer-priority source/upload/API foundations are merged, but production customer priority remains **OFF**. Protected #164/#169 remain preparation only.
- Production TOTP remains **OFF**. The 2026-08-19 Admin rollout did not perform the dedicated TOTP KMS rollout. Subscription billing remains **OFF**, paid priority remains **OFF**, and no real-charge authorization exists.

## Current baseline

### Language/runtime working today

- CLI runner for `.solve` files
- lexer, parser, AST, and canonical AST runtime
- typed runtime values
- variables and reassignment
- print and return statements
- integer math: `+`, `-`, `*`, `/`
- string joining with `..`
- booleans and comparisons
- `if / else`
- `while`
- functions with parameters and return values
- arrays and index access
- objects, property access, and JSON helpers
- relative `.solve` imports, including recursive imports
- parser/runtime source locations and structured diagnostics
- hardened local execution modes that deny network, file, environment, AI, agent, and tool capabilities
- agent prototype syntax: `agent`, `tool`, `instruction`, `ask`
- local-first Workflow Intelligence Studio for deterministic workflow analysis, scenario simulation, traces, analytics, versions, and exports
- browser-local Workflow Preflight for deterministic workflow checks and evidence reports

### Production account/API/Admin foundation

Verified production state recorded on 2026-08-19:

- API access: **enabled**
- customer accounts: **enabled**
- Admin CRM backend: **enabled**
- username/email + password sign-in: **enabled**
- normal password sign-in sends email: **no**
- magic-link first-sign-in/recovery: **available**
- private Admin Gateway: **deployed**
- `admin.solve-lang.com`: **live behind Cloudflare Access/private ingress**
- static Admin UI: **published through the separately approved production publication stage**
- optional authenticator-app TOTP implementation: **merged in code**
- authenticator-app TOTP production feature: **disabled / rollout not completed**
- dedicated production TOTP KMS rollout: **not performed as part of the 2026-08-19 Admin work**
- subscription billing: **disabled**
- production billing webhook path: **disabled by feature boundary**
- paid priority selection: **disabled**
- real charge authorization: **none**
- general managed hosted SolveLang workflow execution: **not live**

The authoritative production-facing record is `docs/current-production-status-2026-08-19.md`. Facts explicitly marked there as carried forward were not silently re-audited by the Admin deployment workflow.

## Product direction

SolveLang should grow into a safe language, analysis, and automation platform with three distinct audit/product surfaces:

1. **Workflow Preflight** — analyze exported workflow files before production.
2. **Repository Audit** — analyze a repository and produce safe, prioritized architecture and cleanup recommendations.
3. **Server Audit** — inspect a server through read-only evidence and produce operational/security findings.

These surfaces remain separate because their permissions, blast radius, evidence, and execution models differ.

## Immediate engineering order

Re-evaluate live state before every run. The current safe order is:

1. keep shared CI/security blockers cleared, including Rust/RustSec;
2. drain existing safe non-production PRs before unrelated work whenever the safe queue exceeds six;
3. continue Repository Audit with browser/canonical ergonomics for architecture/security-path evidence, remaining framework/deployment relationships, richer query/evidence quality, MCP/Codex integration, local visual explorer quality, deterministic IDs/bounds/redaction, and cross-platform tests;
4. continue Solve Graph with richer bounded language/reference adapters, query/path/impact quality, affected-test/workflow intelligence, architecture/security summaries, and MCP/Codex integration;
5. continue Server Audit read-only-first with package/service/port/process/scheduled-job relationships, disk/log/cache/backup posture, web roots/domains/TLS/public-file evidence, ownership/permission/version findings, deterministic redacted reports, and cross-platform tests;
6. continue language/runtime and developer-experience work, especially formatter/linter/type-system/module work, `for` loops, diagnostics, editor support, and deterministic cross-platform tests;
7. continue safe Admin Panel repository preparation while treating every future live production change as a fresh protected action;
8. keep protected production-sensitive PRs refreshed and review-clean without merging them absent exact owner approval;
9. continue dormant customer-priority preparation while queue/customer/provider gates stay OFF;
10. continue TOTP preparation while production TOTP stays OFF;
11. continue billing readiness while production billing stays OFF and no real Stripe activity is authorized;
12. keep security/account hardening, launch readiness, rollback, least privilege, operations, and truth documentation current.

Production mutations remain separately gated even when implementation code, workflows, or prior production stages already exist.

## Account and security hardening

### Completed in code

- password authentication with username or email
- unique immutable username claims
- scrypt password derivation with random salt
- generic credential failures and dummy password derivation
- login/source/email throttles
- opaque server-side sessions
- secure session-cookie attributes
- CSRF protection for authenticated mutations
- logout/session revocation
- `authVersion` invalidation for password/security changes
- short-lived, single-use, version-bound magic links
- API-key fingerprint storage and collision handling
- plan key limits and atomic counters
- usage idempotency and quota transactions
- centralized account suspension/termination foundations
- attempt-aware production deployment serialization
- state-preserving production rollback

### Authenticator TOTP: implemented, production rollout incomplete

Merged implementation includes RFC 6238-compatible TOTP, bounded replay protection, KMS-backed secret protection, staged MFA authentication, backup codes, recovery behavior, and fail-closed malformed-state handling. Rollout preparation includes retained/rotating KMS infrastructure definitions, validation-only preflight, protected deployment workflows, rollback/state preservation, and billing forced OFF.

Still required before TOTP is live:

- separately approved live IAM/KMS actions;
- validation-only production preflight;
- protected deployment with billing still disabled;
- owner enrollment/login/backup-code/recovery canary.

### Account suspension/termination

The centralized account-state foundation is merged in code and should be treated as implemented repository work rather than a future-only item. Production-sensitive enforcement, rollout, and any irreversible account action remain governed by their own approval and operational controls.

## Workflow Intelligence Studio

Studio v1 is a static, browser-local product surface. It provides workflow modeling, deterministic analysis, policy visibility, scenario simulation, and human-review design without replacing the Rust runtime.

Future Studio work may add opt-in hosted collaboration, larger graph performance, richer condition expressions, and server-side Rust validation. Those capabilities require explicit privacy, authentication, and runtime design and are not implied by v1.

## Repository Audit

Repository Audit is an active read-only product, not a future-only concept.

### Implemented foundation

- bounded repository ingestion and file classification
- language/framework/package-manager/deployment detection
- exact duplicate/backup-copy and generated/vendor evidence
- bounded/redacted secret-pattern findings
- deterministic Solve Graph dependency and impact analysis
- JavaScript/TypeScript, Python, and conservative repository-local PHP import/reference relationships
- repository-local TypeScript config project-reference evidence
- dependency consistency evidence
- conservative dead-code candidates
- direct test/documentation mapping
- package/configuration/workflow-path relationships
- affected-test/workflow mapping from changed paths
- bounded architecture/security-boundary path summaries
- deterministic integrity-covered standalone architecture-path evidence artifact and browser/export presentation
- deterministic ranked Solve Graph search with MCP exposure
- local visual-explorer modeling
- evidence-completeness/partial-scan truth
- deterministic finding IDs and ordering
- canonical baseline `1.0.0`, graph/intelligence `1.1.0`, and affected-validation `1.2.0` report contracts
- machine-readable/canonical evidence plus self-contained report surfaces
- browser-local findings and impact/blast-radius presentation
- no repository mutation or repository-code execution during analysis

### Next read-only intelligence work

- remaining framework/deployment relationships not already represented by bounded config/workflow evidence
- richer query/path/impact and evidence quality
- MCP/Codex integration quality
- local visual explorer improvements
- deterministic cross-platform validation

### Remediation mode

Repository Audit write/remediation mode is **not enabled**. Any future cleanup branch/file move/deletion/dependency-removal mode must remain approval-based, auditable, reversible, and separately tested.

## Server Audit

Server Audit remains read-only-first because live infrastructure has a larger blast radius.

### Implemented read-only foundation

- fixed collector command surface with no user-supplied command execution
- bounded snapshot/schema parser
- OS/system/filesystem/socket/service/package/scheduled-job/process inventory
- disk/log/backup posture evidence
- web roots/framework hints/TLS certificates/public-file marker checks
- security posture summaries
- temporal, inventory, process, artifact, certificate, permission, listener, coverage, and scheduled-job relationship findings
- deterministic/redacted JSON and HTML reports
- no remediation executor

The collector must not expose credential values, private keys, database/customer contents, process command lines, cron command bodies, or unrelated personal-file contents. File-content reads and future collector commands remain explicit review surfaces.

### Active read-only hardening

- package/service/port/process/scheduled-job relationship quality
- log/cache/backup consistency
- domain/TLS/public-file evidence quality
- version evidence without pretending a CVE database was consulted
- bounded/redacted evidence and deterministic IDs
- cross-platform parser/report tests

### Remediation planning

Automatic remote remediation execution remains **out of scope**. Future planning may propose commands and rollback prerequisites, but execution requires a separate safety design and explicit approval.

## Admin Panel boundary

The private Admin Gateway, Cloudflare Access/private ingress, static Admin UI, and Admin application password rotation were completed through separately approved production stages on 2026-08-19 and are recorded in `docs/current-production-status-2026-08-19.md`.

Those completed approvals are historical evidence, not standing authorization. Any future IAM/KMS change, gateway redeploy, DNS/Access/private-ingress change, Admin publication/update, credential rotation, or production canary with mutation potential requires a fresh explicit owner approval scoped to that action. Repository-only preparation may continue without implying live authorization.

## Protected production-sensitive backlog

Keep production-sensitive PRs #161, #164, and #169 refreshed, tested, mergeable, and review-clean, but do not auto-merge them. Their exact merge gates are:

- `APPROVE PR #161 MERGE`
- `APPROVE PR #164 MERGE`
- `APPROVE PR #169 MERGE`

A protected merge approval does not authorize deployment, live IAM/KMS mutation, provider activation, billing, Stripe activity, email, charges/refunds, or production-data mutation.

## Hard safety boundary

Do not automatically:

- live-apply AWS/IAM/KMS changes;
- deploy production;
- change DNS/private ingress/Zero Trust;
- publish or update the production Admin UI;
- enable TOTP, customer priority, or billing;
- use Stripe live or create charges/refunds;
- send email;
- mutate production customer/CRM data;
- upload or execute customer source in production;
- bypass owner/protected approvals.

If one track is blocked by a production gate or queued self-hosted validation, continue another safe engineering track instead of idling.