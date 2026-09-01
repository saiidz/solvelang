# Contributing to SolveLang

SolveLang is an early beta workflow-language project. Contributions should preserve the distinction between **working today**, **experimental**, and **planned** capabilities.

## Before you start

Read these first:

1. `README.md` — product positioning and current maturity.
2. `docs/demo-status.md` — which surfaces are canonical, preview, experimental, or planned.
3. `docs/language-reference.md` — current executable syntax.
4. `docs/runtime-safety.md` — execution and capability boundaries.
5. `docs/development.md` — local setup and validation commands.
6. `docs/repository-map.md` — where major subsystems live.

## Development principles

- Preserve the current architecture unless a change has a concrete technical reason.
- Do not add a feature only to make the project look broader.
- Do not describe planned work as implemented.
- Prefer small pull requests with one clear purpose.
- Add or update tests for behavior changes.
- Keep the Rust CLI as the canonical executable runtime unless the architecture explicitly changes in a reviewed decision.
- Treat the browser `/run` page as a smaller safe preview, not as proof of full runtime support.
- Treat Workflow Intelligence Studio as a deterministic local-first analysis surface whose workflow model is broader than executable SolveLang syntax.
- Preserve fail-closed behavior in hardened execution paths.
- Do not weaken IAM, secret handling, input validation, or deployment gates for convenience.

## Quick local setup

### Rust runtime

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/solvec
cargo test
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

### Website and Studio

```bash
cd site
npm install
npm run lint
npm run test:studio
npm run build
```

To run the site locally:

```bash
npm run dev
```

### API access service

This subsystem is experimental/test-mode infrastructure. Do not deploy it as part of ordinary contribution validation.

```bash
cd services/api-access
npm install --ignore-scripts --no-audit --no-fund
npm test
```

If AWS SAM CLI is installed:

```bash
sam validate --lint --template template.yaml
sam build --template template.yaml
```

## Choosing where to make a change

| Change | Primary location |
|---|---|
| Lexer/token behavior | `solvec-core/src/lexer.rs` |
| Parser/AST behavior | `solvec-core/src/parser.rs`, `solvec-core/src/ast.rs` |
| Runtime semantics | `solvec/src/ast_runtime.rs`, `solvec-core/src/value.rs` |
| CLI/options/policy setup | `solvec/src/main.rs` |
| AI provider prototype | `solvec/src/ai.rs` |
| Language docs | `docs/language-reference.md` |
| Runtime safety docs | `docs/runtime-safety.md` |
| Business workflow examples | `docs/examples/` and `examples/` |
| Website/browser preview | `site/app/` |
| Studio | `site/app/studio/` and related core modules |
| API key/subscription test infrastructure | `services/api-access/` |
| AWS SAM resources for API access | `services/api-access/template.yaml` |

See `docs/repository-map.md` for more context.

## Pull request expectations

A good SolveLang PR should answer:

- What problem does this change solve?
- Why is it needed now?
- Which files changed?
- What behavior changed?
- What tradeoffs were made?
- Is the capability working, experimental, or planned?
- What validation was run?
- Does it change security, side effects, network access, billing, or deployment behavior?

Prefer a focused PR over a broad cleanup that mixes unrelated work.

## Runtime behavior changes

When changing executable syntax or semantics:

1. Add or update unit/integration tests.
2. Update `docs/language-reference.md` if user-visible behavior changes.
3. Add or update an example when useful.
4. Verify diagnostics remain source-located and actionable.
5. Check hardened execution behavior when the change touches I/O, networking, agents, environment access, imports, or unknown functions.

Minimum validation:

```bash
cd solvec-core
cargo fmt --check
cargo test
cd ../solvec
cargo fmt --check
cargo test
cargo run -- validate ../examples/support_triage.solve
```

## Website and Studio changes

Minimum validation:

```bash
cd site
npm run lint
npm run test:studio
npm run build
```

A website presentation must not imply that a demonstration flow is an integrated production workflow unless the repository contains and validates that integration.

## API access changes

Minimum local validation:

```bash
cd services/api-access
npm test
```

For SAM template changes, also run when available:

```bash
sam validate --lint --template template.yaml
sam build --template template.yaml
```

Do not deploy test infrastructure merely to prove a documentation or unit-test change.

## Documentation language

Use these labels consistently:

- **Working today** — implemented and reproducibly testable now.
- **Preview** — intentionally limited demonstration surface.
- **Experimental** — implemented but unstable, narrow, provider-dependent, or not suitable for production promises.
- **Planned** — roadmap direction without a working implementation.

Avoid claims about production readiness, uptime, scale, customers, adoption, benchmarks, revenue, or performance unless there is verifiable evidence in the repository or approved external evidence.

## Commit and PR scope

There is no required commit-message convention today. Use clear imperative or descriptive messages and keep commits understandable.

Examples:

```text
Add parser coverage for nested conditions
Clarify hardened import restrictions
Document support-triage demo boundary
```

## Security-sensitive changes

Treat the following as security-sensitive:

- execution-policy changes
- capability allow flags
- filesystem or import boundaries
- HTTP behavior
- environment access
- agent/tool execution
- API authentication
- API keys
- IAM policies
- Stripe/webhook behavior
- deployment gates

Prefer least privilege and fail-closed behavior. Never commit credentials, API keys, webhook secrets, payment data, or private customer information.

## Reporting a problem

For ordinary bugs, open a GitHub issue with a minimal reproduction, expected behavior, actual behavior, and environment details.

For a security issue, do not publish exploitable secrets or sensitive data in a public issue. Use the repository's configured private security-reporting channel when available.
