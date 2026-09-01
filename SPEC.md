# SolveLang language specification

**Version:** 0.1 (implementation-backed draft)
**Status:** early beta; the Rust `solvec` runtime is normative.

This specification describes the executable language implemented by `solvec`.
It does not promise a static type system, concurrency, remote packages, browser
parity, managed execution, or a networked registry. Those are not 0.1 features.
The [language reference](docs/language-reference.md) provides task-oriented
examples; this document defines the compatibility boundary.

## Source text and lexical elements

Source is UTF-8. Newlines conventionally separate statements, but are optional
where adjacent statement syntax is unambiguous; braces delimit blocks.
Spaces, tabs, and carriage returns outside strings are ignored. Line comments
begin with `//` and continue to the newline.

Identifiers begin with an ASCII letter or `_`, followed by Unicode
alphanumeric characters or `_`. Reserved words are `let`, `fn`, `return`, `if`, `else`,
`while`, `for`, `in`, `break`, `continue`, `print`, `true`, `false`, `and`,
`or`, `not`, `agent`, `tool`, `instruction`, and `ask`.

`import`, `export`, `as`, and `from` are contextual words. They keep their
ordinary identifier meaning unless they occur in one of the complete top-level
explicit-module forms defined below. The exact legacy include form
`import "relative/path.solve"` remains a separate source-level compatibility
directive.

Text literals use double quotes. Implemented escapes are `\"`, `\\`, `\n`,
`\t`, and `\r`; an unrecognized escaped character is represented without its
backslash. Source numbers are decimal digits in `0..=2147483647`; negative
values are produced by arithmetic, not a unary-minus production. Invalid
characters and out-of-range source literals produce source-located diagnostics.

## Grammar

The EBNF below describes parsed SolveLang statements after any legacy
compatibility includes have been expanded. Explicit module imports are **not**
flattened: they remain top-level language statements and are resolved as a
module graph before execution.

`{ x }` is repetition and `[ x ]` is optional.

```text
program           = { newline } { topLevelStatement { newline } } EOF ;
topLevelStatement = exportStmt | namespaceImportStmt | namedImportStmt | statement ;

exportStmt        = "export" ( letStmt | functionStmt ) ;
namespaceImportStmt
                  = "import" text "as" identifier ;
namedImportStmt   = "import" "{" importBinding { "," importBinding } [ "," ] "}"
                    "from" text ;
importBinding     = identifier [ "as" identifier ] ;

statement      = letStmt | assignStmt | printStmt | returnStmt | functionStmt
               | ifStmt | whileStmt | forStmt | breakStmt | continueStmt
               | agentStmt | askStmt | expression ;
letStmt        = "let" identifier "=" expression ;
assignStmt     = identifier "=" expression ;
printStmt      = "print" "(" expression ")" ;
returnStmt     = "return" expression ;
functionStmt   = "fn" identifier "(" [ identifier { "," identifier } [ "," ] ] ")" block ;
ifStmt         = "if" expression block [ { newline } "else" block ] ;
whileStmt      = "while" expression block ;
forStmt        = "for" identifier "in" expression block ;
breakStmt      = "break" ;
continueStmt   = "continue" ;
agentStmt      = "agent" identifier "{" { newline }
               { ( "instruction" text | "tool" identifier ) { newline } } "}" ;
askStmt        = "ask" identifier "(" expression ")" ;
block          = "{" { newline } { statement { newline } } "}" ;

expression     = or ;
or             = and { "or" and } ;
and            = equality { "and" equality } ;
equality       = comparison { ( "==" | "!=" ) comparison } ;
comparison     = term { ( ">" | ">=" | "<" | "<=" ) term } ;
term           = factor { ( "+" | "-" | ".." ) factor } ;
factor         = unary { ( "*" | "/" ) unary } ;
unary          = { "not" } postfix ;
postfix        = primary { "[" expression "]" | "." identifier | moduleCallSuffix } ;
moduleCallSuffix
               = "(" [ expression { "," expression } [ "," ] ] ")" ;
primary        = number | text | "true" | "false" | identifier
               | identifier "(" [ expression { "," expression } [ "," ] ] ")"
               | "(" expression ")" | array | object ;
array          = "[" [ expression { "," expression } [ "," ] ] "]" ;
object         = "{" { newline } [ objectKey ":" expression { newline }
               { "," { newline } objectKey ":" expression { newline } }
               [ "," { newline } ] ] "}" ;
objectKey      = identifier | text ;
```

`exportStmt`, `namespaceImportStmt`, and `namedImportStmt` are top-level only.
`export` may prefix only `let` or `fn`. A named import list must be non-empty.
The `moduleCallSuffix` is accepted only when its current receiver is a direct
`identifier.member` property expression, so the implemented postfix call form
is `namespace.member(...)`; arbitrary first-class expression calls are not part
of 0.1.

Operators at each grammar level associate left-to-right. Levels are listed from
lowest to highest precedence. Postfix property/index access binds more tightly
than `not`; `not` binds more tightly than arithmetic.

## Values and execution

The runtime values are `number`, `text`, `bool`, `array`, `object`, and `null`.
Numbers are signed 32-bit integers. Arithmetic reports overflow and division by
zero; it does not coerce invalid operands to zero. Objects have string keys and
deterministic lexicographic key order when rendered or enumerated.

`false`, `null`, zero, empty text, empty arrays, and empty objects are falsey;
all other values are truthy. Ordered comparisons require numbers. Equality and
inequality compare values without numeric coercion. `..` renders operands as
text and joins them.

Variables are dynamically typed. `let` creates a binding and assignment updates
an existing binding. Unknown variables/functions, invalid arity, invalid operand
categories, invalid indexes, and invalid property receivers are source-located
runtime errors. Missing object properties and missing text-key indexes return
`null` for compatibility.

Functions have positional parameters and explicit `return`. `break` and
`continue` are valid only in a `while` or `for` body and target the nearest
loop. `for` accepts arrays only. Both loop forms are limited to 10,000
iterations; arrays longer than that are rejected before a `for` body runs.

## Builtins and capabilities

`length`, `is_empty`, `contains`, `get`, `keys`, `values`, `entries`,
`json_parse`, and `json_stringify` are deterministic pure builtins. They remain
available under hardened execution; argument/result details are in the
[language reference](docs/language-reference.md).

The runtime also implements host-capability builtins for file, environment,
HTTP, and experimental agent/provider behavior. `run --safe`, `--dry-run`,
`--no-network`, and `--json` select hardened policy: capability-bearing and
unknown/mutation-style calls are denied before execution.

Hardened preflight is deliberately conservative about user-defined functions:
it checks a function body when its declaration is encountered, and permits a
call only when the declaration is already available at that point in the
enclosing source path. A helper declared later, or a declaration nested in a
conditional or loop, may run normally outside hardened mode but can be
rejected before execution under hardened policy. This static restriction avoids
executing source to resolve dynamic function rebinding.

`agent`, `tool`, `instruction`, and `ask` are experimental; they are not a
stable provider contract or an unattended production-workflow guarantee.

## Imports and explicit local modules

SolveLang 0.1 has two intentionally distinct local-source mechanisms.

### Legacy compatibility include

The exact source form `import "relative/path.solve"`, followed only by
whitespace and an optional `//` comment/end of line, is a compatibility include.
It resolves relative to the importing file, flattens the imported source before
ordinary program parsing/execution, preserves line-level provenance, and rejects
cycles with a deterministic root-relative chain. It creates no namespace or
export boundary.

Under hardened execution, legacy includes must be relative regular `.solve`
files confined below the workflow root. Absolute paths, parent traversal,
non-`.solve` targets, and symlink escapes fail before imported content is used.

### Explicit local modules

The explicit forms are:

```solve
// module source
export let api_version = 1
export fn add(left, right) { return left + right }

// importer
import "math.solve" as math
import { api_version as version, add } from "math.solve"

print(math.add(version, 2))
print(add(3, 4))
```

An explicit module exposes only declarations marked with `export`. Private
module declarations remain available to functions defined in that module but
are never exposed through an importer namespace or named import.

Namespace and named-import bindings are module-scope, read-only **live**
bindings. Reads observe the exporting module's current exported value, including
changes made by functions executing inside that module. Importers cannot assign
to or call through a binding in a way that mutates the import binding itself.
Missing/private exports fail during graph validation rather than being invented
at runtime.

Module-scope import names cannot collide with module-scope variables, functions,
builtins, the injected `input` global, or another import binding. Function
parameters, function-local `let`s, nested-block `let`s, and loop variables may
lexically shadow imports. Lexical bindings win over imports within their scope.
A `let` shadow becomes active only **after** its initializer is evaluated, so in
`let state = state.value` the initializer can still read an otherwise-visible
imported namespace named `state`, while subsequent local uses refer to the new
binding.

Explicit imports resolve only relative local `.solve` files. Resolution uses a
canonical local identity, rejects unsafe traversal/absolute/backslash/non-file
or escaping targets, builds and validates the complete explicit-module graph,
checks export surfaces and cycles, and completes before any module or entry
source is evaluated. There is no package fallback, index lookup, environment
search path, user-directory lookup, registry, dependency installation, or
network resolution.

Each canonical explicit module initializes exactly once per workflow run in
deterministic dependency order. A module top level may contain explicit module
imports plus exported or private `let`/`fn` declarations. It may not perform
ordinary executable side effects such as `print`, control flow, agents, asks,
assignments, expression statements, or calls. Module `let` initializers are
restricted to a pure no-call expression subset. Module initialization is
transactional: a failing initialization phase does not leave partially committed
module state, and a reused runtime starts a fresh workflow/module epoch while
preserving only explicit host input/configuration.

Imported runtime errors retain the defining module's source provenance. Hardened
preflight validates the complete resolved module graph before entry execution,
so capability-bearing module helpers cannot be hidden behind import order.

The accepted detailed syntax/runtime contract is
[ADR 0003](docs/adr/0003-explicit-local-module-syntax.md); the local identity and
security boundary is [ADR 0001](docs/adr/0001-local-modules-and-packages.md).

## Diagnostics and deterministic behavior

Parser, conservative semantic-check, lint, and runtime diagnostics identify a
line and column and, where source is available, show source text, a caret, and a
hint. Legacy included-source and explicit-module diagnostics retain the relevant
local source provenance. Parser recovery is statement-oriented and may report
independently malformed statements.

Given identical source, input, execution policy, and supported host responses,
pure evaluation and output ordering are deterministic. Explicit local-module
graph ordering and initialization are deterministic for the same local source
tree. Host capabilities and experimental AI/provider output are outside that
guarantee.

## JSON CLI contract

`solvec run --json` reads optional JSON input as a read-only global `input` and
emits one hardened, deterministic, advisory JSON envelope. Input accepts JSON
null, booleans, strings, arrays, objects, and signed 32-bit integers. Decimals,
out-of-range numbers, malformed JSON, and input larger than 1 MiB fail before
source loading. Printed values become typed outputs. This is a local CLI
contract, not a general remote API.

## Compatibility and conformance

The documented CLI surface is `run`, `validate`, `check`, `lint`, `fmt`,
`tokens`, `ast`, and `help`, plus documented compatibility flags. The executable
contract is covered by parser/runtime unit tests and `solvec/tests/`, including
arithmetic/overflow, diagnostics, loop control, legacy imports/provenance,
explicit local modules, hardened policy, JSON atomicity, and deterministic
output. `solvec/tests/fixtures/spec-0.1/` contains implementation-backed
conformance fixtures for the 0.1 contract.

Any specification change must add executable conformance coverage. The 0.1
explicit-module subset does **not** imply package manifests, bare specifiers,
remote packages/registries, dependency installation, semver solving, a static
type system, concurrency, or WASM/browser parity. Those remain separate
versioned architecture decisions and require their own conformance evidence.
