# SolveLang language specification

**Version:** 0.1 (implementation-backed draft)  
**Status:** versioned pre-1.0; the Rust `solvec` runtime is normative.

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
alphanumeric characters or `_`. Reserved words are `let`, `fn`, `return`, `if`,
`else`, `while`, `for`, `in`, `break`, `continue`, `print`, `true`, `false`,
`and`, `or`, `not`, `agent`, `tool`, `instruction`, `ask`, `gate`,
`evidence`, and `signer`. The words
`import`, `export`, `as`, and `from` are contextual: they are recognized as
module syntax only in the complete top-level forms defined below, so ordinary
identifier uses remain compatible where they do not form one of those forms.

Text literals use double quotes. Implemented escapes are `\"`, `\\`, `\n`,
`\t`, and `\r`; an unrecognized escaped character is represented without its
backslash. Source numbers are decimal digits in `0..=2147483647`; negative
values are produced by arithmetic, not a unary-minus production. Invalid
characters and out-of-range source literals produce source-located diagnostics.

## Grammar

SolveLang has ordinary statements plus three explicit module forms that are
valid only at top level. The legacy quoted include remains a fourth, distinct
top-level compatibility form. `{ x }` is repetition and `[ x ]` is optional.

```text
program          = { newline } { topLevelStatement { newline } } EOF ;
topLevelStatement
                 = exportDecl | namespaceImport | namedImport | legacyInclude
                 | statement ;

exportDecl       = "export" ( letDecl | functionDecl ) ;
namespaceImport  = "import" text "as" identifier ;
namedImport      = "import" "{" importBinding { "," importBinding } [ "," ] "}"
                   "from" text ;
importBinding    = identifier [ "as" identifier ] ;
legacyInclude    = "import" text ;

statement        = letDecl | assignStmt | printStmt | returnStmt | functionDecl
                 | ifStmt | whileStmt | forStmt | breakStmt | continueStmt
                 | agentStmt | askStmt | gateStmt | expression ;
letDecl          = "let" identifier "=" expression ;
assignStmt       = identifier "=" expression ;
printStmt        = "print" "(" expression ")" ;
returnStmt       = "return" expression ;
functionDecl     = "fn" identifier "(" [ identifier { "," identifier } [ "," ] ] ")" block ;
ifStmt           = "if" expression block [ { newline } "else" block ] ;
whileStmt        = "while" expression block ;
forStmt          = "for" identifier "in" expression block ;
breakStmt        = "break" ;
continueStmt     = "continue" ;
agentStmt        = "agent" identifier "{" { newline }
                   { ( "instruction" text | "tool" identifier ) { newline } } "}" ;
askStmt          = "ask" identifier "(" expression ")" ;
gateStmt         = "gate" identifier "{" { newline }
                   { ( "evidence" text | "signer" identifier ) { newline } } "}" ;
block            = "{" { newline } { statement { newline } } "}" ;

expression       = or ;
or               = and { "or" and } ;
and              = equality { "and" equality } ;
equality         = comparison { ( "==" | "!=" ) comparison } ;
comparison       = term { ( ">" | ">=" | "<" | "<=" ) term } ;
term             = factor { ( "+" | "-" | ".." ) factor } ;
factor           = unary { ( "*" | "/" ) unary } ;
unary            = { "not" } postfix ;
postfix          = primary { "[" expression "]" | "." identifier } ;
primary          = number | text | "true" | "false" | moduleCall | identifier
                 | identifier "(" [ expression { "," expression } [ "," ] ] ")"
                 | "(" expression ")" | array | object ;
moduleCall       = identifier "." identifier "("
                   [ expression { "," expression } [ "," ] ] ")" ;
array            = "[" [ expression { "," expression } [ "," ] ] "]" ;
object           = "{" { newline } [ objectKey ":" expression { newline }
                   { "," { newline } objectKey ":" expression { newline } }
                   [ "," { newline } ] ] "}" ;
objectKey        = identifier | text ;
```

`exportDecl`, `namespaceImport`, `namedImport`, and `legacyInclude` are rejected
inside blocks. `export` may prefix only a top-level `let` or `fn`. A named import
list is non-empty. A namespace import requires `as`; omitting it leaves the form
as the legacy include compatibility syntax.

Operators at each grammar level associate left-to-right. Levels are listed from
lowest to highest precedence. Postfix property/index access binds more tightly
than `not`; `not` binds more tightly than arithmetic. The runtime recognizes a
namespace member call such as `math.add(1, 2)` as an explicit module call rather
than as an arbitrary callable object-property value.

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
unknown/mutation-style calls are denied before execution. Hardened source
resolution must remain confined to relative regular `.solve` files below the
entry workflow's canonical parent; absolute paths, parent traversal, backslash
paths, non-`.solve` targets, and symlink escapes fail closed.

Hardened preflight is deliberately conservative about user-defined functions:
it checks a function body when its declaration is encountered, and permits a
call only when the declaration is already available at that point in the
enclosing source path. A helper declared later, or a declaration nested in a
conditional or loop, may run normally outside hardened mode but can be
rejected before execution under hardened policy. This static restriction avoids
executing source to resolve dynamic function rebinding.

`agent`, `tool`, `instruction`, and `ask` are experimental; they are not a
stable provider contract or an unattended production-workflow guarantee.

## Signed gates

A `gate` statement declares a checkpoint that execution may pass only
with a valid Ed25519 signature from a registered key. The declaration
names the gate, gives one required `evidence` entry (a text path,
resolved inside the entry workflow's directory tree), and may list
`signer` key ids; an empty signer list admits any registered, active
key. Gate names are unique per workflow (duplicates are a semantic
error). Signer ids are identifiers, so key ids used in a gate block
must be identifier-shaped.

The signature covers a canonical byte record binding the gate name,
the SHA-256 digest of the exact configured entry source (including
flattened legacy includes), the SHA-256 digest of the evidence
bytes, the signer id, and an optional validity window; the canonical
form is versioned (`solvelang-gate-signature-v1`) and defined once in
the core so signer and verifier cannot drift. When execution reaches
a gate, the evaluator verifies — in order — signature presence,
declared-signer match, workflow digest, evidence availability and
digest, and the validity window against the host-supplied clock, and
the host then verifies the signature against its public-key
registry. Every failure is a refusal with a distinct stable code
(`gate_unsigned`, `gate_signer_not_allowed`, `gate_workflow_mismatch`,
`gate_evidence_unavailable`, `gate_evidence_mismatch`,
`gate_clock_unavailable`, `gate_not_yet_valid`, `gate_expired`,
`gate_unknown_signer`, `gate_signer_revoked`, `gate_signature_invalid`,
`gate_verification_unavailable`, `gate_unconfigured`,
`gate_module_context`, `gate_removed`); the run aborts and no later
statement executes. A signatures artifact that names a gate the
workflow no longer declares refuses the run before execution
(`gate_removed`). Hosts that cannot verify signatures refuse every
gate (`gate_verification_unavailable`): refusal is the default, not
a warning. Gates are entry-workflow statements in this version; a
gate reached while an explicit module executes refuses
`gate_module_context`. The formats, tooling, and honest limits are
documented in [signed gates](docs/signed-gates.md). Any change to
this section must add executable conformance coverage (the gate
suites in `solvec-core/tests/` and `solvec/tests/`).

## Local modules and legacy includes

SolveLang 0.1 implements explicit **local** modules. It does not implement a
package manager, bare package specifiers, manifests, registry resolution,
dependency installation, remote fetching, or semver solving.

A module exposes only declarations prefixed by `export`:

```solve
export let api_version = 1
export fn add(left, right) { return left + right }
```

An importer may bind the module as a namespace:

```solve
import "math.solve" as math
print(math.add(1, 2))
```

or bind selected exports, optionally under local aliases:

```solve
import { api_version as version, add } from "math.solve"
print(add(version, 2))
```

### Bindings and lexical precedence

Explicit import bindings live at module scope. They may not collide there with
an existing module-scope variable, function, builtin, the injected `input`
global, or another import binding. Named imports may not duplicate an exported
name or local name in the same import list.

Function parameters, function-local `let` bindings, nested-block `let` bindings,
and loop variables may lexically shadow import bindings. The active lexical
binding takes precedence over the import. A `let` shadow becomes active only
after its initializer is evaluated, so in `let state = state.value` the
initializer may still read an otherwise-visible imported namespace named
`state`, while later uses resolve to the local binding.

Imported namespace members and named imports are read-only live bindings. Reads
observe the exporting module's current exported value. Imported functions run
in their defining module and may access that module's private declarations.
Importers cannot assign to imported bindings, and a namespace exposes only the
target module's explicit exports.

### Resolution, validation, and evaluation

Explicit module paths use deterministic repository-local resolution. Before any
module evaluator runs, the runtime builds and validates the reachable module
graph, including target confinement, cycles, export existence/visibility, and
module-scope binding collisions. Cycle diagnostics use a deterministic
root-relative chain. The resolver does not fall back to another extension,
index file, manifest, package name, environment path, user directory, or remote
source.

Each canonical explicit module is parsed and evaluated at most once per workflow
run, in deterministic dependency order. Module initialization is transactional:
a failed graph/module evaluation does not leave partially initialized module
state available to the workflow, and a later workflow run does not reuse stale
module or entry state from an earlier run.

An explicit-module source is intentionally side-effect restricted at top level.
It may contain explicit imports, exported declarations, and private top-level
`let`/`fn` declarations. Module `let` initializers are restricted to the pure
no-call expression subset supported by the implementation: literals, arrays,
objects, already-available module-value reads, and their pure operators and
property/index access. Top-level `print`, control flow, agents, asks,
assignments, expression statements, and call expressions are rejected. Function
bodies remain subject to normal runtime and hardened capability policy when
called.

The legacy `import "relative/path.solve"` form remains a compatibility include,
not an explicit module. It resolves relative to the importing file, flattens the
included source into the importing program, preserves source provenance, and
rejects deterministic include cycles. A trailing `//` comment is accepted on
the include line. It does not create an export surface or namespace.

Hardened mode applies the same fail-closed local path boundary to both explicit
modules and legacy includes. Absolute paths, parent traversal, backslashes,
non-`.solve` targets, non-regular targets, outside-root resolution, and symlink
escapes are rejected before evaluation.

## Diagnostics and deterministic behavior

Parser, conservative semantic-check, lint, module-graph, and runtime diagnostics
identify a line and column and, where source is available, show source text, a
caret, and a hint. Imported/module-source diagnostics retain the relevant source
identity and local location. Parser recovery is statement-oriented and may
report independently malformed statements.

Given identical source, input, execution policy, and supported host responses,
pure evaluation, explicit-module dependency ordering, and output ordering are
deterministic. Host capabilities and experimental AI/provider output are outside
that guarantee.

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
including arithmetic/overflow, diagnostics, loop control, legacy
imports/provenance, explicit local-module graph/export/import behavior, lexical
shadowing and initializer ordering, transactional initialization, hardened
policy, JSON atomicity, and deterministic output.

Any specification change must add executable conformance coverage. Static typing,
remote package/registry behavior, and a WASM-safe core require separate
versioned designs and conformance suites; they are not silently introduced by
this 0.1 local-module contract.
