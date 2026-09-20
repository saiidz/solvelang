# SolveLang

> **A readable, explainable workflow language and local-first analysis toolkit for AI-assisted business and coding workflows.**

SolveLang is an early-stage language and tooling project for describing business workflows in a form that humans can read, engineers can review, and organizations can audit. The repository also contains local-first audit/graph tooling, Codex/Claude MCP integration, and the separate **Solve Context** context-selection product layer.

It is not another Zapier, no-code builder, or managed automation platform. Its purpose is to make workflow intent explicit: deterministic rules, AI-assisted decisions, tool access, approvals, expected outputs, failure behavior, and reviewable evidence.

## Why SolveLang exists

Business processes often live in one of three places:

- visual automation canvases that are fast to build but difficult to review and maintain,
- application code that is powerful but hides process intent behind implementation detail,
- prompts and agent configurations that can be hard to audit, test, or govern.

SolveLang explores a middle layer: readable, source-controlled definitions and evidence that can be validated, explained, tested, and eventually adapted to different execution environments.

The long-term goal is not to replace every workflow engine. SolveLang may be most valuable as a specification, analysis, context and explanation layer that works alongside established platforms.

## Current maturity

SolveLang is an **open-source workflow intelligence product** with a versioned local runtime, browser Studio, and production API/account infrastructure. General managed workflow execution remains gated. This README was reconciled on **2026-09-15** against repository state through PR **#920**. Live GitHub state always wins if that checkpoint becomes stale.

The repository contains a working Rust lexer, parser, AST, interpreter, CLI, diagnostics, implementation-backed 0.1 language specification, explicit local modules, browser/WASM tooling, Workflow Intelligence Studio, bounded Repository/Server Audit surfaces, Self-Driving safety/execution contracts, a substantially implemented Solve Context layer, and a separately deployed production customer-account/API/Admin/TOTP foundation.

It does **not** yet provide a stable 1.0 language contract, production managed workflow execution, enabled subscription billing/paid priority, a generally activated support/provider service, a public current-main Solve Context release, enterprise orchestration, or a general integration marketplace.

Public claims should use these labels.

### Working today

- Rust lexer, parser, AST, and interpreter prototype
- CLI commands for running, validating, checking, linting, formatting, tokenizing, and inspecting ASTs
- conservative source-located semantic checks with `solvec check`
- conservative source-located workflow warnings with `solvec lint`
- variables, reassignment, conditions, loops, functions, arrays, objects, JSON helpers, and pure collection/text helpers
- legacy relative-file compatibility includes plus explicit local modules with exports, namespace imports, named imports, live read-only bindings, and deterministic local graph validation
- source-located parser and runtime diagnostics, including imported/module provenance
- deterministic local execution
- hardened execution modes that deny network, file, environment, and agent capabilities
- a local-first Workflow Intelligence Studio with deterministic analysis
- a bounded browser-safe `/run` preview backed by the pinned audited WASM handoff; native `solvec` remains canonical and this is not managed execution
- bounded read-only Repository Audit / Solve Graph and Server Audit product surfaces
- a pure Rust evaluator core and deny-all WASM wrapper with shared conformance and deterministic limits
- repository-safe Self-Driving Observe/Suggest, patch/preflight, single-use execution-plan/finalization, GitHub-write and PostHog safety contracts; live provider activation and production rollout remain separately gated
- **Solve Context** plan/pack/retrieve tools, content-addressed retrieval, Claude ↔ Codex handoff, lossless JSON/log/diff compaction, changed-path + supplied-graph ranking, pinned real-source regressions and strict agent-measurement record/report contracts through #913–#920
- repository-qualified connected-support code with native IMAP/SMTP plus optional Gmail, durable event/action state, safe cutover/recovery, account controls and monitoring preparation; live activation remains separate
- production API access, customer password accounts, and private Admin/TOTP infrastructure recorded by separate production evidence; these do not imply managed workflow execution or billing is live
- repository examples, tests, schemas, documentation, and launch-readiness controls

### Experimental

- HTTP GET and POST helpers
- file read/write helpers
- environment-variable access
- `agent`, `instruction`, `tool`, and `ask` syntax
- local AI fallback behavior
- optional OpenAI-backed responses
- Studio-to-`.solve` draft generation
- Solve Context selection/compaction quality beyond the committed regression fixtures
- subscription-billing, paid-priority, provider-execution, support-provider activation and managed-execution foundations that remain gated/off in production

Experimental means implemented but unstable, narrow, provider-dependent, not yet broadly distributed, or not suitable for production promises.

Repository validation includes hosted CI plus path-specific Rust/RustSec, WASM, MCP and trusted self-hosted lanes. CI-runner availability is not a released-platform support claim. **Solve Runners / Solblend remains a separate deferred product**, not an enabled SolveLang execution service.

### Planned / projected

Projection means direction, not a promised date or unsupported completion percentage.

- broader independent/blinded Solve Context evaluation and separately authorized real Claude/Codex baseline-vs-context measurements
- a future versioned MCP/plugin distribution containing current-main Solve Context capabilities
- enforced required checks/reviews on `main` rather than manual discipline only
- a separately reviewed stable 1.0 language contract
- broader type checking
- local package metadata and any future package ecosystem beyond the implemented explicit local-module subset
- additional AI providers and production integrations
- runtime adapters for established orchestration platforms
- full hosted Rust runtime / managed workflow execution only after its own product and safety gates
- owner-authorized public version selection/publication and exact-platform release artifacts beyond current Linux x86_64 evidence
- enterprise governance, durability, and observability

See [`ROADMAP.md`](ROADMAP.md) and [`docs/project-completion-plan.md`](docs/project-completion-plan.md) for the current active queue and completion gates.

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

## Solve Context and MCP usage

### Published package truth

The latest published GitHub MCP Server release is **v0.2.0 (2026-07-20)**. Current repository source contains substantial MCP/Solve Context capabilities added after that release. Therefore `@solvelang/mcp-server@0.2.0` must be treated as the historical published package line, **not** as proof that public consumers receive current-main #913–#920 behavior.

### Use current repository source

To evaluate current-main MCP/Solve Context behavior from a source checkout:

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/packages/mcp-server
npm ci
npm run build
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace node dist/src/index.js
```

Current source exposes read-only Solve Context tools including:

- `solvelang_context_plan`
- `solvelang_context_pack`
- `solvelang_context_retrieve`
- `solvelang_context_handoff`
- `solvelang_context_handoff_validate`
- `solvelang_context_compact_structured`
- `solvelang_context_expand_rle`
- `solvelang_context_capabilities`

The MCP server remains local/read-only by default for these context operations. A hosted remote endpoint, provider proxy, repository write path or production deployment is a separate authority boundary.

### Run Solve Context evaluations

From `packages/mcp-server`:

```bash
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
```

The first command is synthetic. The repository/independent suites use pinned source snapshots. None of them is a real Claude/Codex token-savings result.

To summarize separately collected approved real-agent records:

```bash
cat approved-agent-run-records.json | npm run eval:context:agent-records
```

The summarizer itself performs no provider/network call and uses no credentials. Real records must use the same fixture/provider/model/agent/record class, outcome basis and required-evidence denominator across baseline and Solve Context arms. Public percentage/comparative claims remain disabled until the full acceptance matrix is complete.

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

## Explicit local modules

SolveLang 0.1 supports local modules while keeping the older flattened include form as a distinct compatibility mechanism.

```solve
// math.solve
let private_offset = 10
export let base = 4
export fn add(left, right) {
    return left + right + private_offset
}
```

```solve
// entry.solve
import "math.solve" as math
import { base as starting_value } from "math.solve"

print(math.add(starting_value, 2))
```

Explicit modules expose only exported names, keep importer bindings read-only/live, validate the complete local graph before execution, and do not introduce a registry, remote fetch, dependency installer, or package manager. See [`SPEC.md`](SPEC.md) and [`docs/adr/0003-explicit-local-module-syntax.md`](docs/adr/0003-explicit-local-module-syntax.md).

## CLI commands

```text
solvec run <file.solve>       Run a SolveLang workflow
solvec validate <file.solve>  Parse and validate without executing
solvec check <file.solve>     Check conservative static semantics without executing
solvec lint <file.solve>      Report conservative warnings without executing
solvec fmt [--check] <file.solve>  Format source without changing meaning
solvec tokens <file.solve>    Print lexer tokens
solvec ast <file.solve>       Print the parsed AST
solvec help                   Show CLI help
```

Backward-compatible token and AST flags are still supported:

```bash
solvec <file.solve> --tokens
solvec <file.solve> --ast
```

The canonical `solvec version` command and non-publishing release-candidate/tag-regeneration gates are implemented. No new public CLI version/tag/release is selected or published merely by those gates, and current repository native artifact evidence is Linux x86_64 only; see [`docs/release-candidate-dry-run.md`](docs/release-candidate-dry-run.md) and [`docs/tagged-release-regeneration.md`](docs/tagged-release-regeneration.md).

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

### 1. Canonical language runtime

`solvec-core/` owns the host-incapable Rust language modules. `solvec/` provides filesystem-backed local modules, host adapters, CLI, runtime policy and the AI-provider boundary. The Rust CLI is canonical.

### 2. Workflow Intelligence Studio

`site/app/studio/` is a local-first browser workspace for workflow modeling, graph inspection, deterministic analysis, scenarios, traces, local version comparison and evidence export. Its current analysis is deterministic, not model-generated analysis.

### 3. Website and browser preview

`site/` contains the public website, docs experiences, demos, account screens and the bounded `/run` browser preview. `/run` uses the reviewed pinned same-origin hash-verified WASM handoff and is not managed/server execution.

### 4. Repository Audit / Solve Graph / Server Audit

These surfaces provide bounded read-only static/system evidence, graph explanations and reports. They do not execute repository source or grant remediation authority.

### 5. Codex/Claude MCP and Solve Context

`packages/mcp-server/` and `plugins/` contain the shared read-only MCP path. Solve Context performs bounded context selection, packing, retrieval, handoff and correctness-first structured compaction. The measurement harness validates supplied records; it does not launch agents or call providers.

### 6. Account/API/Admin foundation

`services/api-access/` and related infrastructure contain API-key, customer-account, authentication, Admin, billing-readiness and priority-readiness paths. Separately verified production evidence records API access, customer password accounts, private Admin and TOTP infrastructure as live. Billing, paid priority/provider execution and general managed workflow execution remain off/not established live.

### 7. Connected support

Repository code supports the existing SolveLang mailbox through native IMAP/SMTP plus optional Gmail with durable bounded processing/recovery controls. Deployment, credentials and live task/reply canaries are separate gates.

## Repository structure

```text
solvelang/
├── solvec-core/         Host-incapable Rust language core
├── solvec/              Native interpreter, host adapters, and CLI
├── site/                Website, Studio, demos, and browser previews
├── services/            API/account and supporting services
├── packages/            MCP and shared packages
├── plugins/             Codex/Claude integration bundles
├── examples/            SolveLang workflows and demo assets
├── docs/                Product, language, safety, strategy, and operations docs
├── schemas/             JSON schemas and example payloads
├── ops/                 Operational and launch tooling
├── fixtures/            Test fixtures
└── .github/             CI and workflow automation
```

## Documentation

Start here:

- [Active engineering roadmap](ROADMAP.md)
- [Active buildout handoff](docs/active-buildout-handoff.md)
- [Project completion plan](docs/project-completion-plan.md)
- [0.1 language specification](SPEC.md)
- [Language reference](docs/language-reference.md)
- [Runtime safety](docs/runtime-safety.md)
- [Release contract](docs/release-contract.md)
- [Solve Context v0](docs/product/solve-context-v0.md)
- [Solve Context evals](docs/product/solve-context-evals-v0.md)
- [Codex/Claude MCP integration](docs/integrations/mcp-codex-claude.md)
- [Production readiness](docs/production-readiness.md)
- [Product strategy](docs/strategy.md)

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
npm ci
npm run test:studio
npm run lint
npm run build
```

### MCP / Solve Context

```bash
cd packages/mcp-server
npm ci
npm test
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
npm run test:plugin-roundtrip
npm run test:packed
```

### API/account services

```bash
cd services/api-access
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

Do not deploy production infrastructure from an unreviewed branch or infer deployment authorization from a repository merge.

## Contributing

SolveLang evolves quickly, so small reviewable changes are preferred. Before opening a PR: explain the problem, identify the affected layer, separate implemented/experimental/planned claims, add tests for behavior changes, update user-visible docs, avoid unrelated refactors, and include exact validation evidence.

## Limitations

SolveLang is not currently:

- a stable 1.0 production language/runtime contract
- a replacement for Zapier, Make, n8n, Temporal, Airflow or Camunda
- a production multi-agent platform
- a hosted integration marketplace
- an enterprise compliance product
- a generally live managed workflow execution service

Additional limitations include integer-focused numeric behavior, incomplete type checking, a narrow standard library, local explicit modules only, experimental provider/side-effect features, bounded browser-runtime compatibility, and no published real-agent Solve Context performance benchmark.

## FAQ

### Does SolveLang execute workflows today?

Yes. The Rust CLI executes the supported language locally, and a bounded browser preview exists. General managed hosted workflow execution is not live.

### What is Solve Context?

Solve Context is a separate local-first product layer for Claude Code/Codex context planning, exact context packs, retrieval, handoff and correctness-first compaction. It is implemented in repository source but not yet proven with complete real-agent/provider measurements or distributed through a new public version after v0.2.0.

### Does Solve Context save tokens?

The repository has synthetic and pinned-source byte/evidence regressions, not a complete real-agent provider-token benchmark. Do not convert excerpt-byte reduction into a public token-savings percentage.

### Is the published MCP v0.2.0 the same as current `main`?

No. v0.2.0 is the latest published historical MCP release and predates substantial current-main MCP/Solve Context work. Use source checkout instructions for current repository behavior until a new version is separately published.

### Is Workflow Intelligence Studio AI-powered?

Its current analysis is deterministic and local-first. It should not be described as AI analysis.

### Is the account/API system production-ready?

A limited customer-account/API/Admin/TOTP foundation is separately deployed and verified. The broader SaaS is not fully launched: subscription billing, paid priority/provider execution, connected-support activation and general managed execution remain separately gated.

## For recruiters and hiring managers

SolveLang demonstrates work across language/runtime engineering, Rust/TypeScript product surfaces, AWS serverless infrastructure, deterministic analysis/graph tooling, MCP/agent integration, context-selection/evaluation engineering, security/authority boundaries, release engineering and technical product strategy.

The repository is best evaluated as a combined language-runtime, developer-tooling, audit/intelligence, AI-context, cloud-platform and product-strategy project—not as a claim that a finished SaaS already exists.

## Roadmap

The repository-level engineering roadmap is [`ROADMAP.md`](ROADMAP.md). Strategic product material remains in [`docs/strategy.md`](docs/strategy.md).

Current priorities are:

1. prove Solve Context with broader independent and real-agent evidence without weakening quality gates;
2. enforce required checks/reviews on `main`;
3. qualify a future versioned current-main MCP/plugin distribution;
4. keep browser/WASM, language/spec and audit truth implementation-backed;
5. activate support/PostHog/billing/priority only through their separate protected gates;
6. add exact macOS/Windows native release evidence before cross-platform claims.

## License

SolveLang is licensed under the terms in [`LICENSE`](LICENSE).
