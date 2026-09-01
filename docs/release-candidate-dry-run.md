# Release-candidate dry run

SolveLang release-candidate tooling is deliberately non-publishing. It proves the local artifact/checksum/provenance contract without creating a Git tag, GitHub Release, production deployment, package publication, or any live service change.

## Local dry run

From a clean checkout:

```bash
./solvec/scripts/build-release-candidate.sh
./solvec/scripts/verify-release-candidate.sh dist/release-candidate
```

The builder uses `cargo build --release --locked` and emits exactly three files under `dist/release-candidate/`:

- one `solvec-v<version>-<rust-host-triple>` binary (`.exe` on Windows),
- `SHA256SUMS`,
- `provenance.json`.

The provenance records the Cargo package version, full source commit, Rust host triple, SHA-256 digest, Rust/Cargo versions, and available GitHub workflow identity. It is explicitly marked `publishable: false` because pre-tag candidate bytes are dry-run evidence only.

The verifier fails closed on an invalid provenance schema, abbreviated/malformed source SHA, unexpected files, artifact-name drift, or checksum mismatch, and smoke-tests the emitted binary with `--help`.

## Hosted validation

`.github/workflows/release-candidate-ci.yml` runs the same scripts on Ubuntu x86_64 for relevant pull requests and manual dry runs. Its uploaded artifact is temporary CI evidence, not a release. Normal exact-head Rust/RustSec tests remain independently required by `docs/release-contract.md`.

Linux evidence does not imply macOS ARM64 or Windows x64 support. Each additional distributed target requires terminal exact-release-commit validation on that target under its declared contract. In particular, site/Studio-only Mac validation cannot qualify the Rust CLI for macOS ARM64.

## Final tagged releases

This machinery does not implement final publication. A future tagged-release workflow must start from the exact annotated tag, regenerate final artifacts/checksums/provenance, verify the declared platform matrix, and only then publish versioned release assets. Adding signing or supply-chain attestations requires a separate security/key-custody decision.
