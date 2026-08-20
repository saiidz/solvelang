# SolveLang Developer Setup

This guide is the fastest path from a fresh clone to understanding and validating the main SolveLang subsystems.

Target: a new contributor should be productive in under 15 minutes.

## 1. Understand the product boundary

SolveLang is an early beta project positioned as:

> A readable, explainable workflow language designed for AI-assisted business processes.

The repository contains several surfaces with different maturity levels:

- **Canonical runtime:** Rust CLI in `solvec/`.
- **Browser preview:** a deliberately smaller browser-safe subset under the website `/run` route.
- **Workflow Intelligence Studio:** deterministic local-first workflow modeling and analysis with a broader model than executable syntax.
- **API access:** experimental/test-mode account, key, subscription, and usage infrastructure.

Before changing behavior, read `docs/demo-status.md` and `docs/language-reference.md`.

## 2. Prerequisites

For the Rust runtime:

- Git
- Rust toolchain with Cargo

For the website and Studio:

- Node.js compatible with the repository's current Next.js toolchain
- npm

For API infrastructure validation:

- Node.js and npm
- AWS SAM CLI only when validating/building the SAM template

AWS credentials are not required for ordinary local documentation, Rust, website, Studio, or unit-test work.

## 3. Clone and inspect

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang
```

Start with:

```text
README.md
CONTRIBUTING.md
docs/demo-status.md
docs/repository-map.md
docs/language-reference.md
```

## 4. Run the canonical workflow

```bash
cd solvec
cargo test
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

The support-triage example is intentionally deterministic. It demonstrates readable business rules without pretending that inbox, CRM, Slack, or ticketing integrations are connected.

The `solvec` package also exposes the canonical lexer, parser, diagnostics, formatter, semantic checker, and runtime modules as a shared Rust library. The CLI consumes those same APIs; future editor tooling must use this library rather than duplicate language behavior.

The experimental `solvelsp` stdio binary currently supports full-document open diagnostics plus parser-backed document symbols, top-level go-to-definition, hover, same-name source highlights, and top-level-symbol completion for documents opened in the current session. Incremental changes, workspace access, and execution are intentionally not implemented.

Useful CLI inspection commands:

```bash
cargo run -- tokens ../examples/support_triage.solve
cargo run -- ast ../examples/support_triage.solve
cargo run -- fmt ../examples/support_triage.solve
cargo run -- fmt --check ../examples/support_triage.solve
cargo run -- help
```

`fmt` validates the named source file before writing it, normalizes line endings
to LF, and uses a raw token-oriented layer so comments and string escapes are
not reconstructed from the comment-free AST. `fmt --check` makes no changes and
exits nonzero when the file is not already canonical.

`lint` is also read-only. It reports only source-located structural warnings and
does not execute a workflow, select an execution policy, or turn warnings into
nonzero status.

## 5. Understand safe execution

A normal `solvec run` is for trusted local scripts and can expose runtime capabilities such as file, network, environment, and experimental agent behavior.

Use hardened execution when you need a constrained local evaluation:

```bash
cargo run -- run --safe ../examples/hello.solve
```

Hardened modes include `--safe`, `--dry-run`, `--no-network`, and `--json`. See `docs/runtime-safety.md` before changing capability checks.

## 6. Website and Studio

```bash
cd ../site
npm install
npm run lint
npm run test:studio
npm run build
```

Run locally:

```bash
npm run dev
```

Important distinction:

- the website can present workflow concepts and demos;
- `/run` executes only a smaller browser-safe subset;
- Studio performs deterministic workflow analysis and simulation;
- neither surface should be described as equivalent to full hosted Rust execution.

## 7. API access service

The API access subsystem is experimental/test-mode infrastructure. It should not be treated as evidence of a production public API.

```bash
cd ../services/api-access
npm install --ignore-scripts --no-audit --no-fund
npm test
```

If your change touches `template.yaml` and AWS SAM CLI is installed:

```bash
sam validate --lint --template template.yaml
sam build --template template.yaml
```

Do not run `sam deploy` as part of routine contributor validation.

## 8. Common validation matrix

| Area changed | Minimum validation |
|---|---|
| Rust lexer/parser/runtime | `cargo fmt --check`, `cargo test` |
| Executable example | `cargo run -- validate <file>` and, when safe, `cargo run -- run <file>` |
| Runtime safety | Rust tests plus targeted hardened-mode checks |
| Website | `npm run lint`, `npm run build` |
| Studio | `npm run lint`, `npm run test:studio`, `npm run build` |
| API access JS | `npm test` |
| API SAM template | `npm test`, `sam validate --lint`, `sam build` |
| Documentation only | verify paths, commands, maturity labels, and links |

## 9. Where to start by task

### Add or fix syntax

Read:

- `solvec/src/lexer.rs`
- `solvec/src/parser.rs`
- `solvec/src/ast.rs`
- `docs/language-reference.md`

### Change runtime behavior

Read:

- `solvec/src/ast_runtime.rs`
- `solvec/src/value.rs`
- `solvec/src/main.rs`
- `docs/runtime-safety.md`

### Work on AI behavior

Read:

- `solvec/src/ai.rs`
- agent-related parser/runtime tests
- `docs/language-reference.md`

Treat provider-backed behavior as experimental unless the repository status changes through explicit reviewed work.

### Work on Studio

Start in:

- `site/app/studio/`
- related `core` modules and tests under the site application
- `docs/product/`

### Work on API access

Start in:

- `services/api-access/src/`
- `services/api-access/test/`
- `services/api-access/template.yaml`

## 10. Error-message standard

Contributor-facing and runtime errors should answer as many of these as possible:

1. What failed?
2. Where did it fail?
3. Why did it fail?
4. What can the user do next?

For language/runtime errors, preserve source line, column, snippet, caret, and actionable hint when available.

For security-sensitive errors, do not expose credentials, full secrets, private request bodies, or unnecessary filesystem details in machine-readable output.

## 11. Configuration standard

- Prefer explicit configuration over hidden behavior.
- Document environment variables near the feature that consumes them.
- Do not introduce a new environment variable if a typed/defaulted configuration path already exists.
- Never commit `.env` secrets.
- Keep test-only infrastructure visibly test-only.

## 12. Pull request workflow

Before opening a PR:

1. Rebase or branch from the intended predecessor.
2. Keep the change focused.
3. Run the relevant validation matrix.
4. Update documentation when behavior changes.
5. State whether the result is working, preview, experimental, or planned.
6. State security/deployment impact.
7. Do not deploy unless the task explicitly requires deployment.

See `CONTRIBUTING.md` for the full contribution expectations.

## 13. First 15-minute checklist

A new contributor should be able to complete this sequence:

```text
[ ] Read README.md
[ ] Read docs/demo-status.md
[ ] Open docs/repository-map.md
[ ] Run cargo test in solvec/
[ ] Validate examples/support_triage.solve
[ ] Run examples/support_triage.solve
[ ] Identify which subsystem owns the intended change
[ ] Read the relevant focused documentation
```

If this sequence becomes inaccurate, update this guide in the same PR that changes the workflow.
