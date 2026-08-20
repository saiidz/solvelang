# SolveLang Language Reference

SolveLang is an early beta scripting language for readable AI-assisted business workflows. This reference documents the syntax currently supported by the Rust CLI runtime in `solvec/`.

The language is still changing. Treat this document as the current implementation reference, not a stable language specification.

## Running Scripts

From `solvec/`:

```bash
cargo run -- validate ../examples/support_triage.solve
cargo run -- check ../examples/support_triage.solve
cargo run -- lint ../examples/support_triage.solve
cargo run -- fmt --check ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

- `validate` lexes and parses a script, then exits without running it.
- `check` performs `validate` plus conservative source-only semantic checks. It never runs a workflow or selects a runtime policy.
- `lint` performs `validate` plus conservative source-only warnings. It never runs a workflow or selects a runtime policy, and warnings do not make the command fail. It reports structural unreachable statements after an unconditional terminator, including an `if` when both explicit branches terminate, without evaluating a condition.
- `fmt` validates and canonically rewrites one source file without running it. `fmt --check` is read-only and exits nonzero when formatting would change the file. Formatting is deterministic and idempotent; it preserves line comments and the original spelling of string escapes while normalizing line endings to LF.
- `run` lexes, parses, and executes the script with the Rust AST runtime.
- `tokens` prints lexer tokens.
- `ast` prints the parsed AST.
- `run --safe`, `run --dry-run`, `run --no-network`, and `run --json` each select strict hardened execution. Hardened runs deny network, agents/tools, runtime file reads/writes, environment reads, and unknown or mutation-style calls.

For deterministic local JSON input and advisory JSON output:

```bash
cargo run -- run \
  --input ../examples/upcomingsounds/cli-contract-input.json \
  --json --safe --dry-run --no-network \
  ../examples/upcomingsounds/cli-contract.solve
```

The explicit JSON file becomes the read-only global `input`. It may contain null, booleans, text, arrays, objects, and signed 32-bit integers. Decimals, out-of-range numbers, malformed JSON, and inputs over 1 MiB fail closed. Values passed to `print(...)` become the typed `outputs` array in one deterministic `NON-PRODUCTION ADVISORY ONLY` JSON envelope.

The AST runtime is canonical. The public `legacy` command and `--legacy` flag have been removed.

## Studio model versus executable syntax

Workflow Intelligence Studio uses a broader canonical workflow model for triggers, decisions, policies, approvals, human review, timers, exceptions, notifications, systems, and evidence. These concepts support deterministic analysis and simulation in the browser, but they are not all executable SolveLang syntax.

Studio exports a clearly labeled preliminary `.solve` draft and preserves unsupported concepts as comments. Validate any generated draft with `solvec validate` and review it before `solvec run`. The Rust CLI remains the canonical source for executable language behavior.

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

Numbers are signed 32-bit integer values at runtime, while source literals currently consist of digits. A source literal above `2147483647` is a source-located validation error; it is never converted to zero. Unknown characters outside strings and comments are also validation errors rather than being ignored.

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

Division by zero and arithmetic results outside the signed 32-bit range are runtime errors.

Arithmetic requires number operands. SolveLang does not coerce text, booleans, arrays, objects, or `null` to zero:

```solve
print(true + 1) // Runtime error: '+' requires number operands
print("5" - 2) // Runtime error: '-' requires number operands
```

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

Array indexes must be non-negative numbers within the array bounds. A negative, non-number, or out-of-range index is a runtime error with the index location. For example, `owners["first"]` and `owners[8]` fail clearly instead of returning `null`.

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

Bracket keys must be text. `ticket[0]` is a runtime error. Missing properties and missing text keys continue to return `null` for compatibility. Property access on a non-object, and index access on a value that is neither an array nor object, are runtime errors.

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

Ordered comparisons require number operands. Equality and inequality compare full values and remain backward compatible.

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

`while` loops and array iteration are supported.

```solve
let count = 0

while count < 3 {
  print(count)
  count = count + 1
}
```

The runtime stops a loop after 10,000 iterations as a safety guard. `break` exits the nearest enclosing loop and continues after it; `continue` skips the rest of the current iteration of that nearest loop. Both are only valid inside a `while` or `for` body.

```solve
let count = 0

while count < 5 {
  count = count + 1
  if count == 2 {
    continue
  }
  if count == 4 {
    break
  }
  print(count)
}
// Prints 1 then 3.
```

Use `for item in items` to visit every value in an array. The loop variable is assigned for each iteration, including within nested loops. A non-array iterable is a source-located runtime error, and arrays longer than 10,000 items are rejected before the loop body runs.

```solve
let owners = ["Ari", "Bea"]

for owner in owners {
  print(owner)
}
```

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

Function calls use `name(arg1, arg2)` and must provide exactly the declared number of arguments. Too few or too many arguments are source-located runtime errors that name the function and show the expected and received counts.

## Imports

Import another `.solve` file with a relative path:

```solve
import "lib/user.solve"

print(user_name)
print(user_plan)
```

Imports are resolved relative to the importing file. Circular imports are rejected with a deterministic root-relative import chain. In hardened mode, imports must be relative regular `.solve` files whose canonical targets remain below the entry workflow's canonical parent. Absolute paths, parent traversal, non-`.solve` paths, and symlink escapes fail before imported content is read. The loader flattens imported source before parsing while retaining line-level provenance, so parser and runtime diagnostics from imported content identify the relative imported-file path and its local line number. Imports remain compatibility includes, not module namespaces or package resolution.

## Runtime Errors

The Rust CLI reports runtime errors with a file when available, line and column, source text, a caret, and a hint when appropriate:

```text
SolveLang Runtime Error on line 2, column 13 in workflow.solve
  2 | print(items[8])
    |             ^
Array index 8 is out of bounds for an array of length 2.
Hint: Use an index between 0 and 1.
```

Parser recovery uses statement boundaries so one malformed statement generally yields one primary diagnostic while later malformed statements can still be reported.

## Builtins

### Pure standard-library helpers

`length`, `is_empty`, `contains`, `get`, `keys`, `values`, and `entries` are deterministic pure helpers. They do not read
files, environment variables, or the network, so hardened runs allow them.

`length(value)` returns the number of Unicode scalar values in text, the number
of items in an array, or the number of keys in an object. It rejects all other
types.

```solve
print(length("hé")) // 2
print(length(["support", "sales"])) // 2
print(length({ status: "open", urgent: true })) // 2
```

`is_empty(value)` returns whether text, an array, or an object has no contents.
It rejects all other types.

```solve
print(is_empty("")) // true
print(is_empty(["support"])) // false
print(is_empty({})) // true
```

`contains(collection, value)` returns whether text contains a text substring,
an array contains an equal value, or an object contains a text key.

```solve
print(contains("SolveLang", "Lang"))
print(contains(["support", "sales"], "sales"))
print(contains({ status: "open" }, "status"))
```

`get(collection, key, fallback)` reads an array by numeric index or an object
by text key without throwing for a missing key or out-of-range (including
negative) index. Its third argument is optional and defaults to `null`.

```solve
let owners = ["Ari", "Bea"]
let ticket = { status: "open" }
print(get(owners, 1)) // Bea
print(get(owners, 9, "unassigned")) // unassigned
print(get(ticket, "priority", "normal")) // normal
```

`keys(object)` returns the object's text keys in deterministic lexicographic
order. It rejects non-object values.

```solve
print(keys({ status: "open", count: 2 })) // ["count", "status"]
```

`values(object)` returns values ordered by their corresponding keys' deterministic
lexicographic order. It rejects non-object values.

```solve
print(values({ status: "open", count: 2 })) // [2, "open"]
```

`entries(object)` returns `[key, value]` pairs in deterministic lexicographic
key order. It rejects non-object values.

```solve
print(entries({ status: "open", count: 2 })) // [["count", 2], ["status", "open"]]
```

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

Safety warning: `read_file` can read any path available to the running process unless safe mode or allowed roots deny it.

### `write_file(path, body)`

Writes text to a file and returns `true` on success.

```solve
let ok = write_file("/tmp/solvelang-note.txt", "hello")
print(ok)
```

Safety warning: `write_file` can create or overwrite files available to the running process unless safe mode or allowed roots deny it. Do not run untrusted scripts.

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

Safety warning: `http_get` makes a network request from your machine unless safe mode denies network access. HTTP requests have a default 5 second connect timeout, 15 second request timeout, and 1 MB response-body limit.

### `http_post(url, body)`

Sends an HTTP POST request with `content-type: application/json`. The body must be text. The response shape matches `http_get`.

```solve
let response = http_post("https://httpbin.org/post", "{\"hello\":\"world\"}")
print(response.status)
```

Safety warning: `http_post` sends data to a remote server from your machine unless safe mode denies network access. HTTP requests have a default 5 second connect timeout, 15 second request timeout, and 1 MB response-body limit.

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

## Runtime Safety

Use hardened execution for pure, side-effect-free evaluation:

```bash
cargo run -- run --safe ../examples/hello.solve
```

Any of `--safe`, `--dry-run`, `--no-network`, or `--json` enables one strict policy that denies:

- network access through `http_get` and `http_post`
- all agent declarations, tools, and `ask` statements
- file reads through `read_file`
- file writes through `write_file`
- environment-variable access through `env` and AI provider configuration
- unknown, shell/process/plugin, and mutation-style calls

Denied capabilities are found by a complete AST preflight before execution, including in imported source, function bodies, and unreachable branches. Capability-enabling `--allow-*` flags are rejected in hardened mode.

Successful non-JSON hardened runs print `NON-PRODUCTION ADVISORY ONLY` before workflow output. JSON mode is always hardened and includes that label in its one output document. Its `dry_run` field is `true` only when `--dry-run` was explicitly supplied.

A trusted unhardened run remains capability-enabled. `--allow-root` can constrain its file builtins:

```bash
cargo run -- run --allow-root /tmp/solvelang-inputs ./trusted-workflow.solve
```

Allowed filesystem roots reject paths containing `..` and reject resolved paths outside the configured roots.

For details, see [runtime-safety.md](runtime-safety.md).

## Static semantic checks

Use `check` to find definite source-level mistakes before a run:

```bash
cargo run -- check ../examples/support_triage.solve
```

The checker reports source-located, high-confidence errors such as unknown top-level variables, unknown function and agent references, duplicate function or agent names, declared-function arity mismatches, non-array `for` iterables, and type-invalid operations on literal or otherwise known values. It intentionally leaves values that depend on `input`, calls, branches, and runtime globals as unknown rather than guessing. `check` is read-only and independent of safe-mode flags; it does not execute builtins, agents, imports beyond the normal source loader, or network/file operations.

## Lint warnings

Use `lint` for read-only, source-located warnings that do not prevent a run:

```bash
cargo run -- lint ../examples/support_triage.solve
```

The initial rules deliberately report only structural facts: statements after a
direct `return`, `break`, or `continue` in the same block, or after an `if`
whose two explicit branches terminate, plus calls to known network,
filesystem, environment, or agent-provider-capable operations. The linter also
examines unreachable code so a capability warning cannot be hidden behind a
return. It does not infer unused variables, constant-loop behavior, or
duplicate object keys where the current AST cannot prove them without false
positives. `lint` loads and parses normal imports but never evaluates source,
reads runtime files, selects a provider, or changes capability policy.

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

Use `run --json --safe --dry-run --no-network` when you want deterministic advisory output with runtime capabilities denied. Hardened execution is an interpreter policy, not an operating-system sandbox; callers remain responsible for process time, memory, environment clearing, and output caps.

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
