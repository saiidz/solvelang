# Safe Local JSON CLI Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic JSON-in/JSON-out local CLI contract whose dry-run policy is established before imports or workflow side effects.

**Architecture:** Extend `RunOptions` with structured-input and hardened-mode flags, build execution and source-loading policy immediately after argument parsing, and confine imports before reading them. Inject parsed JSON as read-only `input`, statically preflight denied capabilities, capture typed `print` values in JSON mode, and emit one deterministic advisory envelope.

**Tech Stack:** Rust 2024, `serde_json`, the existing SolveLang lexer/parser/AST runtime, Cargo integration tests.

---

### Task 1: Specify structured CLI behavior with failing integration tests

**Files:**
- Modify: `solvec/tests/cli.rs`

- [ ] **Step 1: Add failing JSON input/output tests**

Use a synthetic JSON file and this workflow shape:

```solve
print("classification prepared")
print({ readiness: input.readiness, count: input.count })
```

Invoke `run --input <file> --json --safe --dry-run --no-network <workflow>` twice. Assert byte-identical stdout, empty stderr, the exact advisory label, and typed output values.

- [ ] **Step 2: Add failing fail-closed tests**

Cover malformed JSON, unsupported decimal and out-of-range numbers, reassignment of `input`, duplicate `--input`, `--dry-run` combined with an allow flag, and JSON-mode parser errors. Each must exit nonzero and return one parseable error envelope without fixture contents.

- [ ] **Step 3: Add failing policy-before-side-effect tests**

Prove a dry-run script containing `write_file` never creates its target, an imported network call is rejected under `--no-network`, an in-root import succeeds, and absolute, traversing, and symlink-escaping imports fail before imported code runs.

- [ ] **Step 4: Verify RED**

Run focused `cargo test --test cli <new-test-name>` commands. Expected: each new test fails because the flags and structured contract do not exist.

### Task 2: Add structured input and captured typed output

**Files:**
- Modify: `solvec/src/value.rs`
- Modify: `solvec/src/ast_runtime.rs`
- Test: `solvec/tests/cli.rs`

- [ ] **Step 1: Add strict JSON conversion helpers**

Move JSON conversion behind crate-visible `Value::from_json` and `Value::to_json` helpers. Accept null, booleans, strings, arrays, objects, and signed 32-bit integers. Reject decimals and out-of-range integers.

- [ ] **Step 2: Inject read-only input and capture output**

Extend `AstRuntime` with optional injected input and a capture flag. Route `print` and `ask` through one `emit(Value)` method. Preserve current human output outside JSON mode and reject declaration or assignment of injected `input`.

- [ ] **Step 3: Verify GREEN for structured runtime behavior**

Run the new JSON input/output and read-only input tests. Expected: PASS while policy/import tests remain RED.

### Task 3: Build policy before loading and preflight unsafe capabilities

**Files:**
- Modify: `solvec/src/main.rs`
- Modify: `solvec/src/ast_runtime.rs`
- Test: `solvec/tests/cli.rs`

- [ ] **Step 1: Parse and validate the new flags**

Add `input_path`, `json`, `dry_run`, and `no_network` to `RunOptions`. Support split and equals input forms, reject duplicates, and reject contradictory capability flags before reading source or input.

- [ ] **Step 2: Build hardened policies first**

Make any of safe, dry-run, no-network, or JSON mode select one strict hardened policy. Reject all capability-enabling `--allow-*` flags in hardened mode, and construct execution and canonical source-loading policies immediately after argument parsing.

- [ ] **Step 3: Constrain imports before reading**

Hardened runs accept only relative `.solve` imports whose canonical paths remain under the entry workflow's canonical parent. Reject parent traversal, absolute paths, and symlink escapes before `read_to_string`.

- [ ] **Step 4: Preflight the parsed AST**

Recursively reject denied calls before executing any statement: `http_get`, `http_post`, and `ask` when network is denied; `read_file`, `write_file`, and `env` when their capabilities are denied. Dry-run must deny every side-effecting capability.

- [ ] **Step 5: Verify GREEN for policy tests**

Run the new dry-run, no-network, unsafe-action, and hardened-import tests. Expected: PASS and no marker file is created.

### Task 4: Emit deterministic advisory envelopes and document the CLI

**Files:**
- Modify: `solvec/src/main.rs`
- Modify: `README.md`
- Modify: `docs/runtime-safety.md`
- Modify: `docs/language-reference.md`
- Create: `examples/upcomingsounds/cli-contract.solve`
- Create: `examples/upcomingsounds/cli-contract-input.json`
- Test: `solvec/tests/cli.rs`

- [ ] **Step 1: Add atomic success and error envelopes**

Success contains `advisory`, `dry_run`, `ok`, and `outputs`. Failure contains `advisory`, `errors`, and `ok`. JSON mode emits no timestamps, usage text, source contents, or partial stdout.

- [ ] **Step 2: Add and test the synthetic example**

Create a pure workflow over fake input and include it in example validation coverage. Document the exact local command with every safety flag.

- [ ] **Step 3: Document remaining host limitations**

State that no-network is an interpreter policy rather than an operating-system sandbox and that host process time, memory, environment clearing, and output caps remain caller responsibilities.

- [ ] **Step 4: Run full verification**

Run:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo build --release
git diff --check
```

Expected: every command exits zero. Loopback HTTP tests may require the approved unsandboxed `cargo test` permission.
