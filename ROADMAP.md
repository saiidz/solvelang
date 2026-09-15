# SolveLang Roadmap

This is the active roadmap for `saiidz/solvelang`. Separate **implemented and repository-tested**, **published**, **deployed**, and **verified with a live provider**. A merged PR, an available runner, or a passing mock test does not establish the later states.

## Evidence and scope

The reconciled baseline is the repository through #914, commit `c36f2b18e3393b8174943e01b79d56c65ce83c58`. Refresh live refs, PRs, checks and the relevant issue before acting; this checkpoint is not a permanently current head. The older detailed [September 4 roadmap](https://github.com/saiidz/solvelang/blob/c36f2b18e3393b8174943e01b79d56c65ce83c58/ROADMAP.md) is preserved in Git history, not the active work queue.

The original repository-completion mission [#820](https://github.com/saiidz/solvelang/issues/820) is closed. It does not close the newer product work or authorize a commercial launch. The active tracks are:

| Track | Repository implementation | Remaining completion gate |
| --- | --- | --- |
| [#113 — production launch](https://github.com/saiidz/solvelang/issues/113) | Account/API/Admin foundations, billing ownership/replay/recovery and disable controls, data-recovery verification, billing/priority monitoring preparation | Required-check/review enforcement, rollout-specific permissions, approved deployments, live billing/priority/monitoring/recovery evidence, customer acceptance and business decisions |
| [#833 — PostHog canary](https://github.com/saiidz/solvelang/issues/833) | Bounded transport, exact approval/single-use claim, runtime credential/kill-switch/lifecycle boundaries through #866–#870 | Concrete external backend qualification, exact project/key scope, fresh owner authorization, one bounded live request and lifecycle evidence |
| [#896 — connected support](https://github.com/saiidz/solvelang/issues/896) | Native IMAP/SMTP and optional Gmail support, tenant/mailbox/secret binding, durable claims/cursors, account controls and synthetic end-to-end qualification through #906; monitoring/recovery preparation | Separately approved default-off deployment, scoped credentials, new-message canary and actual task/reply/stop/recovery outcomes |
| [#898 — Solve Context](https://github.com/saiidz/solvelang/issues/898) | Exact context packs, plan/retrieve/handoff tools, structured compaction, synthetic evals, changed-file and bounded supplied-graph selection through #913; locked dependency security gate through #914 | Real-repository and agent evaluation, measured quality/token/latency evidence, reviewed remaining product features, versioned distribution and clean consumer installation |

## Implemented product surfaces — do not rebuild them

### Language, browser runtime and developer tools

Rust remains the canonical language engine. The CLI supports `.solve` execution, imports, control flow, functions, collections, structured diagnostics, formatting/linting/checking and hardened execution modes. The local stdio LSP and opt-in editor package remain deliberately narrower than a workspace-wide IDE or hosted execution service.

Pure-core extraction is complete: `solvec-core` is host-incapable and `solvec-wasm` is deny-all, with shared conformance and resource-limit coverage. The repository's `/run/` consumes the reviewed pinned, hash-verified audited WASM handoff and fails closed when loading fails. **The old TypeScript preview is not an execution fallback.** Changes to that source are not proof that a new public version was deployed.

### Workflow Preflight, Repository Audit and Solve Graph

Workflow Preflight analyzes exported workflows locally. Repository Audit and Solve Graph provide bounded static ingestion, supported language/framework/config/deployment relationships, dependency and conservative dead-code evidence, graph queries and explanations, affected-test/workflow mapping, security/architecture summaries, integrity-covered reports and the local visual explorer. Read-only MCP exposes the qualified graph/query surfaces. These analyses do not execute repository source, resolve registries or grant write/remediation authority.

The historical dependency/graph/browser trains are retained in the linked history and [active handoff](docs/active-buildout-handoff.md). Only extend them to fix a demonstrated gap; do not recreate completed foundations.

### Server Audit

Server Audit is read-only and non-remediating. It includes fixed allowlisted collection, bounded snapshot/schema validation, system/service/process/listener/package/filesystem/web/certificate/backup/log evidence, structural relationships, coverage and contradiction truth, redaction and canonical JSON/HTML reporting. Its source/object/finding bounds and partial/unavailable evidence must remain explicit. Automatic remote remediation is not a current capability.

### Self-Driving

The product direction is Observe → Understand → Find → Propose → Test → PR → Deploy → Measure → Learn. Each stage has its own authority boundary; the diagram grants none.

The repository has advanced beyond the September 4 observe-only snapshot. Observation, bounded suggestion/patch preparation, tested-PR governance and injected GitHub write/credential boundaries through #850–#863 are implemented, alongside PostHog isolation through #870. That is not a live GitHub App signer, an active provider connection, automatic merge permission or production rollout authority. A concrete external credential/signing backend and a qualified owner-authorized activation are still required for real side effects. Observe mode must continue rejecting write-capable actions.

The older provider-neutral sanitized Self-Driving context envelope is not a claim that the newer **Solve Context** agent product in #898 is complete.

### Codex, Claude and Solve Context

Canonical installed-package MCP protocol qualification for Codex and Claude is merged through #871. Solve Context adds deterministic bounded context selection, source hashes/handles, stale-source rejection, cross-agent handoff validation and JSON/log/diff compaction. #913 adds changed-path priority and bounded direct relationships from a supplied Solve Graph; it does not perform unrestricted repository execution or network discovery.

Synthetic byte-reduction metrics are not measured model-token savings, lower latency or improved task success. The next evaluation work needs fixed real source revisions, known expected evidence, honest omissions, actual agent outcomes and reproducible measurements. External package/plugin publication, updated installation pins and actual customer installs remain distinct from repository CI. The memory/provenance learner and optional provider proxy require their own reviewed scope; do not silently make optional expansion a first-release prerequisite.

### Connected support

#896 qualifies an actual provider implementation, not merely a planning preview. The owner's existing `hello@solve-lang.com` mailbox is supported by the native IMAP/SMTP path; Gmail is optional. Preserve the existing mailbox and routing. A shared mail endpoint grants no access to other mailboxes, projects or server settings.

Incoming mail and model output are untrusted data, not authorization. Tenant/mailbox binding, verified TLS, durable claims, new-message cutover, no blind retry after ambiguous provider outcomes, suspension, pause and revocation remain mandatory. Repository tests use synthetic messages/providers only. Live ingestion, external task creation and sending are separately gated.

## Release, security and operations

Billing ownership/replay/payment-recovery and fail-closed internal mutation controls are merged through #879. Release machinery includes annotated-tag/source binding, packaged CLI version/provenance verification and non-publishable candidate/regeneration evidence through #885. Do not repeat those foundations or confuse candidate artifacts with a published release.

Recorded native artifact evidence is Linux x86_64 only. macOS ARM64 and Windows x64 require exact-platform build/package/install qualification before release-support claims. Browser/WASM is a separately qualified bounded runtime, not a substitute for native platform evidence. Runner availability and site tests do not establish native release support.

The [production-readiness record](docs/production-readiness.md), #113 and exact deployment/provider evidence govern launch decisions. The [August 20 production record](docs/current-production-status-2026-08-20.md) is dated evidence, not a fresh environment audit. Existing account/API/Admin/TOTP infrastructure must not be rebuilt just because an old plan calls it pending. Billing and paid-priority/provider activation remain gated in the last verified launch record. Monitoring code is not proof of deployed alarms, a working alert destination or a completed restore drill.

Keep current-head dependency audits, security review, rollback/disable paths, data protection and customer-facing acceptance qualified. Fix reported vulnerabilities rather than ignoring advisories. Seller identity, Terms/Privacy, refunds/cancellation, retention and support/billing commitments need owner/business decisions; a prepared page or checklist is not approval.

## Execution order and permission boundaries

Work one hot implementation/merge candidate at a time, refresh its base/head/scope, fix actual failures on its existing branch, and require all applicable current-head checks plus clean blocking review state before expected-head merging. Missing, queued, cancelled or stale checks are not green. Use self-hosted Mac/Oracle/Windows only according to the current repository contract; never substitute another platform for required Mac evidence or change runner registration/services.

When blocked by a live gate, continue independent repository implementation, realistic evaluation, release qualification or a demonstrated documentation correction. Do not create status-only PRs or new scaffolding merely to keep a loop busy. Do not publish unsupported completion percentages.

Repository-safe work does not authorize production deployment, AWS/IAM/KMS/DNS/private-ingress/Admin changes, live credentials/providers, inbox reads, messages/tasks, customer mutations, TOTP enrollment, billing/priority activation, charges/refunds, restoration drills or release/marketplace publication. Each needs its separately scoped approval and evidence. Historical approvals on #161/#164/#169 are not standing production permission.

**Solve Runners/Solblend remains a separate deferred product, security and commercial boundary.** Its provisioning, registration, pricing, operating-system support and customer compute do not become part of this roadmap's launch authority.
