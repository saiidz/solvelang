# SolveLang

SolveLang is a human-first, safe, and AI-native programming language designed to simplify modern software development.

It is currently an early working prototype written in Rust. SolveLang is being built step by step as a simple scripting language for apps, automation, APIs, data workflows, and AI-powered systems.

## Current Status

SolveLang is in early development. It can run `.solve` files through its default AST-based engine.

Current supported features:

- Variables
- Print statements
- Integer math: `+`, `-`, `*`, `/`
- If / else statements
- Comparison operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
- Functions
- Return values
- Multiple function parameters
- While loops
- Arrays and index access
- Booleans
- String joining using `..`
- Comments using `//`
- HTML-style text output
- AI-agent prototype syntax using `agent`, `tool`, `instruction`, and `ask`
- Lexer
- Parser
- AST
- AST runtime
- Typed value system
- Legacy runtime fallback
- CLI subcommands
- Line-based diagnostics
- Integration tests

## Example

```solve
let name = "Saiid"
let age = 21
let x = 10
let y = 5
let names = ["Saiid", "Mira", "Alex"]
let active = true

fn greet(person) {
    print("Hello")
    print(person)
}

fn add(a, b) {
    return a + b
}

agent SupportBot {
    instruction "Answer clearly using approved tools only."
    tool searchDocs
    tool createTicket
}

print("<h1>Hello from SolveLang</h1>")
print("Creator:")
greet(name)

print("<p>Math test:</p>")
print(add(x, y))
print(x - y)
print(x * y)
print(x / y)

print("<p>String join test:</p>")
print("Hello, " .. name)

print("<p>Array test:</p>")
print(names[0])
print(names[1])
print(names[2])

if active == true {
    print("<p>Status: Active</p>")
}

if age >= 18 {
    print("<p>Status: Adult</p>")
} else {
    print("<p>Status: Minor</p>")
}

print("<p>Loop test:</p>")
let count = 1

while count <= 5 {
    print(count)
    let count = count + 1
}

print("<p>AI Agent test:</p>")
ask SupportBot("How can SolveLang help with automation?")
```

## Running SolveLang

Clone the repository:

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang
```

Run the example program with the default AST engine:

```bash
cd solvec
cargo run -- run ../examples/hello.solve
```

The old direct file style still works:

```bash
cargo run ../examples/hello.solve
```

Run specific examples:

```bash
cargo run -- run ../examples/functions.solve
cargo run -- run ../examples/arrays.solve
cargo run -- run ../examples/agent.solve
```

## CLI Commands

```bash
cargo run -- run <file.solve>       # Run with the AST runtime
cargo run -- tokens <file.solve>    # Print lexer tokens
cargo run -- ast <file.solve>       # Print parsed AST
cargo run -- legacy <file.solve>    # Run with the legacy runtime
```

Backwards-compatible debug flags still work:

```bash
cargo run ../examples/hello.solve -- --tokens
cargo run ../examples/hello.solve -- --ast
cargo run ../examples/hello.solve -- --legacy
```

## Diagnostics

SolveLang validates common mistakes before running and reports clear line-numbered errors.

Example bad code:

```solve
let name
```

Example error style:

```text
SolveLang Error on line 1, column 1:
Invalid variable declaration: expected '='.
let name
^
Hint: Use syntax like: let name = value
```

Current diagnostics catch:

- Missing `=` in `let` declarations
- Unclosed strings
- Missing opening `{` on `if`, `while`, `fn`, and `agent`
- Unclosed blocks
- Unexpected closing braces

## Tests

Run the test suite:

```bash
cargo test
```

The tests cover CLI execution, token output, AST output, legacy runtime fallback, functions, arrays, loops, agent syntax, and diagnostics for invalid code.

## Project Structure

```text
solvelang/
  README.md
  ROADMAP.md
  examples/
    hello.solve
    functions.solve
    arrays.solve
    agent.solve
  solvec/
    src/
      main.rs
      diagnostics.rs
      value.rs
      lexer.rs
      ast.rs
      parser.rs
      ast_runtime.rs
      eval.rs
      runtime.rs
    tests/
      cli.rs
```

File responsibilities:

- `main.rs` starts the command-line program and exposes run, token, AST, and legacy modes
- `diagnostics.rs` validates source code and formats line-numbered errors
- `value.rs` defines typed runtime values
- `lexer.rs` turns SolveLang source code into tokens
- `ast.rs` defines expression and statement nodes
- `parser.rs` turns tokens into AST nodes
- `ast_runtime.rs` executes the AST-based runtime engine
- `eval.rs` supports the legacy runtime evaluator
- `runtime.rs` keeps the older legacy runtime available as a fallback
- `tests/cli.rs` verifies the command-line behavior

## Architecture

SolveLang now uses a real language pipeline by default:

```text
source code -> diagnostics -> lexer -> parser -> AST -> AST runtime -> output
```

The legacy string-based runtime is still available using `legacy` or `--legacy`, but normal execution now goes through the AST engine.

## AI-Native Direction

SolveLang is designed to grow toward AI-native scripting. The current `agent` feature is a local prototype. It does not call a live AI provider yet, but it defines the future syntax direction:

```solve
agent SupportBot {
    instruction "Answer using approved tools only."
    tool searchDocs
    tool createTicket
}

ask SupportBot("Help me automate this workflow")
```

Later, this can connect to real AI providers, documents, tools, APIs, and business workflows.

## Vision

SolveLang aims to become a simple, readable, safe, and AI-native programming language for modern development.

The long-term goal is to support:

- Web applications
- Backend APIs
- Automation scripts
- Data workflows
- AI agents and tools
- Simple deployment workflows

## Roadmap

Planned next steps:

- File imports
- JSON support
- HTTP server support
- Database support
- Real AI provider integration
- VS Code syntax highlighting
- Package manager

## Author

Created by Saiid Zeidan.

## License

MIT License.
