# SolveLang Roadmap

This is the active roadmap for `saiidz/solvelang`. Keep four states separate: **implemented and repository-tested**, **published**, **deployed**, and **verified with a live provider/customer path**. A merge or green CI result proves only repository state unless a separate deployment/provider record says otherwise.

## Current evidence checkpoint

Reconciled on **2026-09-15** from `main` immediately after PR **#920** (`5d07787c77dbe297b9bb52ba350669d6f9561a5e`). Live GitHub state always wins if this checkpoint becomes stale.

The original repository-completion mission, #820, is closed. Current open project tracks are:

| Track | Current repository state | Remaining gate |
| --- | --- | --- |
| [#898 — Solve Context](https://github.com/saiidz/solvelang/issues/898) | Deterministic plan/pack/retrieve/handoff tools, changed-path + bounded graph selection, reversible structured compaction, synthetic evals, pinned first-party/external source regression suites, strict agent-run measurement records, and pair-integrity hardening through #913–#920 | Larger independent/blinded evaluation; actual Claude/Codex baseline-vs-context runs; provider-reported token/latency/cache/quality evidence; versioned distribution of current-main capabilities |
| [#896 — connected support](https://github.com/saiidz/solvelang/issues/896) | Native IMAP/SMTP plus optional Gmail, durable claims/cursors, account controls, safe cutover/recovery and repository-qualified monitoring are implemented through #897/#903/#906/#908 | Separately approved default-off deployment, exact-scope credentials, one bounded new-message canary, actual task/reply outcome and stop/recovery proof |
| [#833 — PostHog canary](https://github.com/saiidz/solvelang/issues/833) | Bounded transport, approval/single-use claim, credential-source, kill-switch and lifecycle boundaries exist through #834–#870 | Concrete external secret/lifecycle backend, current project/key scope, fresh owner authorization and one bounded read-only live canary |
| [#113 — production launch](https://github.com/saiidz/solvelang/issues/113) | API access, customer password accounts, private Admin and TOTP infrastructure are live; billing/priority/support-provider activation remain separately gated | Enforced required checks/reviews, rollout-specific permissions, live monitoring/recovery evidence for any activated feature, customer/legal acceptance and explicit owner approvals |

## Working today

### Language, runtime and browser

- Rust is the canonical language engine.
- `solvec` supports run/validate/check/lint/fmt/tokens/ast, explicit local modules, structured diagnostics and hardened execution modes.
- `solvec-core` is host-incapable; `solvec-wasm` is deny-all with shared conformance/resource-limit coverage.
- `/run/` consumes the reviewed pinned/hash-verified WASM handoff and fails closed. The historical TypeScript preview is not an execution fallback.
- Current native release-artifact evidence is **Linux x86_64 only**. macOS ARM64 and Windows x64 are not released-platform claims yet.

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

Separately verified production evidence records API access, customer username/email + password sign-in, private Admin and TOTP infrastructure as live. Subscription billing, paid priority/provider execution, general managed workflow execution and the first PostHog canary remain off/unproven unless a newer protected production record says otherwise.

## Distribution truth

The latest published GitHub MCP Server release is **v0.2.0** from 2026-07-20. Current repository source contains substantial MCP/Solve Context capabilities added after that release. Therefore:

- `@solvelang/mcp-server@0.2.0` is the published historical package line;
- current-main capabilities must not be claimed as distributed through that old pin;
- a future versioned MCP/package/plugin release is required before current-main Solve Context behavior can be described as publicly distributed;
- repository CI proving a clean tarball/consumer install is release-readiness evidence, not publication.

## Project projection

These are **priority projections, not delivery dates or completion percentages**.

### Priority 0 — prove Solve Context with real evidence

1. Expand independent/blinded repository evaluation without weakening evidence budgets.
2. Run separately authorized Claude and Codex baseline-vs-Solve-Context tasks covering all six acceptance categories and both handoff directions.
3. Record provider-reported input/output usage, measured latency, selection precision/recall, task/evidence quality and zero cache-hot mutation where required.
4. Keep public percentage/comparative claims disabled until the acceptance matrix is complete and reviewed.
5. Prepare a versioned MCP/plugin distribution path for current-main capabilities after repository qualification.

### Priority 0 — strengthen repository governance

- Configure `main` protection/rules so required current-head checks and intended review policy are enforced by GitHub rather than manual discipline alone.
- Preserve exact-head merge practice and security/advisory repair even after rules are strengthened.

### Priority 1 — controlled product activation

- Connected support: deploy default-off only under exact-scope approval, then prove one new-message task/reply and stop/recovery path.
- PostHog: qualify the concrete credential/lifecycle backend and perform only the separately authorized bounded canary.
- Billing/priority: keep disabled until live Stripe/provider configuration, monitoring, recovery, customer/legal materials and owner approvals are complete.

### Priority 1 — release qualification

- Add exact-platform native build/package/install evidence before claiming macOS ARM64 or Windows x64 support.
- Select and publish future CLI/MCP versions only through the reviewed release boundaries; repository version metadata alone is not publication.

### Deferred / separate product

**Solve Runners / Solblend remains a separate security and commercial product.** Runner provisioning, customer compute, pricing and OS-capacity work do not become SolveLang launch authority.

## Validation policy

Work one hot implementation candidate at a time. Before merge, require the exact proposed head to have all applicable terminal-success checks and a clean blocking-review state. For MCP/Solve Context work this includes package tests, synthetic and pinned-repository evals, agent-record contract tests, dependency audit, plugin roundtrip and packed-consumer proof in addition to applicable repository CI/Rust/WASM lanes.

Trusted Mac, Oracle ARM64 and Windows lanes are platform-specific evidence. Oracle/Windows never substitute for a declared Mac requirement, and runner availability is not itself a released-platform claim.

## Hard boundaries

Repository-safe work does not authorize production deployment, AWS/IAM/KMS/DNS/Cloudflare/Admin mutation, provider credentials, inbox reads/sends, external task creation, customer mutation, TOTP enrollment, Stripe configuration, charges/refunds, billing/priority activation, production source execution, restore drills, package/tag/release publication or business/legal commitments.

Consult [`docs/production-readiness.md`](docs/production-readiness.md), the active issues above and exact dated deployment/provider records for those decisions.
