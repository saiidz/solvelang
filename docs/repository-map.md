# SolveLang Repository Map

This document explains the major repository areas, their maturity, and where contributors should start.

## Top-level map

```text
solvelang/
├── solvec-core/             # Host-incapable Rust language core
├── solvec/                  # Canonical native Rust CLI/runtime
├── examples/                # Executable and scenario examples
├── docs/                    # Product, runtime, strategy, demo, and business documentation
├── site/                    # Website, browser preview, Studio, account UI
├── services/api-access/     # Experimental/test-mode API access and billing infrastructure
├── packages/                # Shared or supporting package code
├── plugins/                 # Plugin-related project work
├── schemas/                 # Shared schemas/contracts
├── fixtures/                # Test and example fixtures
├── ops/                     # Operational tooling and evidence
├── ROADMAP.md               # Historical/current project roadmap material
└── SPEC.md                  # Early language specification material
```

This map describes current repository organization; it does not imply every directory represents production-ready functionality.

## `solvec-core/` and `solvec/` — canonical Rust implementation

**Status:** Working today, early beta.

`solvec-core/` owns pure language representation, analysis, deterministic evaluation, and path-free in-memory module state. The native Rust CLI in `solvec/` remains the canonical executable surface, supplies explicit host adapters, and re-exports the pure language modules under their existing Rust paths.

Important files:

- `solvec-core/src/lexer.rs` — tokenization and source scanning.
- `solvec-core/src/parser.rs` — parser and syntax diagnostics.
- `solvec-core/src/ast.rs` — syntax tree structures.
- `solvec-core/src/value.rs` — canonical value representation and conversion behavior.
- `solvec-core/src/diagnostics.rs` — source-located diagnostics.
- `solvec-core/src/evaluator.rs` — deterministic evaluation, limits, typed host requests, and transactional module state.
- `solvec/src/ast_runtime.rs` — native compatibility façade and execution policy.
- `solvec/src/native_host.rs` — native filesystem, environment, HTTP, provider, and stdout adapters.
- `solvec/src/ai.rs` — experimental AI/provider behavior.
- `solvec/src/main.rs` — CLI parsing, validation/run dispatch, hardened-mode setup, input/import policy.

Start here for language, CLI, runtime, diagnostic, or execution-policy changes.

## `examples/` — executable examples

**Status:** Mixed; validate each example against the canonical CLI.

The most useful first example is:

```text
examples/support_triage.solve
```

Validate before assuming an example is current:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
```

Business-facing explanatory examples live separately under `docs/examples/` so documentation can describe planned integrations without pretending they are executable.

## `docs/` — product and engineering documentation

Key entry points:

- `strategy.md` — product, technical, revenue, and marketing strategy.
- `competitive-analysis.md` — ecosystem analysis and positioning boundaries.
- `demo-status.md` — canonical truth source for demo maturity.
- `development.md` — local contributor setup.
- `language-reference.md` — current executable syntax.
- `runtime-safety.md` — hardened execution and capability boundaries.
- `examples/` — portfolio-ready business workflow narratives.
- `product/` — Studio/product specifications and related technical design.

Documentation should distinguish Working today, Preview, Experimental, and Planned behavior.

## `site/` — website, preview, Studio, and account UI

**Status:** Mixed.

This Next.js application contains multiple distinct surfaces.

### Marketing/documentation pages

These explain SolveLang and its services. They must not overstate runtime or integration maturity.

### Browser `/run` preview

**Status:** Preview.

The browser preview intentionally implements a smaller safe subset. It does not prove full Rust runtime compatibility and does not call the server for execution.

### Workflow Intelligence Studio

**Status:** Working today for deterministic local-first modeling/analysis, with broader workflow concepts than executable SolveLang syntax.

Start under:

```text
site/app/studio/
```

Studio-generated `.solve` output should be treated as a preliminary draft and validated with `solvec`.

### Account/API UI

**Status:** Experimental/test-mode where it depends on API-access subscription, key, usage, or billing infrastructure.

Do not infer public production API maturity from the presence of account screens.

## `services/api-access/` — API access infrastructure

**Status:** Experimental/test-mode.

Contains:

- Node.js service logic
- API-key/account/subscription behavior
- usage metering
- Stripe-related test-mode subscription flows
- DynamoDB access
- AWS SAM infrastructure
- unit/regression tests

Key locations:

```text
services/api-access/src/
services/api-access/test/
services/api-access/template.yaml
```

Changes here often have security and billing implications. Preserve least privilege, explicit test gates, and fail-closed behavior.

## `schemas/`

**Status:** Supporting contracts; inspect consumers before changing.

Schema changes can affect multiple subsystems. Search for all consumers and update tests/fixtures together.

## `fixtures/`

**Status:** Test/supporting data.

Keep fixtures deterministic and free of credentials or private customer data.

## `ops/`

**Status:** Operational tooling/evidence; maturity varies by tool.

Do not treat an operational checklist or readiness script as proof of production readiness by itself.

## `packages/` and `plugins/`

**Status:** Supporting/experimental depending on package.

Inspect the package README, tests, and consumers before changing behavior. Avoid broad package moves solely for cosmetic folder consistency.

## Source-of-truth hierarchy

When two surfaces disagree, use this order:

1. Executable tests and current code.
2. `docs/language-reference.md` for supported language behavior.
3. `docs/runtime-safety.md` for execution-policy behavior.
4. `docs/demo-status.md` for maturity and demo labeling.
5. README/product documentation.
6. Roadmap/planning documents.

A roadmap never overrides what the implementation actually supports.

## Naming conventions

Current repository naming is mixed because the project has evolved. For new work:

- prefer descriptive lowercase kebab-case Markdown filenames;
- use existing Rust naming conventions in `solvec`;
- follow existing TypeScript/React conventions in `site`;
- preserve established service naming in `services/api-access` unless a focused refactor justifies a rename;
- do not rename directories merely to create visual symmetry.

## Before moving files

Folder reorganization has a real cost: imports, docs, CI, scripts, URLs, and contributor muscle memory can all break.

Only move a file when at least one is true:

- ownership is genuinely unclear;
- the current path causes repeated contributor errors;
- the move enables a concrete architectural boundary;
- the current path conflicts with a documented convention.

A cosmetic move alone is not enough.

## Fast task routing

| I want to… | Start here |
|---|---|
| add syntax | `solvec-core/src/lexer.rs`, `solvec-core/src/parser.rs`, `solvec-core/src/ast.rs` |
| change pure evaluation | `solvec-core/src/evaluator.rs` |
| change native host behavior | `solvec/src/native_host.rs`, `solvec/src/ast_runtime.rs` |
| improve CLI behavior | `solvec/src/main.rs` |
| change runtime values/JSON | `solvec-core/src/value.rs`, `solvec-core/src/evaluator.rs` |
| change AI provider prototype | `solvec/src/ai.rs` |
| add executable example | `examples/` |
| add business/demo narrative | `docs/examples/` |
| change website | `site/app/` |
| change Studio | `site/app/studio/` |
| change API auth/billing/usage | `services/api-access/` |
| change AWS API resources | `services/api-access/template.yaml` |
| change maturity claims | `docs/demo-status.md` and relevant product docs |

## Related docs

- `CONTRIBUTING.md`
- `docs/development.md`
- `docs/demo-status.md`
- `docs/language-reference.md`
- `docs/runtime-safety.md`
- `docs/strategy.md`
