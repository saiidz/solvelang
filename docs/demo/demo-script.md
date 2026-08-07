# Demo Scripts

## 90-second version

### 0-15 seconds — problem

“Business workflows often end up split across visual automations, prompts, application code, and undocumented human decisions. SolveLang is an early-beta workflow language designed to make those decisions readable and reviewable.”

### 15-40 seconds — readable source

Open `examples/support_triage.solve`.

Explain:
- the ticket data is explicit
- urgent routing is deterministic
- billing ownership is deterministic
- the logic can live in Git and be code-reviewed

### 40-65 seconds — executable proof

Run:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

Explain that the Rust CLI is the canonical runtime.

### 65-80 seconds — maturity

Show the landing-page status section or `docs/demo-status.md`.

Say:

“The browser preview and Studio are useful derived experiences. AI helpers and API/account infrastructure are experimental. Managed production execution is planned.”

### 80-90 seconds — why it matters

“Technically, this project demonstrates language implementation, runtime safety, product engineering, serverless/IAM work, and AI workflow design. Commercially, I’m using the same readable-workflow methodology for scoped audits and implementation work before trying to turn it into a SaaS.”

---

## 5-minute version

### Minute 0-1 — positioning

State the positioning and explain what SolveLang is not:
- not another connector marketplace
- not a replacement for Temporal or Airflow
- not a no-code canvas
- not a production multi-agent platform today

Explain the middle-layer idea: business intent that is simpler to discuss than application plumbing and easier to review than a visual canvas.

### Minute 1-2 — language/runtime

Open the support-triage example and point to:
- variables and objects
- conditions
- readable string output
- source-controlled policy

Then show the language reference briefly.

### Minute 2-3 — run and safety

Run validation and execution.

Then show a deliberately invalid script or a known runtime error, for example an out-of-bounds array access, to demonstrate source-located diagnostics.

If appropriate, explain hardened execution:

```bash
cargo run -- run --safe ../examples/hello.solve
```

Explain that hardened modes deny sensitive capabilities before evaluation.

### Minute 3-4 — product surfaces

Show `/studio/` and explain:
- local-first
- deterministic analysis
- broader workflow model than executable syntax
- generated `.solve` output is preliminary and should be validated with the CLI

Show `/run/` and explain its smaller safe subset.

### Minute 4-5 — platform and roadmap

Discuss the test-mode API/account infrastructure as an engineering proof point, not production SaaS availability.

Close with:
- consulting-first revenue path
- productization only after repeated demand
- adapters/managed execution as evidence-led future work

---

## Live technical walkthrough

### Preflight

From a clean checkout:

```bash
cd solvec
cargo test
cargo run -- validate ../examples/support_triage.solve
```

For the website when dependencies are installed:

```bash
cd site
npm run lint
npm run test:studio
npm run build
```

### Happy path

1. Open repository root README.
2. Open support-triage source.
3. Run `validate`.
4. Run `run`.
5. Explain AST/runtime boundary.
6. Open `/studio/`.
7. Open `/run/`.
8. Open `/status/`.
9. End on architecture/recruiter docs depending on audience.

## Failure cases to demonstrate

### Syntax/validation failure

Use a malformed `.solve` file and show that validation fails before runtime side effects.

### Runtime type or indexing failure

Use a known invalid operation to show source-located runtime diagnostics.

### Hardened capability denial

Use a workflow containing a denied capability under `--safe` or JSON/hardened mode. Explain that restrictions are policy, not merely UI warnings.

### Provider failure

Do not intentionally call paid or live AI providers in a standard interview demo. If provider behavior is demonstrated, use a controlled test environment and explain that output is variable.

### GitHub CI outage

If GitHub Actions is degraded, use local validation evidence and the public `/status/` page. Label the incident as an upstream CI/deployment dependency problem rather than a SolveLang runtime outage.

## Recovery flow

If a live demo step fails:

1. State what failed and which layer owns it.
2. Fall back to the deterministic local CLI.
3. Use saved screenshots only as secondary evidence, never as a substitute for explaining the failure.
4. Show the corresponding test or source file.
5. Do not improvise production-readiness claims to compensate for a failed demo.

A clean recovery is itself evidence of platform and incident-awareness skills.
