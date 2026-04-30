# SolveLang Roadmap

SolveLang is an early language prototype written in Rust. The project now has a working lexer, parser, AST, and default AST runtime, with the older line-based runtime kept only as a legacy fallback.

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

## Phase 1: Core Interpreter

Status: mostly complete.

Completed:

- CLI execution now defaults to `source -> diagnostics -> lexer -> parser -> AST -> AST runtime`
- `AstRuntime` evaluates parsed `Stmt` and `Expr` nodes directly
- Runtime values flow through the typed `Value` enum in the AST path
- Math, string joins, arrays, indexing, comparisons, function calls, and control flow run through the AST engine
- Parser-driven runtime support exists for:
   - `let`
   - `print`
   - `return`
   - functions
   - `if / else`
   - `while`
   - arrays
   - agent prototype blocks
- The old string-based runtime remains available through `solvec legacy`

Remaining cleanup:

- Lexer tokens now carry line and column metadata, and parser errors are surfaced as structured diagnostics in the CLI
- Decide when to remove `runtime.rs` and `eval.rs`, or keep them as a compatibility fallback
- Add focused tests for any legacy behavior that must stay supported before deleting duplicated logic
- Rename or document `runtime.rs` clearly as legacy-only if it remains in the tree

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

1. Add runtime errors for unknown variables, invalid index access, unsupported operations, and divide-by-zero
2. Decide whether the legacy runtime should be removed or explicitly documented as compatibility mode
3. Add golden output tests for `examples/hello.solve`, `functions.solve`, `arrays.solve`, and `agent.solve`
4. Expand parser recovery so one malformed statement does not cascade into duplicate diagnostics
5. Start tracking source spans on AST nodes for runtime error locations

## Long-Term Direction

SolveLang should become a simple, readable, safe, and AI-native language for:

- automation
- APIs
- web apps
- data workflows
- tool-using agents

The immediate engineering priority is tightening correctness and diagnostics now that the compiler pipeline runs end to end.
