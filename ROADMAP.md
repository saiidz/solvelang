# SolveLang Roadmap

SolveLang is an early language prototype written in Rust. The project already has a working script runner, plus the first compiler layers needed to move beyond a string-matching interpreter.

## Current Baseline

Completed and working today:

- CLI runner for `.solve` files
- Lexer foundation
- Parser foundation
- AST definitions
- Typed runtime value foundation
- Variables
- Print statements
- Integer math: `+`, `-`, `*`, `/`
- String joining with `..`
- Booleans
- Comparisons
- `if / else`
- `while`
- Functions with parameters and return values
- Arrays and index access
- Agent prototype syntax: `agent`, `tool`, `instruction`, `ask`

## Phase 1: Finish The Core Interpreter

This is the critical path. The codebase already has lexer, parser, AST, and `Value` types, but runtime execution still depends mostly on line-based string evaluation.

Priority order:

1. Execute AST nodes directly instead of interpreting raw source lines
2. Use `Value` across evaluation and runtime instead of `HashMap<String, String>`
3. Unify expression evaluation so math, string joins, arrays, indexing, and comparisons all flow through the AST engine
4. Add parser-driven runtime support for current language features:
   - `let`
   - `print`
   - `return`
   - functions
   - `if / else`
   - `while`
   - arrays
   - agent prototype blocks
5. Remove duplicated legacy logic once AST execution is feature-complete

Definition of done for Phase 1:

- `runtime.rs` executes parsed `Stmt` and `Expr` nodes
- `eval.rs` no longer parses source text ad hoc
- current examples run unchanged through the AST path

## Phase 2: Tighten Language Semantics

After AST execution is the default path:

- Better parse and runtime error messages
- Line and token location tracking
- Clear truthiness and comparison rules
- Consistent function scope rules
- Cleaner array bounds and invalid index errors
- Better handling for unsupported operations and divide-by-zero

## Phase 3: Expand The Language

Once the core is stable:

- `for` loops
- imports across files
- objects / records
- standard library modules
- file read / write APIs
- JSON parsing and encoding

Recommended order:

1. imports
2. standard library layout
3. file I/O
4. JSON
5. records / objects
6. `for` loops

That order keeps SolveLang useful for scripting before growing surface area.

## Phase 4: Tooling And DX

Tooling should follow the stabilized interpreter, not lead it.

- `cargo test` coverage for lexer, parser, evaluator, and runtime
- golden tests for example programs
- `solvec check file.solve`
- `solvec run file.solve`
- formatter
- linter
- better CLI help and error output
- VS Code syntax highlighting

## Phase 5: Platform Features

These make sense only after the language core is predictable:

- HTTP server support
- routing and request handling
- HTML templates
- form parsing
- database support
- package manager

## Phase 6: AI-Native Runtime

The current agent syntax is only a local prototype. A real AI-native runtime needs:

- provider abstraction
- tool schema and permission model
- prompt and instruction handling
- structured input/output types
- network and secret management
- deterministic local testing for agent workflows

## Short-Term Execution Plan

The next concrete implementation steps should be:

1. Add an AST interpreter entry point in `runtime.rs`
2. Implement `Expr -> Value` evaluation for literals, variables, binary ops, arrays, calls, and indexes
3. Implement `Stmt` execution with scoped environments and return propagation
4. Switch `main.rs` runtime mode to `lexer -> parser -> AST interpreter`
5. Add regression tests for `examples/hello.solve`, `functions.solve`, `arrays.solve`, and `agent.solve`

## Long-Term Direction

SolveLang should become a simple, readable, safe, and AI-native language for:

- automation
- APIs
- web apps
- data workflows
- tool-using agents

The immediate engineering priority is not more syntax. It is making the compiler pipeline real end to end.
