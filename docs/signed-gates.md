# Signed gates

A **gate** is a statement in a SolveLang workflow that execution
cannot pass without a valid cryptographic signature. The workflow
declares the gate and the evidence it guards; a signer approves that
exact workflow and that exact evidence with an Ed25519 key; the
runtime verifies the signature when execution reaches the gate and
**refuses** — halting the run — when anything is missing, unknown,
revoked, expired, or altered. Refusal is the default: there is no
warning mode and no way to step around a gate inside the evaluator.

```solve
print("Preparing release")

gate release {
    evidence "evidence/report.json"
    signer release_key
}

print("Gate passed: release approved")
```

## Declaring a gate

```solve
gate <name> {
    evidence "<relative/path>"
    signer <key-id>
    signer <other-key-id>
}
```

- `evidence` is required and names a file **inside the workflow's
  directory tree**; the runtime reads it when the run is prepared
  and refuses if it cannot.
- `signer` entries are optional and repeatable. When present, only
  those registered keys may sign the gate. When absent, any
  registered, active key may.
- Signer ids in a gate block are language identifiers, so key ids
  used there must be identifier-shaped (for example `release_key`).
- Gate names are unique per workflow (a duplicate is a semantic
  error) and signatures are recorded per gate name.
- Gates are entry-workflow statements. A gate reached while an
  explicit module executes refuses `gate_module_context` (v1 scope).

## What exactly is signed

The signature covers one canonical byte record (the only
implementation is `gate_canonical_payload` in `solvec-core`, shared
by signer and verifier so they cannot drift):

```text
solvelang-gate-signature-v1
workflow-sha256:<hex>
gate:<name>
evidence-sha256:<hex>
signer:<key id>
not-before:<unix seconds or ->
not-after:<unix seconds or ->
```

- **Workflow digest** — SHA-256 of the exact source bytes the
  runtime is configured with (the entry source, including flattened
  legacy includes). *Any* edit to the workflow — even a comment —
  invalidates its signatures. This strictness is deliberate: what
  was approved is byte-for-byte what runs. Source files of explicit
  modules are not part of the digest; gates refuse inside modules
  in v1, so nothing depends on their bytes.
- **Evidence digest** — SHA-256 of the evidence file's bytes at
  signing time; re-checked against the file's current bytes at
  every run.

## Keys: generate, register, revoke

Generate a keypair (the private key file is written owner-only and
must never be committed):

```bash
solvec keygen --id release_key --out release_key.key.json
```

The command prints the public registry entry:

```json
{ "id": "release_key", "algorithm": "ed25519", "public_key": "<base64>", "status": "active" }
```

Add it to the **key registry** — a public, committable JSON file,
default `solve-keys.json` beside the workflow:

```json
{
  "format": "solvelang.key-registry",
  "version": 1,
  "keys": [
    { "id": "release_key", "algorithm": "ed25519", "public_key": "<base64>", "status": "active" }
  ]
}
```

- **Revoke** a key by changing its `status` to `"revoked"`. Runs
  then refuse its signatures with `gate_signer_revoked`. Signing
  with a revoked key is refused by the signer tool as well.
- **Rotate** by registering the new key, re-signing, then revoking
  the old one.

## Signing

```bash
solvec sign release.solve --gate release --key release_key.key.json
```

Options: `--registry <file>` (default `solve-keys.json` beside the
workflow), `--signatures <file>` (default
`<workflow>.signatures.json`), `--not-before <unix>`,
`--not-after <unix>` for a validity window.

The signer tool loads the workflow exactly the way `run` does, and
refuses to sign when the key is not registered, is revoked, does
not match its registry entry, or is not one of the gate's declared
signers. The result is upserted into the **signatures artifact**:

```json
{
  "format": "solvelang.gate-signatures",
  "version": 1,
  "signatures": [
    {
      "gate": "release",
      "workflow_sha256": "<hex>",
      "evidence_sha256": "<hex>",
      "signer": "release_key",
      "not_before": null,
      "not_after": null,
      "signature": "<base64>"
    }
  ]
}
```

## Running

```bash
solvec run release.solve [--keys <registry>] [--signatures <file>]
```

When the run reaches a gate, the evaluator checks, in order:
signature presence → declared-signer match → workflow digest →
evidence availability → evidence digest → validity window (against
the host-supplied clock) → and finally the host verifies the
Ed25519 signature against the registry. Any failure aborts the run;
statements after the gate never execute.

Every refusal exits with **status 7** and carries a distinct code
(in `--json` mode the envelope code is `gate_refused`; the specific
code appears in the human message and the Rust API):

| Code | Meaning |
| --- | --- |
| `gate_unsigned` | No signature record exists for the gate. |
| `gate_signer_not_allowed` | The signer is not in the gate's declared signer list. |
| `gate_workflow_mismatch` | The workflow changed after signing. |
| `gate_evidence_unavailable` | The evidence file could not be read. |
| `gate_evidence_mismatch` | The evidence changed after signing. |
| `gate_clock_unavailable` | The signature has a validity window but no clock was supplied. |
| `gate_not_yet_valid` | The signature's window has not started. |
| `gate_expired` | The signature's window has ended. |
| `gate_unknown_signer` | The signer is not in the key registry. |
| `gate_signer_revoked` | The signer has been revoked in the registry. |
| `gate_signature_invalid` | The signature does not verify (forged, replayed, or corrupted). |
| `gate_verification_unavailable` | The host cannot verify signatures (for example the WASM host), so the gate fails closed. |
| `gate_unconfigured` | The run was given no gate data at all. |
| `gate_module_context` | The gate was reached inside an explicit module (v1 scope limit). |
| `gate_removed` | A signatures artifact names a gate the workflow no longer declares; the run refuses before anything executes. |

The **gate_removed** rule deserves emphasis: if a signatures
artifact travels with a workflow (the normal, committed shape),
deleting a gate declaration from the workflow does not drop the
requirement — the run refuses up front. A workflow with no gates
and no signatures artifact runs exactly as before.

## Honest limits

- A signature attests that **the signer approved this evidence for
  this workflow**. It does not make the evidence *true*. If the
  report is fabricated before signing, the gate faithfully passes
  a lie with a valid signature.
- The registry is a file. Whoever can edit the workflow, the
  signatures artifact, **and** the registry together controls the
  outcome — the same trust boundary as the code-review process
  that owns those files. Gates bind approval to bytes; they do
  not replace review, branch protection, or separation of duties
  between who writes a workflow and who holds its signing keys.
- Deleting the gate **and** its signatures artifact produces a
  different workflow that was never gated. Gates protect the
  workflow as committed with its artifacts; they cannot protect a
  copy that was never gated.
- Private keys are the crown jewels: a stolen key can sign
  anything until it is revoked in every registry that trusts it.
  Keep key files out of repositories (owner-only permissions are
  set at creation), and prefer one key per signer so revocation is
  surgical.
- The workflow digest covers the entry source (with flattened
  legacy includes), not explicit-module files; gates therefore
  refuse inside modules in v1 rather than pretend to cover them.

## Conformance

The semantics above are proven by executable tests, and any change
to this specification must extend them: `solvec-core/tests/gates.rs`
(format + precheck), `solvec-core/tests/gates_runtime.rs`
(evaluator seam), `solvec/tests/gates_cli.rs` (end-to-end signing
and bypass attempts), and `solvec/tests/gates_example.rs` (the
shipped example, signed and tampered, in a temp directory).
