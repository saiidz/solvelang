# SolveLang

SolveLang is a readable scripting language for AI-assisted business workflows.

The current implementation is an early Rust interpreter/prototype in `solvec/`. It includes a lexer, parser, AST runtime, diagnostics, imports, JSON helpers, HTTP helpers, file I/O, environment access, arrays, objects, functions, loops, and AI-agent syntax with local fallback plus optional OpenAI-backed responses.

SolveLang is not a production language runtime yet. It is an early beta meant to make the language shape testable, readable, and easy to evolve.

## Who SolveLang Is For Right Now

SolveLang is currently for founders, operators, and technical founders who want readable workflow scripts for business automation. The clearest early workflows are support ticket triage, intake routing, lead qualification, and simple internal ops reporting.

Agencies and consultants are a later go-to-market path once the first founder/operator use cases are tighter.

The hosted `/run` page is a browser-safe preview for simple scripts. It does not call a server and supports a smaller syntax subset than the Rust CLI runtime. Full Rust runtime hosting, production integrations, and a managed automation platform are later work.

## Quick Start

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/hello.solve
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

## CLI Commands

- `solvec run <file.solve>` runs a SolveLang file with the AST runtime.
- `solvec validate <file.solve>` checks syntax without running the script.
- `solvec tokens <file.solve>` prints lexer tokens.
- `solvec ast <file.solve>` prints the parsed AST.
- `solvec legacy <file.solve>` runs the older legacy runtime.
- `solvec help`, `solvec --help`, or `solvec -h` prints command help.

Backward-compatible flags are still available:

```bash
solvec <file.solve> --tokens
solvec <file.solve> --ast
solvec <file.solve> --legacy
```

## Validate Before Running

Use `validate` to check that a script can be lexed and parsed before running it:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
```

Validation does not execute the script. It does not run AI agents, HTTP calls, file writes, or other runtime side effects.

## Features

For exact syntax supported today, see [docs/language-reference.md](docs/language-reference.md).

For the current workflow-audit motion, see:

- [docs/outreach.md](docs/outreach.md)
- [docs/first-audit-playbook.md](docs/first-audit-playbook.md)
- [docs/offer.md](docs/offer.md)

### What Works Now

- Variables with `let`
- Variable reassignment with `name = value`
- `print(...)`
- Integer math: `+`, `-`, `*`, `/`
- Comparisons: `==`, `!=`, `>`, `>=`, `<`, `<=`
- Boolean operators: `and`, `or`, `not`
- `if` / `else`
- `while` loops
- Functions with `return`
- Arrays and indexing
- Objects/maps, property access, and string-key indexing
- String joining with `..`
- Imports with `import "relative/path.solve"`
- Runtime errors for unknown variables, unknown functions, divide by zero, and invalid built-in argument types
- Parser and diagnostic messages with line/column output

### Prototype/Experimental

- HTTP GET and POST helpers
- File read/write helpers
- Environment variable reads
- JSON parse/stringify conversion between SolveLang values and JSON
- `agent`, `instruction`, `tool`, and `ask` syntax with local fallback and optional OpenAI provider mode

AI agent support defaults to local placeholder mode. Set `SOLVELANG_AI_PROVIDER=openai` and `OPENAI_API_KEY` to generate real model responses.

### What Comes Later

- Additional AI providers and tool execution for agents
- More complete type checking and runtime type errors
- Packages/modules beyond simple file imports
- Richer standard library
- Better HTTP configuration and request options
- Full Rust runtime hosting
- Production integrations and managed workflow execution
- Stable language specification
- Release packaging

## Built-ins

### `json_parse(text)`

Parses a JSON string into SolveLang values.

```solve
let data = json_parse("{\"name\":\"SolveLang\"}")
print(data.name)
```

### `json_stringify(value)`

Converts a SolveLang value into JSON text.

```solve
print(json_stringify({ ok: true, count: 2 }))
```

### `http_get(url)`

Sends an HTTP GET request. Returns an object with:

- `status`
- `url`
- `body`
- `headers`

```solve
let response = http_get("https://httpbin.org/get")
print(response.status)
print(response.body)
```

### `http_post(url, body)`

Sends an HTTP POST request with `content-type: application/json`. The body must be text. Returns the same response shape as `http_get`.

```solve
let response = http_post("https://httpbin.org/post", "{\"hello\":\"world\"}")
print(response.status)
```

### `read_file(path)`

Reads a text file and returns its contents.

```solve
print(read_file("/tmp/solvelang-example.txt"))
```

### `write_file(path, body)`

Writes text to a file and returns `true` on success.

```solve
write_file("/tmp/solvelang-example.txt", "hello")
```

### `env(name)`

Reads an environment variable by name. Missing variables return an empty string.

```solve
print(env("HOME"))
```

## Safety Notes

- `read_file` and `write_file` use paths available to the running process. Be careful with absolute paths and avoid running untrusted scripts.
- `write_file` can overwrite files.
- `env` can expose secrets such as tokens, API keys, or deployment credentials.
- `http_get` and `http_post` make network requests from your machine and may send data to external services.
- OpenAI-backed agent calls send the agent instruction, approved tool names, and user message to OpenAI.
- Never print, hardcode, or commit `OPENAI_API_KEY`.
- External AI calls may cost money.
- HTTP examples may require internet access. Automated tests avoid external internet.

## AI Agent Support

SolveLang supports:

```solve
agent SupportBot {
  instruction "Answer clearly using approved tools only."
  tool searchDocs
}

ask SupportBot("How can SolveLang help with automation?")
```

### Local Mode

Local mode is the default. If `SOLVELANG_AI_PROVIDER` is missing, empty, or set to `local`, `ask` prints a deterministic placeholder response. This mode does not require internet access or API keys.

```bash
cd solvec
cargo run -- run ../examples/agent.solve
```

You can force local mode explicitly:

```bash
export SOLVELANG_AI_PROVIDER=local
cargo run -- run ../examples/agent.solve
```

### OpenAI Mode

OpenAI mode calls the OpenAI Chat Completions API using the declared agent instruction as the developer message and the `ask` text as the user message. Tool names are included as approved tool context. SolveLang does not execute external tools for the model yet.

Required environment variables:

- `SOLVELANG_AI_PROVIDER=openai`
- `OPENAI_API_KEY`

Optional environment variable:

- `SOLVELANG_AI_MODEL`, defaulting to `gpt-4.1-mini`

Example:

```bash
cd solvec
export SOLVELANG_AI_PROVIDER=openai
export OPENAI_API_KEY="..."
export SOLVELANG_AI_MODEL="gpt-4.1-mini"
cargo run -- run ../examples/agent.solve
```

Safety notes:

- Do not put real API keys in `.solve` files.
- Do not commit API keys.
- External AI calls may cost money.
- Provider, network, HTTP, API, and malformed-response failures return structured SolveLang runtime errors.

## Examples

Examples live in `examples/`:

- `hello.solve`
- `variables.solve`
- `math.solve`
- `conditionals.solve`
- `booleans.solve`
- `functions.solve`
- `loops.solve`
- `arrays.solve`
- `objects.solve`
- `imports.solve`
- `json.solve`
- `http.solve`
- `files.solve`
- `agent.solve`
- `support_triage.solve`
- `lead_qualification.solve`
- `intake_to_task.solve`
- `ops_report.solve`

Run one with:

```bash
cd solvec
cargo run -- run ../examples/loops.solve
```

### Try Examples

These operator workflow examples are runnable with the Rust CLI runtime:

```bash
cd solvec
cargo run -- run ../examples/support_triage.solve
cargo run -- run ../examples/lead_qualification.solve
cargo run -- run ../examples/intake_to_task.solve
cargo run -- run ../examples/ops_report.solve
```

`support_triage.solve` classifies an urgent support ticket, chooses an owner, and decides whether same-day founder escalation is needed.

Expected output:

```text
Support triage
Customer: Acme Labs
Topic: billing
Action: escalate to founder today
Owner: finance operations
```

`lead_qualification.solve` turns an inbound demo request into a simple qualification decision based on intent and budget.

Expected output:

```text
Lead qualification
Company: Northstar Studio
Intent: high
Fit: qualified account
Next step: founder follow-up
```

`intake_to_task.solve` routes a customer or internal intake form into an operations task and sets a lightweight due-date expectation.

Expected output:

```text
Intake routing
Source: customer form
Request: implementation
Create task in operations queue
Due: this week
```

`ops_report.solve` summarizes weekly operations signals and flags blocked work that needs review.

Expected output:

```text
Weekly ops report
Week: 2026-07-03
Open tickets:
14
Qualified leads:
5
Attention: blocked work needs review
3
```

These examples use Rust CLI runtime features such as objects, property access, numeric comparisons, `else` branches, and string joining. The browser preview at `/run` is intentionally smaller: it supports `let`, `print`, simple text/number values, and basic `if` blocks using `==`.

Inspect tokens or AST:

```bash
cargo run -- tokens ../examples/loops.solve
cargo run -- ast ../examples/loops.solve
```

## MCP Direction

SolveLang's MCP direction is to make `.solve` scripts easier for AI assistants to inspect, explain, validate, and draft without turning the early runtime into unsafe remote execution.

The current MCP server lives at `site/mcp/solvelang-mcp.mjs`. It exposes:

- `solvelang_status` to explain current MCP capabilities.
- `solvelang_examples` to return a small preview-compatible example.
- `solvelang_run_preview` to run a safe subset of SolveLang syntax in-process.

This MCP preview runner is intentionally limited. It supports simple variables, `print(...)`, string/number/boolean values, and basic `if` blocks using `==` or `!=`. It is not the full Rust runtime.

The roadmap is for AI assistants to:

- Inspect `.solve` scripts and summarize their workflow intent.
- Explain workflow steps in plain English for founders and operators.
- Validate scripts against the currently supported syntax.
- Generate first drafts of workflow scripts from business-process descriptions.
- Safely run local examples later, with explicit boundaries and no risky script execution by default.

## Development

From `solvec/`:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo build --release
```
