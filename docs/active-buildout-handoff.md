# SolveLang Active Buildout Handoff

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
See [the current completion checklist](project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.

Use this handoff to continue **only `saiidz/solvelang`** without recreating merged work or confusing repository implementation with publication/deployment/live-provider proof.

## Historical checkpoint

Reconciled on **2026-09-15** from `main` immediately after PR **#920** (`5d07787c77dbe297b9bb52ba350669d6f9561a5e`). Always refresh live `main`, open PRs/issues and current workflow state before acting.

The active project queue is #898 (Solve Context), #896 (connected support), #833 (PostHog canary) and #113 (production launch). #820 is closed and should not be used as the current queue.

## Completed foundations to preserve

- **Language/browser:** host-incapable `solvec-core`, deny-all `solvec-wasm`, shared conformance/resource limits, audited artifact packaging and the pinned/hash-verified `/run/` loader are implemented. Native Rust remains canonical.
- **Repository Audit / Solve Graph:** bounded static ingestion, graph queries/explanations, affected validation, security/architecture summaries, reports and local browser/MCP surfaces are implemented. No source execution or remediation authority.
- **Server Audit:** bounded read-only collection, validation, redaction, relationships, posture/coverage truth and deterministic reports are implemented. No automatic remote remediation.
- **Self-Driving:** observe/suggest/reviewed-patch and bounded PR-execution contracts plus isolated provider/GitHub credential boundaries exist. Live provider activation, real signer backends, auto-merge and production rollout remain separate gates.
- **Codex/Claude:** installed-package protocol roundtrip and packed-consumer qualification exist. MCP v0.3.0 is published; later main changes still require separate versioned distribution.
- **Billing/recovery:** ownership/replay/recovery and fail-closed disabled-billing controls are repository-qualified; billing remains a protected live gate.
- **Release/security:** source/artifact regeneration and Linux x86_64 evidence exist. macOS/Windows native release support and any new public version remain separate.
- **Connected support:** selectable native IMAP/SMTP and optional Gmail, durable state, account controls, safe cutover/recovery and repository-qualified monitoring exist through #897/#903/#906/#908. Live deployment/provider proof does not.
- **Solve Context:** plan/pack/retrieve/handoff, structured compaction, changed-path + bounded graph-aware selection, first-party and independent pinned-source regressions, measurement-record/report contracts and pair-integrity hardening are implemented through #913–#920.

## Solve Context status after #920

The repository now has:

1. deterministic context planning/packing with exact source/excerpt provenance;
2. stale-source-safe retrieval handles;
3. Claude ↔ Codex handoff contracts;
4. byte-exact JSON/log/diff compaction/expansion;
5. changed-path and supplied Solve Graph one-hop ranking;
6. a pinned SolveLang real-source regression corpus;
7. independent pinned Chalk/node-fetch source subsets;
8. six-category synthetic fixture coverage including GitHub issue triage;
9. an offline contract for future real-agent records that keeps provider-reported/local-tokenizer/estimated/synthetic evidence distinct;
10. completion gates requiring both agents, all six categories, both handoff directions, measured latency, provider-reported tokens, measured selection metrics, zero cache-hot mutation in safe mode and no quality regression;
11. #920 fail-closed comparability requiring baseline/context arms to use the same outcome basis and required-evidence denominator.

What remains is **real evidence and distribution**, not another foundational context-pack rewrite. Actual Claude/Codex task success, provider token/cache behavior, end-to-end latency and competitor results remain unmeasured until separately authorized runs are performed.

## Current tracks

| Issue | Next meaningful repository-safe outcome | Live/protected boundary |
| --- | --- | --- |
| [#898](https://github.com/saiidz/solvelang/issues/898) | Broader independent/blinded fixtures; fix any demonstrated selector defect; prepare truthful real-agent measurement inputs; qualify future versioned distribution | No fabricated savings/quality claims, provider credentials or unapproved publication |
| [#896](https://github.com/saiidz/solvelang/issues/896) | Keep repository implementation/monitoring current and deployment procedure exact | No inbox read/send, task creation, credentials or production support activation without approval |
| [#833](https://github.com/saiidz/solvelang/issues/833) | Qualify concrete external credential/lifecycle backend and current scope | No live PostHog request without fresh owner authorization |
| [#113](https://github.com/saiidz/solvelang/issues/113) | Preserve enforced `main` checks; keep launch evidence synchronized; finish scoped production acceptance | No billing/priority/provider/customer mutation from repository authority |

## Working loop

1. Refresh live `main`, open PRs/issues and the exact current candidate head/base.
2. Read only the implementation/tests/contracts relevant to the demonstrated gap; expand inspection when dependencies or risks require it.
3. Keep one hot PR. Repair real failures/findings; do not weaken tests, ignore advisories or create no-op churn.
4. Require all applicable exact-head checks to be terminal success plus clean blocking review state before expected-head merge.
5. After merge, verify the new `main` push checks rather than assuming the PR result transfers automatically.
6. If one track reaches a protected live gate, continue independent repository-safe work on another track instead of inventing provider/deployment proof.
7. Report merges, test evidence and remaining gates separately from publication/deployment/live outcomes.

## Validation and runner policy

Hosted CI, Rust/RustSec and WASM artifact security remain the common repository gates as configured. MCP/Solve Context changes additionally require package tests/evals, independent/pinned-source regressions where applicable, agent-record contract tests, plugin roundtrip, packed-consumer and dependency-audit proof.

Trusted Mac is an owner-controlled self-hosted macOS ARM64 lane. Trusted Oracle uses `[self-hosted, Linux, ARM64, oracle-free, solvelang-ci]`; Trusted Windows uses `[self-hosted, Windows, X64]` where required. A supplemental runner never substitutes for a specifically required platform, and runner availability is not a public release-support claim.

## Distribution truth

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

- keep v0.2.0 references explicitly labeled as the historical package line;
- use repository-source instructions when documenting current-main capabilities;
- do not claim a marketplace/npm/public plugin consumer receives current-main behavior unless the corresponding external publication/install record is verified.

## Production truth and hard boundaries

Use [`production-readiness.md`](production-readiness.md), #113 and exact dated deployment/provider evidence. Current production records say API access, customer password accounts, private Admin, TOTP infrastructure, and controlled-rollout API subscription billing are live; paid priority/provider execution, connected-support activation, first real-payment canary evidence, and the first PostHog canary are not established as live.

Preserve the existing `hello@solve-lang.com` mailbox and routing. Native IMAP/SMTP compatibility does not grant authority over other mailboxes, projects or server settings.

Do not live-apply AWS/IAM/KMS/DNS/Cloudflare/Admin changes; deploy production; activate inbox/queue/provider/billing/priority; send mail; create external tasks; mutate customer/CRM data; enroll TOTP; use live Stripe/provider credentials; charge/refund; execute customer source; restore production; or publish tags/releases/plugins without separate exact-scope approval and required evidence.

**Solve Runners / Solblend remains outside this loop as a separate product/security/commercial boundary.**
