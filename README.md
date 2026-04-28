# SolveLang

SolveLang is a human-first, safe, and AI-native programming language designed to simplify modern software development.

It is currently an early working prototype written in Rust. SolveLang is being built step by step as a simple scripting language for apps, automation, APIs, data workflows, and AI-powered systems.

## Current Status

SolveLang is in early development. The interpreter can already run `.solve` files with basic language features.

Current supported features:

- Variables
- Print statements
- Integer math: `+`, `-`, `*`, `/`
- If / else statements
- Comparison operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
- Functions with one parameter
- While loops
- Comments using `//`
- HTML-style text output

## Example

```solve
let name = "Saiid"
let age = 21
let x = 10
let y = 5

fn greet(person) {
    print("Hello")
    print(person)
}

print("<h1>Hello from SolveLang</h1>")
print("Creator:")
greet(name)

print("<p>Math test:</p>")
print(x + y)
print(x - y)
print(x * y)
print(x / y)

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
```

Expected output:

```text
<h1>Hello from SolveLang</h1>
Creator:
Hello
Saiid
<p>Math test:</p>
15
5
50
2
<p>Status: Adult</p>
<p>Loop test:</p>
1
2
3
4
5
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

## Project Structure

```text
solvelang/
  README.md
  examples/
    hello.solve
  solvec/
    src/
      main.rs
      eval.rs
      runtime.rs
```

File responsibilities:

- `main.rs` starts the command-line program
- `eval.rs` evaluates values, math, variables, and conditions
- `runtime.rs` executes SolveLang statements such as `let`, `print`, `if`, `else`, `while`, and functions

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

- Arrays and lists
- Multiple function parameters
- Return values
- Better error messages
- File imports
- JSON support
- HTTP server support
- Database support
- Real parser and lexer
- VS Code syntax highlighting
- Package manager

## Author

Created by Saiid Zeidan.

## License

MIT License.
