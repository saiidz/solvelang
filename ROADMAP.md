# SolveLang Roadmap

SolveLang is an early language and workflow-analysis prototype written primarily in Rust, with a production customer-account/API foundation that is further along than the general managed-execution product.

This roadmap distinguishes four states deliberately:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically production-enabled, and production account infrastructure is not evidence that general hosted SolveLang workflow execution exists.

## Current Baseline

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

### Production account/API foundation

Verified production state on 2026-08-13:

- API access: **enabled**
- customer accounts: **enabled**
- username/email + password sign-in: **enabled and owner-canary verified**
- normal password sign-in sends email: **no**
- magic-link first-sign-in/recovery: **available**
- optional authenticator-app TOTP implementation: **merged in code**
- authenticator-app TOTP production feature: **disabled / not rolled out yet**
- dedicated production TOTP KMS key: **not created yet**
- subscription billing: **disabled**
- paid priority selection: **disabled**
- real charge authorization: **none**

The current factual production record is `docs/current-production-status-2026-08-13.md` once this documentation PR is merged.

## Product Direction

SolveLang should grow into a safe language, analysis, and automation platform with distinct product surfaces plus a shared structural-intelligence layer:

1. **Workflow Preflight** — analyze exported workflow files before production.
2. **Repository Audit** — analyze a repository and produce safe, prioritized architecture and cleanup recommendations.
3. **Server Audit** — inspect a server through read-only access and produce operational/security findings.
4. **Solve Graph / Solve Intelligence** — build a local-first software knowledge graph for architecture, dependency, impact, deployment, security-path, MCP/agent, and visual-explorer use cases.

Workflow Preflight, Repository Audit, and Server Audit must remain separate where their permissions, blast radius, evidence, and execution models differ. Solve Graph is a shared evidence/intelligence layer, not a reason to merge those permission boundaries.

The detailed Solve Graph product and implementation plan is `docs/solve-graph-product-plan-2026-08-16.md`.

## Immediate Engineering Order

The current buildout sequence is:

1. complete the optional authenticator-app production rollout and owner canary;
2. add centralized account suspension/termination enforcement;
3. finish remaining account/security hardening and truth documentation;
4. finish production billing preparation before any separately approved billing activation or real charge;
5. finish and validate queue-backed paid-priority execution before exposing paid priority choices;
6. finish Repository Audit deterministic read-only inventory/scanner foundations;
7. build Solve Graph v0 contracts, `.solve` semantic graphing, and bounded local query primitives;
8. integrate Solve Graph into Repository Audit v1 instead of creating a separate duplicate dependency engine;
9. build Server Audit in read-only-first stages;
10. complete final production IAM/rollback/operations hardening;
11. continue language/runtime correctness and developer-experience work in parallel where independent;
12. run final launch-readiness canaries and maintain an exact live-state record.

Production mutations remain separately gated even when implementation code and workflows already exist. Local/read-only Solve Graph work may proceed independently when it does not alter production state.

## Account And Security Hardening

### Completed

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
- attempt-aware production deployment serialization
- state-preserving production rollback

### Authenticator TOTP: implemented, production rollout incomplete

Merged implementation includes:

- RFC 6238-compatible six-digit TOTP
- 30-second steps with a bounded clock window
- unique random enrollment secret
- KMS secret protection with account-bound encryption context
- staged first-factor authentication with no full session before MFA succeeds
- magic-link recovery that does not bypass MFA
- ten one-time backup codes stored only as keyed fingerprints
- atomic backup-code consumption
- TOTP time-step replay prevention
- five-minute MFA challenges with bounded attempts
- `authVersion` invalidation for authenticator security changes
- fail-closed malformed/partial TOTP account state

Merged rollout preparation includes:

- dedicated retained/rotating KMS stack definition
- protected KMS bootstrap workflow
- validation-only production TOTP preflight
- protected TOTP production deployment workflow
- exact KMS ARN preservation during ordinary redeploy and rollback
- production deployment serialization with the other production mutation workflows
- billing forced off throughout authenticator rollout

Still required before TOTP is live:

- finish/review the live IAM role update path;
- create/prove the dedicated KMS stack;
- run the validation-only TOTP production preflight;
- deploy TOTP support with billing still disabled;
- perform the owner enrollment/login/backup-code/recovery canary.

### Account suspension/termination

Planned centralized states:

- `active`
- `suspended`
- `terminated`

The authoritative state should live on the customer-auth account record and be enforced centrally across sessions, password/magic-link authentication, TOTP/MFA, API-key authorization, key issuance, checkout, and future customer-owned queued work. Termination should be irreversible without an explicit future migration policy; security-state changes should invalidate older authentication artifacts through `authVersion`.

This enforcement is **not merged or live yet**.

## Workflow Intelligence Studio

Studio v1 is a static, browser-local product surface. It provides workflow modeling, deterministic analysis, policy visibility, scenario simulation, and human-review design without replacing the Rust runtime.

Future Studio work may add opt-in hosted collaboration, larger graph performance, richer condition expressions, and server-side Rust validation. Those capabilities require explicit privacy, authentication, and runtime design and are not implied by v1.

## Solve Graph / Solve Intelligence

Solve Graph is a planned local-first software knowledge graph that should become a shared structural-intelligence layer for developers, Repository Audit, MCP/Codex/agents, impact analysis, and a future visual repository explorer.

The core thesis is:

> The compiler explains what a Solve program means. Solve Graph explains what the whole software system means to developers and AI agents.

### Initial local scope

- versioned deterministic node/edge/provenance contract;
- exact compiler-backed semantic graphing for `.solve` source;
- polyglot adapters added incrementally after schema stability;
- repository/file/module/function/type/dependency relationships;
- GitHub Actions and deployment relationships;
- bounded path, neighbor, dependency-cone, cycle, and impact queries;
- exact source provenance for graph facts;
- incremental local cache with generated artifacts ignored by Git by default;
- no repository code execution during indexing;
- no hosted source upload in the initial phases;
- optional MCP tools only after deterministic query behavior is proven;
- local visual explorer before any hosted repository product.

### High-value use cases

- dependency and reverse-dependency analysis;
- PR/git-diff blast radius;
- affected tests and deployment workflows;
- architecture hotspots and cycles;
- route/service/resource paths;
- security-sensitive structural paths;
- Repository Audit evidence;
- bounded structural context for Codex/agents;
- interactive architecture exploration.

### `.solve` differentiation

The `.solve` adapter should use compiler/AST/semantic structures rather than generic syntax-only parsing so calls, imports, types, agents/tools, and source provenance are as exact as the language implementation allows.

### Hosted scope is later and separately gated

Potential future hosted capabilities include private repository graph workspaces, opt-in public repository pages, historical graph snapshots, PR graph diffs, organization/cross-repository relationships, and grounded AI architecture Q&A.

Hosted private-source ingestion requires a separate privacy/security design covering GitHub App scopes, tenant isolation, source retention/deletion, encryption, repository visibility changes, model-provider boundaries, and public/private publication rules.

No private repository should become a public graph implicitly.

See `docs/solve-graph-product-plan-2026-08-16.md` for the phased PR sequence, graph contracts, CLI/MCP design, explorer requirements, security rules, testing strategy, and go/no-go gates.

## Repository Audit

Repository Audit remains a planned product surface. The v0 report contract and schema exist, but the scanner engine is **not implemented yet**.

### Repository Audit v0: deterministic read-only inventory

Target scope:

- repository tree and file classification
- language, framework, package-manager, and deployment detection
- exact duplicate and backup-copy candidates
- size and generated/vendor analysis
- secret-pattern redaction and unsafe-public-file warnings without exposing values
- deterministic finding IDs and ordering
- machine-readable JSON and self-contained HTML reports
- bounded file/size/time limits
- no repository mutation
- no repository code execution
- no package-manager/build/hook execution during the initial scan

### Repository Audit v1: code and dependency intelligence

After v0 accuracy is proven, use the shared Solve Graph engine for structural intelligence rather than implementing a second graph system:

- import/reference graph
- dead-code candidates
- unused/conflicting dependencies
- route/configuration consistency checks
- test/documentation coverage map
- architecture and maintainability scoring
- dependency cycles and high-risk hubs
- change/blast-radius evidence where applicable

### Repository Audit v2: approval-based cleanup

Only after read-only behavior is proven:

- selectable remediation plan
- dedicated cleanup branch
- safe file moves/deletions
- dependency cleanup
- generated documentation/formatting
- test/build verification
- complete diff and audit ledger
- pull request creation with rollback plan
- explicit human review before merge

## Server Audit

Server Audit should follow Repository Audit because live infrastructure has a larger blast radius.

### Server Audit v0: read-only posture report

Target scope:

- constrained SSH collector
- explicit command allowlist
- OS/package/service/port/process/scheduled-job inventory
- disk/log/cache/backup posture
- web roots/domains/SSL/public-file checks
- ownership and permission findings
- common Laravel/PHP/Node/web-server/cPanel/CloudLinux indicators
- unsupported-version and unsafe-default warnings
- redacted evidence bundle
- severity-ranked findings
- no mutation capability

It must not display credential values, private keys, database contents, customer content, or unrelated personal files.

### Server Audit v1: remediation planning

- proposed commands without execution
- backup requirements
- dependency/outage risks
- ordered change plan
- rollback plan for every action

### Server Audit v2: approved execution

- individually approved actions only
- dry-run support where available
- backup verification
- before/after health checks
- immutable execution ledger
- automatic stop and rollback guidance on failure

## Shared Audit Principles

Repository Audit and Server Audit must share these rules:

- deterministic checks first; AI explanation second
- evidence-backed findings
- secret redaction by default
- least-privilege access
- clear separation between observation, recommendation, and execution
- no destructive action based only on model confidence
- explicit human approval for writes
- reproducible reports and immutable audit history
- bounded scans with file, size, time, and command limits
- fail closed when permissions, evidence, or validation are incomplete

Solve Graph should follow the same deterministic/evidence/redaction/boundedness principles when it supplies structural evidence to those products.

## Language Runtime

### Phase 1: Core interpreter

Status: mostly complete.

Completed:

- `source -> diagnostics -> lexer -> parser -> AST -> AST runtime`
- typed values through the AST runtime
- math, joins, arrays, objects, indexing, comparisons, function calls, and control flow
- parser-driven `let`, assignment, `print`, `return`, functions, `if / else`, `while`, arrays/objects, and agent prototype blocks
- source-located AST nodes
- structured runtime errors with source line, column, caret, filename, and hints where available
- checked numeric arithmetic
- structured invalid access/type failures
- function argument-count validation
- parser recovery at statement boundaries
- deterministic golden tests without external internet

Known diagnostics limitation:

- imports are currently flattened before parsing, so syntax/runtime locations in imported content are based on the combined source; runtime errors may display the top-level filename rather than the original imported filename.

The intended fix is to carry a line-origin/source-provenance map alongside the flattened source and use it consistently for parser diagnostics and runtime error context without changing language grammar.

### Phase 2: language semantics

Continue tightening semantic correctness on the source-located AST runtime. Preserve documented compatibility behavior for missing object properties (`null`) unless a deliberate language-version change is made.

### Phase 3: language expansion

Already present in some form:

- imports
- objects/records
- file read/write helpers
- JSON parsing/encoding

Still planned or incomplete:

- stable standard-library/module design
- `for` loops
- stronger type checking
- package/module system beyond relative imports
- broader provider/runtime abstractions

### Phase 4: tooling and DX

- expand lexer/parser/runtime coverage
- keep deterministic golden tests
- formatter
- linter
- richer CLI diagnostics
- VS Code syntax highlighting
- stable language specification/versioning
- Solve Graph semantic emitter and structural query tooling after its contracts are stabilized

### Phase 5: platform/runtime adapters

Only after language semantics are predictable:

- managed hosted Rust runtime
- durable execution model
- runtime adapters to established orchestration systems
- production integrations
- package/integration ecosystem
- enterprise governance and observability

## Priority Processing

Queue-backed priority foundations exist, including FIFO lanes, leases/retries, DLQs, weighted worker lanes, and duplicate-safe canary behavior.

Customer paid priority remains **disabled** until the queue-backed worker is enabled and validated for real customer-owned work, including authoritative account/entitlement checks and operational canaries.

## Billing

Significant subscription/checkout/webhook/management code exists, but production self-service billing remains **disabled**.

Before activation:

- finish account/security prerequisites;
- fix/prove Stripe webhook replay handling so external side effects are safe under duplicate delivery;
- verify live Stripe configuration and webhook identity/idempotency;
- verify checkout ownership and subscription lifecycle behavior;
- verify upgrade/downgrade/cancellation/payment-method flows;
- pass production preflight;
- keep paid-priority unavailable unless queue-backed execution is proven;
- perform any real-charge canary only after separate explicit approval.

Authenticator/security rollout authorization never implies billing authorization.

## Long-Term Direction

SolveLang should become a simple, readable, safe, and AI-native language and analysis platform for:

- automation specifications
- APIs and data workflows
- tool-using agents
- workflow preflight
- repository architecture/cleanup audits
- local and hosted software knowledge graphs
- PR/change impact analysis
- bounded structural context for AI coding agents
- visual architecture exploration
- server posture/operational audits
- eventually, managed workflow execution where the runtime and operational guarantees are proven

The immediate priority remains security/account completion and production truthfulness, followed by billing/priority readiness and read-only audit products, while language/runtime correctness continues in parallel. Solve Graph is a parallel local/read-only strategic track that should become the shared structural engine for Repository Audit v1 and AI/visual architecture tooling without bypassing production safety gates.
