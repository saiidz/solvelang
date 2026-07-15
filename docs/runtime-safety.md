# SolveLang Runtime Safety

SolveLang is an early beta language runtime. A plain `solvec run` is an unrestricted local execution mode for scripts you trust. Use hardened execution for pure, deterministic, advisory-only evaluation.

## Hardened Modes

Any of these flags enables the same strict capability policy:

- `--safe`
- `--dry-run`
- `--no-network`
- `--json`

For the strongest and most explicit local contract, pass all four hardened flags:

```bash
cd solvec
cargo run -- run \
  --input ../examples/upcomingsounds/cli-contract-input.json \
  --json \
  --safe \
  --dry-run \
  --no-network \
  ../examples/upcomingsounds/cli-contract.solve
```

Hardened execution denies:

- `http_get` and `http_post`;
- all agent declarations, tool lists, and `ask` statements;
- runtime `read_file` and `write_file` calls;
- runtime `env` calls and AI-provider configuration reads;
- unknown functions and known shell, process, plugin, payment, email, database, or mutation-style function names.

The CLI statically inspects the complete flattened AST before the first statement executes. Denied calls in function bodies, imported source, and unreachable branches still fail closed. Runtime capability guards remain in place as defense in depth.

Capability-enabling `--allow-network`, `--allow-file-read`, `--allow-file-write`, `--allow-env`, and `--allow-root` flags are rejected when any hardened flag is active. There is no capability override inside hardened mode.

A successful hardened run without `--json` prints `NON-PRODUCTION ADVISORY ONLY` as its first stdout line before workflow output.

## Structured JSON Input

`--input <file>` reads one explicit regular JSON file and injects its parsed value as the read-only global `input`.

The input contract accepts:

- `null`;
- booleans;
- strings;
- arrays;
- objects;
- signed 32-bit integers.

Decimals, integers outside the signed 32-bit range, malformed JSON, symlink inputs, non-regular files, and inputs larger than 1 MiB fail closed. The input is parsed before imports are traversed or workflow statements execute. A workflow cannot declare, assign, or shadow the injected `input` value.

## Deterministic JSON Output

`--json` always activates hardened execution. It captures typed values passed to `print(...)` instead of writing human output as statements execute. A successful run emits exactly one compact JSON document with:

- `ok: true`;
- `advisory: "NON-PRODUCTION ADVISORY ONLY"`;
- `advisory_only: true`;
- the stable `dry_run` flag;
- a typed `outputs` array.

There are no timestamps or random identifiers. Object keys are deterministic. Runtime output is buffered, so a later error discards earlier captured values.

The `dry_run` field records whether `--dry-run` was explicitly supplied. A JSON-only run therefore reports `dry_run: false` while remaining strictly side-effect-free and advisory-only.

Failures emit exactly one parseable JSON error document and exit nonzero. The public error envelope does not echo source text, input contents, query strings, secret values, or full local paths.

## Hardened Source And Import Reads

The effective runtime and source policies are constructed immediately after argument parsing, before the explicit input, entry source, or imports are read.

The entry `.solve` file is the explicit host-selected source. Its canonical parent becomes the source root. In hardened mode every import must:

- use a relative `.solve` path;
- contain no parent traversal, absolute root, or NUL byte;
- resolve to a regular file;
- remain under the canonical entry source root after symlink resolution.

Absolute imports, parent traversal, symlink escapes, missing targets, non-`.solve` targets, and circular imports fail before workflow execution.

These entry, confined-import, and explicit-input reads are CLI admission operations. They do not enable the runtime `read_file` builtin.

## Trusted Unhardened Runs

A plain run preserves the experimental local runtime capabilities:

```bash
cargo run -- run ./trusted-workflow.solve
```

`--allow-root <path>` can constrain file builtins in an unhardened run. Paths containing `..` and resolved paths outside configured roots are rejected. The legacy capability-enabling flags are accepted only outside hardened mode; a plain run is already unrestricted, so they do not make it safer.

HTTP helpers in trusted unhardened runs retain their defaults:

- connection timeout: 5 seconds;
- request timeout: 15 seconds;
- maximum response body: 1 MiB.

## Host Limitations

Hardened mode is an interpreter policy, not an operating-system sandbox. A caller that needs defense against interpreter defects must also supply host controls such as process isolation, CPU/time limits, memory limits, environment clearing, and stdout/stderr caps. The CLI does not provide those host controls in this release.

Input and import admission uses metadata checks, canonicalization, and bounded reads, but those checks and reads are not one atomic operating-system operation. A concurrently replaced local path can create a time-of-check/time-of-use race. Only run against directories and input files controlled by the local caller, and use host isolation when mutually untrusted local processes can replace them.

No hosted runtime, production integration, database access, payment action, email action, issue creation, deployment action, or remote tool execution is added by this contract.

## Validate Vs Run

`validate` lexes, parses, and checks syntax without evaluating statements:

```bash
cargo run -- validate ../examples/support_triage.solve
```

It does not execute code, call AI providers, make HTTP requests, read runtime files, write runtime files, or read environment variables.

## Legacy Runtime

The AST runtime is canonical. The public `solvec legacy` command and `--legacy` flag have been removed from the CLI.
