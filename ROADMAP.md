# SolveLang Roadmap

SolveLang is an early language prototype written in Rust. The project has a working lexer, parser, AST, and one canonical AST runtime. The former line-based runtime files and public legacy CLI entry points have been removed.

## Current Baseline

Completed and working today:

- CLI runner for `.solve` files
- Lexer foundation
- Parser foundation
- AST definitions
- Typed runtime value foundation
- Variables
- Print statements
- Integer math: `+`, `-`, `*`, `/`
- String joining with `..`
- Booleans
- Comparisons
- `if / else`
- `while`
- Functions with parameters and return values
- Arrays and index access
- Agent prototype syntax: `agent`, `tool`, `instruction`, `ask`
- Local-first Workflow Intelligence Studio for canonical workflow modeling, deterministic analysis, scenario simulation, traces, analytics, versions, and exports
- Browser-local n8n Workflow Preflight for deterministic workflow checks and evidence reports

## Product Direction

SolveLang should grow into a safe analysis and automation platform with three distinct product surfaces:

1. **Workflow Preflight** — analyze exported workflow files before production.
2. **Repository Audit** — analyze an entire Git repository and produce safe, prioritized cleanup and architecture recommendations.
3. **Server Audit** — inspect a live server through read-only access and produce an operational, security, and cleanup report.

These surfaces must remain separate because their risk, permissions, inputs, and execution models are different.

## Workflow Intelligence Studio

Studio v1 is a static, browser-local product surface. It provides pre-automation workflow analysis, policy visibility, scenario simulation, and human-review design without replacing the Rust runtime. The Studio model intentionally supports operational concepts that are not all executable SolveLang syntax.

Future Studio work may add opt-in hosted collaboration, larger graph performance, richer condition expressions, and server-side Rust validation. Those capabilities require explicit privacy, authentication, and runtime design and are not implied by v1.

## Repository Audit

Repository Audit is the next major product expansion after the current payment and entitlement flow is stable.

### Initial scope

The first release should accept a GitHub repository or uploaded archive and operate in read-only mode. It should produce:

- repository inventory and architecture map
- language, framework, package-manager, and deployment detection
- duplicate, abandoned, generated, copied, backup, and unusually large file detection
- dead-code and unused-dependency candidates
- broken import, route, configuration, and build-reference candidates
- exposed-secret and unsafe-public-file warnings without displaying secret values
- test, documentation, ownership, and release-readiness gaps
- inconsistent naming and folder-organization findings
- prioritized actions labeled `keep`, `review`, `move`, `merge`, `rewrite`, or `delete candidate`
- confidence, evidence, impact, and rollback notes for every destructive recommendation

### Safety model

Repository Audit must default to **Analyze only**.

It must not delete, rename, move, rewrite, or merge files during an initial scan. A finding is not authorization to modify a repository.

The product should expose three explicit levels:

1. **Analyze only** — findings and suggestions; no repository changes.
2. **Prepare cleanup** — create a proposed patch or dedicated branch and run validation without touching the default branch.
3. **Execute approved changes** — apply only selected actions after explicit approval, then run tests, builds, and policy gates before opening a pull request.

All write-enabled repository work must:

- use a dedicated branch
- preserve the default branch
- show a complete diff
- record every action in an audit ledger
- run available tests and builds
- stop on validation failure
- include rollback instructions
- require human review before merge

### Repository Audit delivery phases

#### Repository Audit v0: deterministic inventory

- repository tree and file classification
- package and framework detection
- duplicate and backup-file candidates
- size, age, and generated-file analysis
- secret-pattern redaction and public-exposure warnings
- machine-readable JSON report and human-readable HTML report

#### Repository Audit v1: code and dependency intelligence

- import and reference graph
- dead-code candidates
- unused and conflicting dependencies
- route and configuration consistency checks
- test and documentation coverage map
- architecture and maintainability scoring

#### Repository Audit v2: approval-based cleanup branches

- selectable remediation plan
- dedicated cleanup branch
- safe file moves and deletions
- dependency cleanup
- formatting and generated documentation
- test/build verification
- pull request creation with rollback plan

## Server Audit

Server Audit should follow Repository Audit because live infrastructure has a larger blast radius and requires stronger permission controls.

### Initial scope

The first server release should support a read-only SSH account and collect only approved metadata. It may inspect:

- operating system and package inventory
- users, groups, ownership, and permissions
- services, ports, processes, and scheduled jobs
- disk usage, oversized logs, caches, and backups
- web roots, domains, SSL configuration, and public files
- Laravel, PHP, Node, web-server, and cPanel or CloudLinux configuration indicators
- abandoned document roots and duplicate application installs
- unsupported versions and unsafe defaults
- exposed `.env`, backup, archive, log, or configuration files
- broken cron jobs and recurring operational errors

It must not read or display credential values, private keys, database contents, customer content, or unrelated personal files.

### Server safety model

Server Audit v0 must be strictly read-only.

It must never:

- restart or stop services
- modify firewall or DNS settings
- edit configuration files
- rotate secrets
- change ownership or permissions
- install or remove packages
- delete files or logs
- execute database writes

Later remediation support may be added only as approval-based runbooks with backups, preflight checks, change windows, command allowlists, and rollback commands.

### Server Audit delivery phases

#### Server Audit v0: read-only posture report

- constrained SSH collector
- explicit command allowlist
- redacted evidence bundle
- severity-ranked findings
- storage, permissions, services, SSL, version, and public-exposure checks
- no mutation capability

#### Server Audit v1: remediation planning

- proposed commands without execution
- backup requirements
- dependency and outage risks
- ordered change plan
- rollback plan for every action

#### Server Audit v2: approved execution

- individually approved actions only
- dry-run support where available
- backup verification
- health checks before and after changes
- immutable execution ledger
- automatic stop and rollback guidance on failure

## Shared Audit Principles

Repository Audit and Server Audit must share these product rules:

- deterministic checks first; AI explanations second
- evidence-backed findings rather than unsupported claims
- secret redaction by default
- least-privilege access
- clear separation between observation, recommendation, and execution
- no destructive action based only on model confidence
- explicit human approval for writes
- immutable audit history
- reproducible reports
- bounded scans with file, size, time, and command limits
- fail closed when permissions, evidence, or validation are incomplete

## Phase 1: Core Interpreter

Status: mostly complete.

Completed:

- CLI execution now defaults to `source -> diagnostics -> lexer -> parser -> AST -> AST runtime`
- `AstRuntime` evaluates parsed `Stmt` and `Expr` nodes directly
- Runtime values flow through the typed `Value` enum in the AST path
- Math, string joins, arrays, indexing, comparisons, function calls, and control flow run through the AST engine
- Parser-driven runtime support exists for:
   - `let`
   - `print`
   - `return`
   - functions
   - `if / else`
   - `while`
   - arrays
   - agent prototype blocks
- Runtime-relevant AST nodes retain source locations from lexer tokens
- Runtime errors render source line, column, caret, and hints where available
- Invalid numeric arithmetic and ordered comparisons return structured errors instead of coercing values to zero
- Invalid array/object/property access returns structured errors instead of silently returning `null`
- User-defined function calls validate argument counts
- Parser recovery synchronizes at statement boundaries to limit cascading diagnostics
- Deterministic golden tests cover the shipped examples without external internet

Remaining limitation:

- Imported files are flattened before parsing, so a diagnostic in imported content currently reports the combined source line and top-level filename rather than the original imported filename.

## Phase 2: Tighten Language Semantics

The first correctness and diagnostics milestone is complete. Future semantic work should build on the source-located AST runtime without changing the documented compatibility behavior for missing object properties (`null`) unless a deliberate language-version change is made.

## Phase 3: Expand The Language

Once the core is stable:

- `for` loops
- imports across files
- objects / records
- standard library modules
- file read / write APIs
- JSON parsing and encoding

Recommended order:

1. imports
2. standard library layout
3. file I/O
4. JSON
5. records / objects
6. `for` loops

That order keeps SolveLang useful for scripting before growing surface area.

## Phase 4: Tooling And DX

Tooling should follow the stabilized interpreter, not lead it.

- `cargo test` coverage for lexer, parser, evaluator, and runtime
- golden tests for example programs
- `solvec validate file.solve`
- `solvec run file.solve`
- formatter
- linter
- better CLI help and error output
- VS Code syntax highlighting

## Phase 5: Platform Features

These make sense only after the language core is predictable:

- HTTP server support
- routing and request handling
- HTML templates
- form parsing
- database support
- package manager

## Phase 6: AI-Native Runtime

The current agent syntax is only a local prototype. A real AI-native runtime needs:

- provider abstraction
- tool schema and permission model
- prompt and instruction handling
- structured input/output types
- network and secret management
- deterministic local testing for agent workflows

## Revised Short-Term Execution Plan

The next concrete implementation order should be:

1. Finish and stabilize the on-site Stripe payment and entitlement flow.
2. Restore green CI for the checkout pull request before merge or deployment.
3. Define the Repository Audit report schema, evidence model, redaction rules, and scan limits.
4. Build Repository Audit v0 as a read-only deterministic inventory and recommendation engine.
5. Add GitHub App or archive ingestion with least-privilege repository access.
6. Add Repository Audit v1 import, dependency, route, configuration, test, and documentation analysis.
7. Add approval-based cleanup branches only after read-only accuracy and rollback tests are proven.
8. Design Server Audit v0 around a read-only SSH collector and explicit command allowlist.
9. Pilot Server Audit on a controlled non-production host before any production use.
10. Continue language-runtime improvements without allowing audit-product work to bypass compiler correctness and test requirements.

## Long-Term Direction

SolveLang should become a simple, readable, safe, and AI-native language and analysis platform for:

- automation
- APIs
- web apps
- data workflows
- tool-using agents
- workflow preflight
- repository architecture and cleanup audits
- server posture and operational audits

The immediate engineering priority is stabilizing the payment flow, then delivering a read-only Repository Audit before attempting any live-server remediation capability.
