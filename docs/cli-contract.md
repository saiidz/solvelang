# CLI contract — unreleased pre-1.0

`solvec version`, `--version`, and `-V` print `solvec <Cargo package version>` and one newline. No arguments, `help`, `--help`, and `-h` print the same fixture-pinned help. Existing command/flag and legacy `file --tokens` / `file --ast` aliases remain unchanged; removed legacy execution stays rejected.

## Streams and status

Explicit help, version, and successful command results use stdout. Human failures and their usage text use stderr; usage errors leave stdout empty. Human execution may have printed output before a runtime error; it is not transactional output. Hardened human runs retain their existing advisory line on stdout. In `--json` mode, success and failure emit exactly one JSON document on stdout and no human diagnostics on stderr. JSON mode continues to imply hardened execution; no capability is enabled by this contract.

| Exit | Category |
| --- | --- |
| 0 | Success (including lint warnings, help, version) |
| 1 | Unclassified failure, reserved fallback |
| 2 | Invalid arguments or execution-policy options |
| 3 | Source load or explicit JSON input failure/size rejection |
| 4 | Invalid workflow/static semantics or formatting check failure |
| 5 | Import/capability/read-only-input policy denial |
| 6 | Runtime evaluation failure |
| 7 | Signed-gate refusal (the specific `gate_*` code is in the message) |

OS termination/signals are outside this application status contract. Consumers must continue to treat every nonzero status as failure. Do not use a status as authorization to retry a side effect.

## Machine-readable envelope

`run --json` emits `schema: "solvelang.cli-run"` and `version: 1`, as defined in [the JSON schema](../solvec/qa/cli-run-v1.schema.json). Existing advisory, result, and sanitized error fields are retained. Failure output never adds source text, paths, input values, or partial runtime outputs. Version negotiation is not supported; consumers should reject unknown versions. Help/version themselves are text commands and reject extra arguments including `--json` through the error envelope.

Migration from the earlier unversioned pre-release: accept the two additive schema fields; do not assume every failure is exit 1; read invalid-argument usage from stderr rather than stdout. No tagged release is published by this change.

## Signed gates

`solvec keygen --id <id> --out <key-file> [--force]` generates an
Ed25519 gate signing key, writes the private-key artifact owner-only,
and prints the public registry entry on stdout. `solvec sign
<file.solve> --gate <name> --key <key-file> [--registry <file>]
[--signatures <file>] [--not-before <unix>] [--not-after <unix>]`
signs one gate into the signatures artifact (defaults:
`solve-keys.json` and `<file>.signatures.json` beside the workflow);
it fails without producing a signature when the key is unregistered,
revoked, mismatched, or not declared by the gate. `solvec run`
accepts `--keys <file>` and `--signatures <file>` with the same
defaults. A gate refusal is exit 7 with the specific code in the
human message; in `--json` mode the envelope error code is
`gate_refused`. A signatures artifact naming a gate the workflow no
longer declares refuses the run before execution (`gate_removed`).
See [signed gates](signed-gates.md).
