# SolveLang

SolveLang is a human-first, safe, and AI-native programming language designed to simplify modern software development.

It is currently an early working prototype written in Rust. SolveLang is being built step by step as a simple scripting language for apps, automation, APIs, data workflows, and AI-powered systems.

## Current Status

SolveLang is in early development. The interpreter can already run `.solve` files with practical prototype features.

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
- Lexer foundation
- Parser foundation
- AST foundation
- Typed value foundation

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

Run the example program:

```bash
cd solvec
cargo run ../examples/hello.solve
```

Run specific examples:

```bash
cargo run ../examples/functions.solve
cargo run ../examples/arrays.solve
cargo run ../examples/agent.solve
```

Inspect tokens or AST using the new compiler foundation:

```bash
cargo run ../examples/hello.solve -- --tokens
cargo run ../examples/hello.solve -- --ast
```

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
      value.rs
      lexer.rs
      ast.rs
      parser.rs
      eval.rs
      runtime.rs
```

File responsibilities:

- `main.rs` starts the command-line program and exposes runtime, token, and AST modes
- `value.rs` defines typed runtime values
- `lexer.rs` turns SolveLang source code into tokens
- `ast.rs` defines expression and statement nodes
- `parser.rs` starts turning tokens into AST nodes
- `eval.rs` evaluates values, math, variables, arrays, booleans, strings, and conditions
- `runtime.rs` executes the current working interpreter features

## Architecture Direction

SolveLang is moving from a string-matching prototype toward a real language pipeline:

```text
source code -> lexer -> parser -> AST -> interpreter
```

The current runtime still executes the working language features. The lexer, parser, AST, and `Value` system are now in place as the foundation for the next engine.

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

- Migrate runtime execution to the AST engine
- Better error messages with line numbers
- Native value types throughout the interpreter
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
