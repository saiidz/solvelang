# SolveLang Runtime Safety

SolveLang is an early beta language runtime. Run scripts you trust by default, and use safe mode when you want to execute a script with side-effecting capabilities denied unless explicitly allowed.

## Safe Mode

Run a script in safe mode:

```bash
cd solvec
cargo run -- run --safe ../examples/hello.solve
```

Safe mode denies:

- network access
- file reads
- file writes
- environment-variable access

Denied operations return readable `SolveLang Runtime Error` messages. Safe mode still parses and executes normal in-memory language features such as variables, arrays, objects, conditionals, loops, functions, and `print`.

## Capability Flags

Allow only the capabilities a script needs:

```bash
cargo run -- run --safe --allow-network ./workflow.solve
cargo run -- run --safe --allow-env ./workflow.solve
cargo run -- run --safe --allow-file-read --allow-root /tmp/solvelang-inputs ./workflow.solve
cargo run -- run --safe --allow-file-write --allow-root /tmp/solvelang-output ./workflow.solve
```

Capability flags:

- `--allow-network` enables `http_get`, `http_post`, and OpenAI-backed `ask` network access.
- `--allow-file-read` enables `read_file`.
- `--allow-file-write` enables `write_file`.
- `--allow-env` enables `env` and AI provider configuration reads.
- `--allow-root <path>` restricts file access to a canonical filesystem root.

For OpenAI-backed `ask`, safe mode requires both environment access and network access because provider configuration is read from environment variables and the provider call uses the network.

## Filesystem Roots

Allowed roots provide a boundary for file builtins:

```bash
cargo run -- run --safe --allow-file-read --allow-root /tmp/intake ./workflow.solve
```

When roots are enforced:

- paths containing `..` are rejected
- paths outside allowed roots are rejected
- file reads must resolve to an existing path inside an allowed root
- file writes must target a file whose parent directory is inside an allowed root

Passing `--allow-root` without `--safe` also restricts file builtins to the provided roots.

## HTTP Limits

HTTP helpers use explicit default limits:

- connect timeout: 5 seconds
- request timeout: 15 seconds
- maximum response body: 1 MB

Override them per run:

```bash
cargo run -- run \
  --http-connect-timeout-ms 5000 \
  --http-timeout-ms 15000 \
  --http-max-body-bytes 1048576 \
  ./workflow.solve
```

These limits apply to `http_get` and `http_post`.

## Validate Vs Run

`validate` only lexes, parses, and runs syntax diagnostics:

```bash
cargo run -- validate ../examples/support_triage.solve
```

It does not execute code, call AI providers, make HTTP requests, read runtime files, write runtime files, or read environment variables.

`run` executes the script. Use `run --safe` when you want execution with network, files, and environment access denied by default.

## Legacy Runtime

The AST runtime is canonical. The public `solvec legacy` command and `--legacy` flag have been removed from the CLI.
