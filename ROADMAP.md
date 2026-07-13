# SolveLang Roadmap

SolveLang is an early language prototype written in Rust. The project has a working lexer, parser, AST, and one canonical AST runtime. The former line-based runtime files and public legacy CLI entry points have been removed.

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
- Runtime-relevant AST nodes retain source locations from lexer tokens
- Runtime errors render source line, column, caret, and hints where available
- Invalid numeric arithmetic and ordered comparisons return structured errors instead of coercing values to zero
- Invalid array/object/property access returns structured errors instead of silently returning `null`
- User-defined function calls validate argument counts
- Parser recovery synchronizes at statement boundaries to limit cascading diagnostics
- Deterministic golden tests cover the shipped examples without external internet

Remaining limitation:

- Imported files are flattened before parsing, so a diagnostic in imported content currently reports the combined source line and top-level filename rather than the original imported filename.

## Phase 2: Tighten Language Semantics

The first correctness and diagnostics milestone is complete. Future semantic work should build on the source-located AST runtime without changing the documented compatibility behavior for missing object properties (`null`) unless a deliberate language-version change is made.

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
- `solvec validate file.solve`
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

1. Preserve original filenames and line mappings for imported source diagnostics
2. Add more standard-library behavior tests as built-ins grow
3. Evaluate static type checks only after runtime semantics have stabilized
4. Keep examples and language reference tests synchronized with the AST runtime

## Long-Term Direction

SolveLang should become a simple, readable, safe, and AI-native language for:

- automation
- APIs
- web apps
- data workflows
- tool-using agents

The immediate engineering priority is tightening correctness and diagnostics now that the compiler pipeline runs end to end.
