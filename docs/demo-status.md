# SolveLang Demo Status

_Last updated: 2026-08-06._

This document is the canonical guide for demonstrating SolveLang honestly.

SolveLang currently has several distinct surfaces: a Rust CLI runtime, a browser-safe preview, a local-first Workflow Intelligence Studio, a support-triage presentation page, and experimental test-mode API infrastructure. They are useful for different purposes and should not be presented as equivalent.

> **SolveLang is a readable, explainable workflow language designed for AI-assisted business processes.**

## What a recruiter should click first

### 1. Repository README

Start with the README for the shortest explanation of the product, architecture, maturity, and technical scope.

What it demonstrates:

- product positioning and technical communication
- language and runtime engineering
- clear separation of working, experimental, and planned capabilities
- architecture and repository organization

### 2. Support triage demo

Open:

- https://www.solve-lang.com/demo/support-triage/

What it demonstrates:

- a business problem explained in operational terms
- readable routing, ownership, and escalation rules
- explicit human review
- example outputs and business value

Important limitation:

The page is a presentation experience. It does not prove that email, Slack, CRM, or task-management integrations are connected in production.

### 3. Canonical Rust CLI example

Review:

- `examples/support_triage.solve`

Run:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

What it demonstrates:

- the real lexer, parser, AST, and interpreter path
- executable control flow
- deterministic output
- the difference between a working example and a presentation mockup

Expected output includes:

```text
Support triage
Customer: Acme Labs
Topic: billing
Action: escalate to founder today
Owner: finance operations
```

### 4. Workflow Intelligence Studio

Open:

- https://www.solve-lang.com/studio/

What it demonstrates:

- local-first workflow modeling
- deterministic graph and rule analysis
- scenario simulation
- traces and quality indicators
- exportable workflow evidence

Important limitation:

Studio analysis is deterministic, not AI analysis. Its model is broader than the executable language, so generated `.solve` files are drafts that should be validated with the Rust CLI.

### 5. Browser-safe preview

Open:

- https://www.solve-lang.com/run/

What it demonstrates:

- a no-install interactive preview
- simple variables, values, print statements, comments, and `if` blocks
- client-side execution without a server call

Important limitation:

The browser preview supports a smaller syntax subset than the Rust runtime. It is not the canonical runtime and does not demonstrate full hosted execution.

## Recommended recruiter path

For a five-minute review:

1. Read the README introduction and maturity section.
2. Open the support-triage demo.
3. Inspect `examples/support_triage.solve`.
4. Review the runtime in `solvec/`.
5. Open Studio if time remains.

For a technical interview:

1. Validate the canonical example.
2. Run the canonical example.
3. Trigger one intentional runtime error to show source-located diagnostics.
4. Run a hardened command with `--safe` or `--json`.
5. Explain the boundary between the Rust runtime, browser preview, and Studio.

## Status legend

### Working today

A capability that exists in the repository and can be reproduced now.

### Preview

A narrow or presentation-oriented surface that works but is not the canonical implementation.

### Experimental

An implemented capability that is unstable, provider-dependent, test-only, or unsuitable for production promises.

### Planned

A roadmap direction without a working implementation.

## Working today

### Rust language prototype

Location:

- `solvec/`

Available commands:

```bash
cargo run -- run <file.solve>
cargo run -- validate <file.solve>
cargo run -- tokens <file.solve>
cargo run -- ast <file.solve>
cargo run -- help
```

Demonstrable capabilities include:

- lexer, parser, AST, and interpreter
- variables and reassignment
- arithmetic, comparisons, and boolean operators
- conditions and loops
- functions and returns
- arrays and objects
- imports
- JSON parse and stringify helpers
- source-located diagnostics
- configurable runtime-safety controls

### Runtime diagnostics

Demonstration idea:

Run a script with an out-of-bounds array index, invalid operand, unknown function, or incorrect function arity.

Expected result:

- source line and column
- source snippet and caret
- specific error description
- hint where available

### Hardened execution modes

Examples:

```bash
cargo run -- run --safe ../examples/hello.solve
cargo run -- run --json --safe --dry-run --no-network ../examples/upcomingsounds/cli-contract.solve
```

Demonstrable behavior:

- network, file, environment, and agent capabilities are denied in hardened mode
- JSON mode emits one machine-readable envelope
- advisory output is explicitly labeled non-production

### Workflow Intelligence Studio

The static Studio runs locally in the browser and provides deterministic workflow-analysis features.

Boundary:

- no workflow data or product analytics leave the browser according to the current design
- analysis is deterministic, not model-generated
- generated SolveLang source is preliminary

### Support-triage presentation page

The page explains a support process, workflow map, example outputs, risks, and a human-review point.

Boundary:

- the displayed workflow is a readable draft
- integrations shown in the narrative are not proof of live production connections

### Repository tests and documentation

The repository includes tests across the Rust runtime, website, Studio, API access, billing lifecycle, usage metering, priority queues, and safety controls.

Boundary:

- passing tests demonstrate covered behavior, not complete production readiness
- local validation should be recorded when hosted CI runners are unavailable

## Preview

### Browser `/run` preview

Supported:

- `let` variables
- text and number values
- `print`
- comments and blank lines
- simple `if` blocks using `==`

Not demonstrated by this preview:

- the complete runtime feature set
- server-side execution
- production integrations
- full safety-policy behavior
- canonical agent behavior

### Website examples and marketing flows

These pages are useful for explaining workflows, business value, and expected outcomes.

They are not customer deployments or evidence of adoption unless verified case studies are later added with permission.

### Studio-generated `.solve` drafts

Studio can produce preliminary source drafts, but they require validation through the canonical runtime:

```bash
cd solvec
cargo run -- validate ../path/to/generated-draft.solve
```

A generated draft is not executable proof until it validates and runs.

## Experimental

### HTTP helpers

Implemented HTTP GET and POST helpers include timeout and response-size limits.

Why experimental:

- narrow request configuration
- no production connector framework
- no managed credentials
- no production retry or durability guarantee

### File and environment helpers

Why experimental:

- powerful side effects require trusted local execution
- safe use depends on runtime flags and allowed-root configuration
- unsuitable for untrusted scripts without stronger isolation

### AI agent syntax and provider support

Implemented concepts include:

- `agent`
- `instruction`
- `tool`
- `ask`
- local fallback behavior
- optional OpenAI-backed responses

Why experimental:

- provider-dependent
- no production reliability claim
- no broad tool-execution framework
- no benchmark proving business accuracy
- generated output requires human review

### Test-mode API access and subscriptions

The repository contains authenticated customer-account, API-key, subscription, usage-metering, Stripe test-mode, and AWS SAM infrastructure.

Boundary:

- test-mode gates are intentional
- this is not a production API offering
- production custom-domain, operations, incident response, and compliance work remain incomplete
- passing billing and authorization tests do not establish general SaaS readiness

### Priority job queues

The repository contains priority-lane and queue infrastructure with safety gates and canary-oriented validation.

Boundary:

- this is infrastructure groundwork, not a public managed-execution product
- paid priority should not be marketed as generally available

## Roadmap

The following are planned, not available today:

- stable language specification
- packaged releases
- full hosted Rust runtime
- production integrations
- managed workflow execution
- provider-neutral AI interfaces
- broader provider support
- runtime adapters for established orchestration platforms
- production secrets and connection management
- team workspaces and deployment environments
- production observability, support, and incident procedures
- enterprise governance and compliance capabilities

## Known limitations

### Product maturity

- early-stage language and product prototype
- no verified production customers or adoption claims
- no public performance or reliability benchmarks
- no production service-level commitment

### Runtime

- language semantics are not stable
- standard library remains limited
- HTTP and side-effect controls are narrow
- no package ecosystem
- no durable workflow execution guarantee

### Browser preview

- intentionally supports only a small subset
- does not use the Rust runtime
- cannot prove full-language compatibility

### Studio

- Studio's workflow model is broader than executable SolveLang
- deterministic analysis is not AI analysis
- generated code is preliminary

### AI

- provider behavior can vary
- no accuracy guarantee
- no claim that autonomous execution is safe
- consequential outputs require human review

### Integrations and hosting

- no production integration marketplace
- no managed production runtime
- no enterprise tenancy or compliance claim
- API and subscription infrastructure remain test-only

## Failure cases to demonstrate honestly

A strong demo should include at least one failure path.

Recommended examples:

- invalid syntax rejected by `validate`
- out-of-bounds array access with source-located diagnostics
- network access denied in hardened mode
- unsupported syntax rejected by the browser preview
- Studio-generated draft requiring CLI validation

The presenter should explain what failed, why it failed, and which layer owns the behavior.

## Demo preparation checklist

Before presenting:

- use the branch or commit intended for the demo
- run the canonical validation and execution commands
- confirm the website routes load
- prepare one known-good input and output
- prepare one controlled failure case
- avoid provider-dependent AI calls unless separately tested
- remove secrets and private data from the terminal
- label every surface as working, preview, experimental, or planned
- do not imply that presentation examples are live integrations

## Demo success criteria

A successful demonstration allows the viewer to answer:

1. What problem does SolveLang address?
2. Which part is the canonical runtime?
3. What can be reproduced today?
4. Which features are previews or experiments?
5. Where are AI decisions and human review boundaries?
6. What technical skills does the repository demonstrate?
7. What remains before production readiness?

## Related documents

- [README](../README.md)
- [Strategy](strategy.md)
- [Competitive analysis](competitive-analysis.md)
- [Language reference](language-reference.md)
- [Runtime safety](runtime-safety.md)
- [Studio product specification](product/workflow-intelligence-studio-v1.md)
- [Studio privacy model](product/studio-privacy.md)
