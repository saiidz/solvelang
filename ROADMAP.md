# SolveLang Roadmap

## Current verification — 2026-09-22

Repository source status was re-audited on main
`59ab9ff271850454a2029495c2faf34cb93a10c7` after #945. MCP v0.3.0 is published
on npm and GitHub; main protection is enforced. PR #945 updates the manual Admin
Gateway workflow to verify and preserve the existing billing state; it did not
deploy production.
See [the current completion checklist](docs/project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.

This is the active roadmap for `saiidz/solvelang`. Keep four states separate: **implemented and repository-tested**, **published**, **deployed**, and **verified with a live provider/customer path**. A merge or green CI result proves only repository state unless a separate deployment/provider record says otherwise.

## Current evidence checkpoint

Reconciled on **2026-09-22** from the source baseline on `main` after PR **#945** (`59ab9ff271850454a2029495c2faf34cb93a10c7`). Production evidence remains separately dated; live GitHub state always wins if this checkpoint becomes stale.

The original repository-completion mission, #820, is closed. Current open project tracks are:

| Track | Current repository state | Remaining gate |
| --- | --- | --- |
| [#898 — Solve Context](https://github.com/saiidz/solvelang/issues/898) | Deterministic plan/pack/retrieve/handoff tools, changed-path + bounded graph selection, reversible structured compaction, synthetic evals, pinned first-party/external source regression suites, strict agent-run measurement records, pair-integrity hardening through #920, and published MCP v0.3.0 | Independent held-out evidence; actual Claude/Codex baseline-vs-context runs with provider-reported token/latency/cache/quality evidence; managed-workspace installation and public Plugin Directory listing |
| [#896 — connected support](https://github.com/saiidz/solvelang/issues/896) | Native IMAP/SMTP plus optional Gmail, durable claims/cursors, account controls, safe cutover/recovery and repository-qualified monitoring are implemented through #897/#903/#906/#908 | Separately approved default-off deployment, exact-scope credentials, one bounded new-message canary, actual task/reply outcome and stop/recovery proof |
| [#833 — PostHog canary](https://github.com/saiidz/solvelang/issues/833) | Bounded transport, approval/single-use claim, credential-source, kill-switch and lifecycle boundaries exist through #834–#870 | Concrete external secret/lifecycle backend, current project/key scope, fresh owner authorization and one bounded read-only live canary |
| [#113 — production launch](https://github.com/saiidz/solvelang/issues/113) | API access, customer password accounts, private Admin/TOTP and controlled-rollout billing are live; PR #945 makes the manual Admin Gateway workflow preserve that billing state; Studio account saving remains feature-gated; real-payment acceptance, priority and support activation remain gated | Six authenticated Studio production checks, bounded billing canary and customer/legal acceptance, live monitoring/recovery evidence for any activated feature, plus separate owner approvals for protected actions |

## Working today

### Language, runtime and browser

- Rust is the canonical language engine.
- `solvec` supports run/validate/check/lint/fmt/tokens/ast, explicit local modules, structured diagnostics and hardened execution modes.
- `solvec-core` is host-incapable; `solvec-wasm` is deny-all with shared conformance/resource-limit coverage.
- `/run/` consumes the reviewed pinned/hash-verified WASM handoff and fails closed. The historical TypeScript preview is not an execution fallback.
- Linux x86_64 release evidence exists; #941 adds successful macOS ARM64 and Windows x64 native candidate builds, packages and clean installs. A new public native release remains separate.

### Workflow intelligence and audits

- Workflow Preflight, Repository Audit / Solve Graph and Server Audit are bounded, deterministic, read-only analysis products.
- Solve Graph includes dependency/relationship queries, explanations, affected validations, security/architecture summaries and local browser/MCP surfaces.
- Server Audit retains bounded collection, redaction, coverage/contradiction truth and deterministic reporting.
- None of these surfaces grants source execution or remediation authority.

### Self-Driving

Repository-safe Self-Driving supports the progression from observe/suggest through reviewed patch/PR execution contracts and isolated credential boundaries. It does **not** imply an active provider connection, live GitHub App signer, automatic merge service or production rollout authority.

### Codex, Claude and Solve Context

Solve Context is now substantially beyond its original foundation:

- exact context plan/pack/retrieve tools;
- stale-source rejection and content-addressed handles;
- Claude ↔ Codex handoff creation/validation;
- JSON/log/diff lossless compaction with exact expansion;
- changed-path priority and supplied Solve Graph one-hop evidence;
- first-party pinned real-source regressions;
- independently pinned Chalk and node-fetch source regressions;
- a strict offline record/report contract for future real Claude/Codex measurements;
- fail-closed pair comparability: baseline and Solve Context arms must use the same fixture/provider/model/agent/record class, outcome basis and required-evidence denominator.

The repository **does not yet have measured real-agent token savings or a valid public performance percentage**. Synthetic byte reduction is not provider-token savings.

### Connected support and production account foundation

Repository code supports native IMAP/SMTP for the existing SolveLang mailbox, optional Gmail, durable ingress/action state, safe cutover/recovery and account/operator controls. The support stack/provider path remains default-off until separately approved and deployed.

Separately verified production evidence records API access, customer username/email + password sign-in, private Admin and TOTP infrastructure as live. Subscription billing is enabled for controlled rollout, with real-payment acceptance pending. Paid priority/provider execution, general managed workflow execution and the first PostHog canary remain off/unproven.

## Distribution truth

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified
2026-09-20. It distributes the tagged v0.3.0 source, not arbitrary later main
changes. v0.2.0 is historical. Managed-workspace installation and public Plugin
Directory listing remain separate evidence requirements.

## Project projection

These are **priority projections, not delivery dates or completion percentages**.

### Priority 0 — prove Solve Context with real evidence

1. Expand independent/blinded repository evaluation without weakening evidence budgets.
2. Run separately authorized Claude and Codex baseline-vs-Solve-Context tasks covering all six acceptance categories and both handoff directions.
3. Record provider-reported input/output usage, measured latency, selection precision/recall, task/evidence quality and zero cache-hot mutation where required.
4. Keep public percentage/comparative claims disabled until the acceptance matrix is complete and reviewed.
5. Verify managed-workspace installation and public Plugin Directory listing for published v0.3.0; later main changes need separate distribution evidence.

### Priority 0 — strengthen repository governance

- Maintain the now-enforced strict checks, pull requests and resolved review threads on `main`.
- Preserve exact-head merge practice and security/advisory repair even after rules are strengthened.

### Priority 1 — controlled product activation

- Connected support: deploy default-off only under exact-scope approval, then prove one new-message task/reply and stop/recovery path.
- PostHog: qualify the concrete credential/lifecycle backend and perform only the separately authorized bounded canary.
- Billing: preserve the enabled controlled rollout and complete scoped real-payment/customer acceptance before broader launch. Paid priority/provider execution stays disabled until its own configuration, monitoring, recovery and authorization gates pass.

### Priority 1 — release qualification

- Preserve the #941 macOS ARM64/Windows x64 build/package/install checks for future release candidates; qualify the exact public release source before support claims.
- Select and publish future CLI/MCP versions only through the reviewed release boundaries; repository version metadata alone is not publication.

### Deferred / separate product

**Solve Runners / Solblend remains a separate security and commercial product.** Runner provisioning, customer compute, pricing and OS-capacity work do not become SolveLang launch authority.

## Validation policy

Work one hot implementation candidate at a time. Before merge, require the exact proposed head to have all applicable terminal-success checks and a clean blocking-review state. For MCP/Solve Context work this includes package tests, synthetic and pinned-repository evals, agent-record contract tests, dependency audit, plugin roundtrip and packed-consumer proof in addition to applicable repository CI/Rust/WASM lanes.

Trusted Mac, Oracle ARM64 and Windows lanes are platform-specific evidence. Oracle/Windows never substitute for a declared Mac requirement, and runner availability is not itself a released-platform claim.

## Hard boundaries

Repository-safe work does not authorize production deployment, AWS/IAM/KMS/DNS/Cloudflare/Admin mutation, provider credentials, inbox reads/sends, external task creation, customer mutation, TOTP enrollment, Stripe configuration, charges/refunds, billing/priority activation, production source execution, restore drills, package/tag/release publication or business/legal commitments.

Consult [`docs/production-readiness.md`](docs/production-readiness.md), the active issues above and exact dated deployment/provider records for those decisions.
