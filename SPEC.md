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

Text literals use double quotes. Implemented escapes are `\"`, `\\`, `\n`,
`\t`, and `\r`; an unrecognized escaped character is represented without its
backslash. Source numbers are decimal digits in `0..=2147483647`; negative
values are produced by arithmetic, not a unary-minus production. Invalid
characters and out-of-range source literals produce source-located diagnostics.

## Grammar

The EBNF below is the implemented syntactic surface *after import expansion*.
`import "relative/path.solve"` is a source-level directive recognized before
lexing: it may be followed by whitespace and a `//` comment, and the imported
source replaces the directive before this grammar is applied. `{ x }` is
repetition and `[ x ]` is optional.

```text
program        = { newline } { statement { newline } } EOF ;
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
postfix        = primary { "[" expression "]" | "." identifier } ;
primary        = number | text | "true" | "false" | identifier
               | identifier "(" [ expression { "," expression } [ "," ] ] ")"
               | "(" expression ")" | array | object ;
array          = "[" [ expression { "," expression } [ "," ] ] "]" ;
object         = "{" { newline } [ objectKey ":" expression { newline }
               { "," { newline } objectKey ":" expression { newline } }
               [ "," { newline } ] ] "}" ;
objectKey      = identifier | text ;
```

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
unknown/mutation-style calls are denied before execution. Hardened imports must
be confined relative regular `.solve` files below the entry workflow's canonical
parent; absolute paths, parent traversal, non-`.solve` targets, and symlink
escapes fail closed.

Hardened preflight is deliberately conservative about user-defined functions:
it checks a function body when its declaration is encountered, and permits a
call only when the declaration is already available at that point in the
enclosing source path. A helper declared later, or a declaration nested in a
conditional or loop, may run normally outside hardened mode but can be
rejected before execution under hardened policy. This static restriction avoids
executing source to resolve dynamic function rebinding.

`agent`, `tool`, `instruction`, and `ask` are experimental; they are not a
stable provider contract or an unattended production-workflow guarantee.

## Imports, diagnostics, and deterministic behavior

`import "relative/path.solve"` is a compatibility include, not a module or
package system. It is deliberately a pre-lexing source directive rather than a
`statement` in the EBNF above; a trailing `//` comment is accepted on the same
line. Imports resolve relative to the importing file, flatten before parsing,
preserve line-level provenance, and reject cycles with a deterministic
root-relative chain. 0.1 has no exports, namespaces, manifests, or remote
resolution.

Parser, conservative semantic-check, lint, and runtime diagnostics identify a
line and column and, where source is available, show source text, a caret, and a
hint. Imported-source diagnostics identify the relevant imported path/local line.
Parser recovery is statement-oriented and may report independently malformed
statements.

Given identical source, input, execution policy, and supported host responses,
pure evaluation and output ordering are deterministic. Host capabilities and
experimental AI/provider output are outside that guarantee.

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
contract is covered by parser/runtime unit tests and `solvec/tests/cli.rs`,
including arithmetic/overflow, diagnostics, loop control, imports/provenance,
hardened policy, JSON atomicity, and deterministic output.

Any specification change must add executable conformance coverage. A module
system, static type system, and WASM-safe core require separate versioned designs
and conformance suites; they are not silently introduced in 0.1.
