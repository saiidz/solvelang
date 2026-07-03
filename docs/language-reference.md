# SolveLang Language Reference

SolveLang is an early beta scripting language for readable AI-assisted business workflows. This reference documents the syntax currently supported by the Rust CLI runtime in `solvec/`.

The language is still changing. Treat this document as the current implementation reference, not a stable language specification.

## Running Scripts

From `solvec/`:

```bash
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

- `validate` lexes and parses a script, then exits without running it.
- `run` lexes, parses, and executes the script with the Rust AST runtime.
- `tokens` prints lexer tokens.
- `ast` prints the parsed AST.
- `legacy` runs the older runtime and should not be used as the primary reference for new scripts.

## Comments

Line comments start with `//` and continue to the end of the line.

```solve
// This is ignored by the lexer.
print("comments work")
```

## Variables

Use `let` to declare a variable. Reassign an existing variable with `name = value`.

```solve
let owner = "support"
print(owner)

owner = "founder"
print(owner)
```

Reassignment requires the variable to already exist. Assigning an unknown variable is a runtime error.

## Values

### Strings

Strings use double quotes.

```solve
let customer = "Acme Labs"
print(customer)
```

Supported escapes include `\"`, `\\`, `\n`, `\t`, and `\r`.

Join values as text with `..`:

```solve
let customer = "Acme Labs"
print("Customer: " .. customer)
```

### Numbers

Numbers are signed 32-bit integer values at runtime, but the lexer currently supports integer literals made of digits.

```solve
let tickets = 12
let closed = 5
print(tickets - closed)
print(tickets + closed * 2)
```

Supported arithmetic operators:

- `+`
- `-`
- `*`
- `/`

Division by zero is a runtime error.

### Booleans

Use `true` and `false`.

```solve
let urgent = true
let blocked = false
print(urgent)
print(not blocked)
```

Supported boolean operators:

- `and`
- `or`
- `not`

## Arrays

Arrays use square brackets. Access values by numeric index.

```solve
let owners = ["support", "sales", "founder"]
print(owners[0])
print(owners[2])
```

Out-of-range array access currently returns `null`.

## Objects

Objects use braces with `key: value` entries. Keys can be identifiers or quoted strings.

```solve
let ticket = {
  customer: "Acme Labs",
  topic: "billing",
  urgent: true,
  count: 3
}

print(ticket.customer)
print(ticket["topic"])
```

Property access uses dot syntax:

```solve
print(ticket.customer)
```

String-key indexing also works:

```solve
print(ticket["topic"])
```

Missing properties currently return `null`.

## Print

Use `print(...)` to write a value to stdout.

```solve
let status = "qualified"
print("Lead status: " .. status)
```

## Comparisons

Supported comparison operators:

- `==`
- `!=`
- `>`
- `>=`
- `<`
- `<=`

Example:

```solve
let tickets = 14
let threshold = 10

if tickets > threshold {
  print("Support queue needs review")
}
```

Numeric comparisons compare numbers. Equality and inequality compare full values.

## If / Else

Use braces for conditional blocks. `else` is supported by the Rust CLI runtime.

```solve
let plan = "enterprise"

if plan == "enterprise" {
  print("Route to founder")
} else {
  print("Route to nurture")
}
```

Conditions use truthiness. `false` and `null` are falsey; other values are truthy.

## Loops

`while` loops are supported.

```solve
let count = 0

while count < 3 {
  print(count)
  count = count + 1
}
```

The runtime stops a loop after 10,000 iterations as a safety guard.

## Functions

Define functions with `fn`, parameters, a block, and `return`.

```solve
fn qualify(intent, budget) {
  if intent == "high" and budget >= 5000 {
    return "qualified"
  } else {
    return "nurture"
  }
}

let status = qualify("high", 7500)
print(status)
```

Function calls use `name(arg1, arg2)`. Missing arguments currently become `null`.

## Imports

Import another `.solve` file with a relative path:

```solve
import "lib/user.solve"

print(user_name)
print(user_plan)
```

Imports are resolved relative to the importing file. Circular imports are rejected.

## Builtins

### `json_parse(text)`

Parses JSON text into SolveLang values.

```solve
let payload = json_parse("{\"company\":\"Acme Labs\",\"tickets\":3}")
print(payload.company)
print(payload.tickets)
```

### `json_stringify(value)`

Converts a SolveLang value into JSON text.

```solve
let report = { company: "Acme Labs", urgent: true }
print(json_stringify(report))
```

### `env(name)`

Reads an environment variable. Missing variables return an empty string.

```solve
print(env("HOME"))
```

Safety warning: `env` can expose secrets such as API keys or deployment tokens. Do not print secrets from untrusted scripts.

### `read_file(path)`

Reads a text file and returns its contents.

```solve
let body = read_file("../examples/sample_input.json")
print(body)
```

Safety warning: `read_file` can read any path available to the running process.

### `write_file(path, body)`

Writes text to a file and returns `true` on success.

```solve
let ok = write_file("/tmp/solvelang-note.txt", "hello")
print(ok)
```

Safety warning: `write_file` can create or overwrite files available to the running process. Do not run untrusted scripts.

### `http_get(url)`

Sends an HTTP GET request and returns an object with:

- `status`
- `url`
- `body`
- `headers`

```solve
let response = http_get("https://httpbin.org/get")
print(response.status)
print(response.url)
```

Safety warning: `http_get` makes a network request from your machine.

### `http_post(url, body)`

Sends an HTTP POST request with `content-type: application/json`. The body must be text. The response shape matches `http_get`.

```solve
let response = http_post("https://httpbin.org/post", "{\"hello\":\"world\"}")
print(response.status)
```

Safety warning: `http_post` sends data to a remote server from your machine.

## Agents And Ask

Declare an agent with `agent`, `instruction`, and optional `tool` entries. Ask it with `ask AgentName("message")`.

```solve
agent SupportBot {
  instruction "Classify the customer request and answer clearly."
  tool searchDocs
}

ask SupportBot("How should we route a billing escalation?")
```

Local mode is the default and prints a deterministic placeholder response without an API key or network call.

OpenAI mode is optional:

```bash
export SOLVELANG_AI_PROVIDER=openai
export OPENAI_API_KEY="..."
cargo run -- run ../examples/agent.solve
```

OpenAI-backed `ask` sends the agent instruction, approved tool names, and user message to OpenAI. It may cost money. SolveLang does not execute external tools for the model yet.

## Validate Vs Run

Use `validate` before running scripts:

```bash
cargo run -- validate ../examples/support_triage.solve
```

`validate`:

- reads the file and imports
- runs current diagnostics
- lexes and parses the script
- exits non-zero on syntax errors
- does not execute the script
- does not call AI providers
- does not make HTTP requests
- does not read or write runtime files

Use `run` when you intentionally want to execute the script:

```bash
cargo run -- run ../examples/support_triage.solve
```

`run` can execute builtins, file I/O, HTTP requests, environment reads, and AI calls depending on the script.

## Browser Preview Vs Rust CLI

The hosted `/run` browser preview is intentionally smaller and safer than the Rust CLI runtime. It runs in the browser and does not call a server.

The browser preview currently supports:

- `let` variables
- string and number values
- `print(...)`
- simple variable reads
- basic `if` blocks using `==`
- comments with `//`

The browser preview does not support the full Rust CLI language. Features such as arrays, objects, functions, loops, imports, `else`, AI agents, HTTP helpers, file helpers, JSON helpers, and environment reads should be tested with the Rust CLI.

Use the Rust CLI as the source of truth for full-language examples:

```bash
cd solvec
cargo run -- validate ../examples/ops_report.solve
cargo run -- run ../examples/ops_report.solve
```

## Stability Status

SolveLang is early beta. The current syntax is implemented and covered by the Rust CLI tests, but it is still subject to change.

Expect future changes around:

- richer type checking and runtime errors
- package/module behavior beyond simple imports
- standard library shape
- hosted runtime boundaries
- AI tool execution and provider behavior
- a stable language specification

For now, prefer small readable scripts, run `validate` before `run`, and keep side-effecting scripts under your control.
