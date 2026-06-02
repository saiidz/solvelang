# SolveLang

SolveLang is an early Rust interpreter/prototype for readable automation scripts. The current implementation lives in `solvec/` and includes a lexer, parser, AST runtime, diagnostics, imports, JSON helpers, HTTP helpers, file I/O, environment access, arrays, objects, functions, loops, and placeholder AI-agent syntax.

This is not a production language runtime yet. It is an MVP-stage prototype meant to make the language shape testable and easy to evolve.

## Install And Run

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/solvec
cargo run -- run ../examples/hello.solve
cargo run -- tokens ../examples/hello.solve
cargo run -- ast ../examples/hello.solve
cargo build --release
./target/release/solvec run ../examples/hello.solve
```

## CLI Commands

- `solvec run <file.solve>` runs a SolveLang file with the AST runtime.
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

## Features

### Working Now

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
- `agent`, `instruction`, `tool`, and `ask` syntax

AI agent support is currently a local placeholder/prototype. `ask` prints a deterministic local response using the declared agent metadata. It does not call an AI provider until one is connected in a future runtime integration.

### Planned

- Real AI provider integration for agents
- More complete type checking and runtime type errors
- Packages/modules beyond simple file imports
- Richer standard library
- Better HTTP configuration and request options
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
- HTTP examples may require internet access. Automated tests avoid external internet.

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

Run one with:

```bash
cd solvec
cargo run -- run ../examples/loops.solve
```

Inspect tokens or AST:

```bash
cargo run -- tokens ../examples/loops.solve
cargo run -- ast ../examples/loops.solve
```

## Development

From `solvec/`:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo build --release
```
