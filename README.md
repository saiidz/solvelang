# SolveLang

> **A readable, explainable workflow language designed for AI-assisted business processes.**

SolveLang is an early-stage language and tooling project for describing business workflows in a form that humans can read, engineers can review, and organizations can audit.

It is not another Zapier, no-code builder, or managed automation platform. Its purpose is to make workflow intent explicit: deterministic rules, AI-assisted decisions, tool access, approvals, expected outputs, and failure behavior.

## Why SolveLang exists

Business processes often live in one of three places:

- visual automation canvases that are fast to build but difficult to review and maintain,
- application code that is powerful but hides process intent behind implementation detail,
- prompts and agent configurations that can be hard to audit, test, or govern.

SolveLang explores a middle layer: a readable, source-controlled workflow definition that can be validated, explained, tested, and eventually adapted to different execution environments.

The long-term goal is not to replace every workflow engine. SolveLang may be most valuable as a specification, analysis, and explanation layer that works alongside established platforms.

## Current maturity

SolveLang is an **early beta and engineering prototype**.

The repository contains a working Rust lexer, parser, AST, interpreter, CLI, diagnostics, examples, deterministic browser tooling, and test-mode API infrastructure. It does **not** yet provide a stable language specification, production managed execution, enterprise orchestration, or a general integration marketplace.

Public claims should use these labels:

### Working today

- Rust lexer, parser, AST, and interpreter prototype
- CLI commands for running, validating, tokenizing, and inspecting ASTs
- conservative source-located semantic checks with `solvec check`
- variables, reassignment, conditions, loops, functions, arrays, objects, imports, JSON helpers, and pure collection/text helpers
- source-located parser and runtime diagnostics
- deterministic local execution
- hardened execution modes that deny network, file, environment, and agent capabilities
- a local-first Workflow Intelligence Studio with deterministic analysis
- a smaller browser-safe `/run` preview
- repository examples, tests, schemas, documentation, and launch-readiness controls

### Experimental

- HTTP GET and POST helpers
- file read/write helpers
- environment-variable access
- `agent`, `instruction`, `tool`, and `ask` syntax
- local AI fallback behavior
- optional OpenAI-backed responses
- Studio-to-`.solve` draft generation
- test-mode API keys, subscription billing, usage metering, and priority queue foundations

Experimental means implemented but unstable, narrow, provider-dependent, or not suitable for production promises.

### Planned

- stable language specification
- broader type checking
- package and module system beyond file imports
- additional AI providers
- production integrations
- runtime adapters for established orchestration platforms
- full hosted Rust runtime
- managed workflow execution
- production packaging and releases
- enterprise governance, durability, and observability

Planned capabilities are direction, not working product features.

## Quick start

### Requirements

- Git
- Rust and Cargo

### Install and run

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- check ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

Inspect tokens or the parsed AST:

```bash
cargo run -- tokens ../examples/hello.solve
cargo run -- ast ../examples/hello.solve
```

Build a release binary:

```bash
cargo build --release
./target/release/solvec run ../examples/hello.solve
```

## Example workflow

```solve
// Support ticket triage for a founder-led team.
let ticket = {
    customer: "Acme Labs",
    topic: "billing",
    priority: "urgent",
    plan: "pro"
}

print("Support triage")
print("Customer: " .. ticket.customer)

if ticket.priority == "urgent" {
    print("Action: escalate to founder today")
} else {
    print("Action: add to normal support queue")
}

if ticket.topic == "billing" {
    print("Owner: finance operations")
} else {
    print("Owner: support operations")
}
```

This example is intentionally deterministic. It demonstrates readable business rules without pretending that every decision requires AI.

Run it with:

```bash
cd solvec
cargo run -- run ../examples/support_triage.solve
```

## CLI commands

```text
solvec run <file.solve>       Run a SolveLang workflow
solvec validate <file.solve>  Parse and validate without executing
solvec check <file.solve>     Check conservative static semantics without executing
solvec tokens <file.solve>    Print lexer tokens
solvec ast <file.solve>       Print the parsed AST
solvec help                   Show CLI help
```

Backward-compatible token and AST flags are still supported:

```bash
solvec <file.solve> --tokens
solvec <file.solve> --ast
```

## Runtime safety

By default, `solvec run` executes trusted local scripts with the current runtime capabilities.

Use hardened execution when a workflow must be restricted to pure in-memory evaluation:

```bash
cargo run -- run --safe ../examples/hello.solve
```

Any of these options enables the strict policy:

- `--safe`
- `--dry-run`
- `--no-network`
- `--json`

Hardened execution denies sensitive capabilities before evaluation, including in unreachable branches and function bodies:

- network access
- file reads and writes
- environment access
- AI providers and agent use
- agent tools
- unknown or mutation-style functions

A successful hardened run is labeled `NON-PRODUCTION ADVISORY ONLY`.

For deterministic machine-readable execution:

```bash
cargo run -- run \
  --input ../examples/upcomingsounds/cli-contract-input.json \
  --json --safe --dry-run --no-network \
  ../examples/upcomingsounds/cli-contract.solve
```

See [`docs/runtime-safety.md`](docs/runtime-safety.md) for the complete policy.

## Architecture overview

SolveLang is organized around several related layers.

### 1. Canonical language runtime

`solvec/` contains the Rust implementation:

- lexer
- parser
- AST
- interpreter
- CLI
- runtime policy and diagnostics
- AI-provider boundary

The Rust CLI is the canonical validator and runtime.

### 2. Workflow Intelligence Studio

`site/app/studio/` contains a local-first browser workspace for:

- workflow modeling
- graph inspection
- deterministic analysis rules
- scenario simulation
- traces and quality indicators
- local version comparison
- evidence export

Studio analysis is deterministic, not AI analysis. Studio’s broader workflow model can generate preliminary `.solve` drafts, but those drafts must be validated with the Rust CLI.

### 3. Website and browser previews

`site/` contains the public website, documentation experiences, demos, account screens, and a limited browser-safe workflow preview.

The browser preview supports a smaller subset than the Rust runtime and should not be presented as equivalent to full hosted execution.

### 4. API-access prototype

`services/api-access/` contains test-mode serverless infrastructure for API keys, customer accounts, subscription lifecycle, quotas, and authorization.

This infrastructure is experimental and test-only. It is not a production managed API product.

### 5. Schemas, examples, and operations

- `examples/` — executable and illustrative workflows
- `schemas/` — machine-readable contracts and examples
- `docs/` — language, product, safety, launch, strategy, and service documentation
- `ops/` — launch and operational controls
- `packages/` and `plugins/` — supporting packages and extension experiments
- `.github/` — CI, deployment workflows, and repository automation

## Repository structure

```text
solvelang/
├── solvec/              Rust lexer, parser, AST, interpreter, and CLI
├── site/                Website, Studio, demos, and browser previews
├── services/            Test-mode API and supporting services
├── examples/            SolveLang workflows and demo assets
├── docs/                Product, language, safety, strategy, and operations docs
├── schemas/             JSON schemas and example payloads
├── packages/            Shared packages
├── plugins/             Extension experiments
├── ops/                 Operational and launch tooling
├── fixtures/            Test fixtures
└── .github/             CI and workflow automation
```

## Documentation

Start here:

- [Language reference](docs/language-reference.md)
- [Runtime safety](docs/runtime-safety.md)
- [Competitive analysis](docs/competitive-analysis.md)
- [Product strategy](docs/strategy.md)
- [Studio specification](docs/product/workflow-intelligence-studio-v1.md)
- [Workflow analysis rules](docs/product/workflow-analysis-rules.md)
- [Studio privacy model](docs/product/studio-privacy.md)
- [Launch readiness](docs/launch-readiness.md)

Live project resources:

- [Website](https://www.solve-lang.com/)
- [Resources](https://www.solve-lang.com/resources/)
- [Support triage demo](https://www.solve-lang.com/demo/support-triage/)
- [Workflow X-Ray audit intake](https://www.solve-lang.com/audit/)

## Development

### Rust runtime

```bash
cd solvec
cargo test
cargo run -- validate ../examples/support_triage.solve
```

### Website

```bash
cd site
npm install
npm run lint
npm run test:studio
npm run build
```

### API-access prototype

```bash
cd services/api-access
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

Do not deploy test infrastructure from an unreviewed branch.

## Contributing

SolveLang is evolving quickly, so small reviewable changes are preferred.

Before opening a pull request:

1. explain the problem being solved,
2. identify the affected layer,
3. keep working, experimental, and planned capabilities separate,
4. add or update tests for behavior changes,
5. update documentation when user-visible behavior changes,
6. avoid unrelated refactors in the same PR,
7. include exact validation commands and results.

Good contributions improve readability, diagnostics, safety, examples, documentation, and test coverage without expanding claims beyond the implementation.

## Limitations

SolveLang is not currently:

- a stable production language runtime
- a replacement for Zapier, Make, or n8n
- a durable execution engine comparable to Temporal
- a data orchestration platform comparable to Airflow
- a BPMN suite comparable to Camunda
- a production multi-agent platform
- a hosted integration marketplace
- an enterprise compliance product

Additional limitations include:

- integer-focused numeric behavior
- incomplete type checking
- narrow standard library
- basic module support through relative imports
- experimental provider and side-effect features
- limited browser runtime compatibility
- no published production reliability or performance benchmarks

## FAQ

### Is SolveLang a no-code automation platform?

No. SolveLang is a language and tooling project focused on readable, version-controlled workflow definitions.

### Does SolveLang execute workflows today?

Yes, the Rust CLI executes the currently supported language locally. A limited browser preview also exists. Full managed hosted execution is planned, not available today.

### Does SolveLang use AI?

The language includes experimental AI-agent syntax, local fallback behavior, and optional OpenAI-backed responses. Deterministic workflow logic does not require AI.

### Is Workflow Intelligence Studio AI-powered?

Its current analysis is deterministic and local-first. It should not be described as AI analysis.

### Can SolveLang replace my current automation platform?

That is not the current goal. A realistic early use is to document, review, and explain workflows that may ultimately run in another platform or custom system.

### Is the API subscription system production-ready?

No. The repository includes test-mode API-access and billing infrastructure for engineering validation.

### Why build a language instead of another visual builder?

Source text is diffable, reviewable, testable, portable, and easier to discuss in code review. The project is exploring whether those properties can make AI-assisted business workflows more understandable and maintainable.

## For recruiters and hiring managers

SolveLang demonstrates work across several senior technical dimensions.

### Language engineering

- lexer, parser, AST, and interpreter design
- runtime semantics and diagnostics
- source locations and error reporting
- imports, built-ins, and execution policy

### Systems and platform engineering

- Rust runtime implementation
- TypeScript and Next.js product surfaces
- AWS SAM serverless infrastructure
- DynamoDB transactions and consistency
- IAM least privilege
- API authentication, quotas, and billing lifecycle
- fail-closed configuration and deployment gates

### AI engineering

- explicit separation of deterministic and model-driven behavior
- provider boundaries and experimental agent syntax
- safety restrictions for network, files, environment, and tools
- usage and cost-aware API design
- explainability and audit-oriented workflow modeling

### Product and developer experience

- local-first workflow analysis tooling
- CLI design and diagnostics
- documentation architecture
- examples and demo design
- maturity labeling and honest product boundaries

### Technical product and consulting

- competitive analysis
- roadmap prioritization
- service-first commercialization strategy
- workflow discovery and implementation methodology
- translation of business-process needs into technical architecture

The repository is best evaluated as a combined language-runtime, developer-tooling, AI-workflow, cloud-platform, and product-strategy project—not as a claim that a finished SaaS already exists.

## Roadmap

The strategic roadmap is maintained in [`docs/strategy.md`](docs/strategy.md). The repository-level engineering roadmap remains in [`ROADMAP.md`](ROADMAP.md).

Near-term priorities are:

1. make the project easier to understand and demonstrate,
2. standardize truthful examples and maturity labels,
3. strengthen developer onboarding and documentation,
4. package recruiter and consulting materials,
5. improve engineering quality based on verified friction,
6. validate demand before committing to managed SaaS infrastructure.

## License

SolveLang is licensed under the terms in [`LICENSE`](LICENSE).
