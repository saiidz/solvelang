# Release-candidate dry run

SolveLang release-candidate tooling is deliberately **non-publishing**. It proves the pre-tag artifact/checksum/provenance contract without creating a Git tag, GitHub Release, production deployment, package publication, or live service change.

This machinery implements only the dry-run portion of [`release-contract.md`](release-contract.md). Final publishable artifacts must still be regenerated from a clean checkout of the final annotated tag.

## Current supported target

The implemented candidate target is exactly:

```text
x86_64-unknown-linux-gnu  ->  linux-x86_64
```

Linux evidence does not imply macOS ARM64 or Windows x64 support. Each additional distributed target requires terminal exact-release-commit validation on that target under its declared contract. In particular, site/Studio-only Mac validation cannot qualify the Rust CLI for macOS ARM64.

## Local dry run

From a clean checkout:

```bash
SOLVELANG_SOURCE_COMMIT="$(git rev-parse HEAD)" \
SOLVELANG_RELEASE_TARGET=x86_64-unknown-linux-gnu \
./solvec/scripts/build-release-candidate.sh

./solvec/scripts/verify-release-candidate.sh \
  dist/release-candidate \
  "$(git rev-parse HEAD)"
```

The builder fails closed unless the tracked worktree is clean, the supplied source identity is a full lowercase 40-character Git SHA, and that SHA equals the checked-out `HEAD` exactly. It uses locked Cargo metadata/builds and emits exactly three files under `dist/release-candidate/`:

```text
solvelang-<version>-linux-x86_64.tar.gz
SHA256SUMS
provenance.json
```

The archive contains the executable `solvec` binary. Tar ordering, owner/group, mode, commit-derived modification time, and the gzip header are normalized so packaging the same built binary twice in one exact-head run must produce byte-identical evidence.

`provenance.json` records:

- the Cargo package version;
- the exact source commit and commit-derived source timestamp;
- Rust target plus normalized OS/architecture;
- archive name and SHA-256 digest;
- Rust/Cargo versions; and
- available GitHub repository/workflow/run identity.

It is explicitly marked `publishable: false` because pre-tag candidate bytes are dry-run evidence only.

The verifier fails closed on malformed source identity, source/check-out mismatch when an expected SHA is supplied, invalid provenance schema/kind, platform drift, archive-name drift, unexpected files, checksum mismatch, or extra candidate files. It extracts the archive and smoke-tests the packaged binary with `solvec help`.

## Hosted validation

`.github/workflows/release-candidate-ci.yml` runs on Ubuntu x86_64 for relevant pull requests and manual dry runs. For pull requests it explicitly checks out `github.event.pull_request.head.sha` rather than GitHub's synthetic pull-request merge commit. The workflow:

1. uses read-only repository permission and disables persisted checkout credentials;
2. pins checkout, Rust toolchain, and artifact-upload actions to reviewed commit SHAs;
3. verifies checked-out `HEAD` equals the exact candidate source SHA;
4. runs format, locked Clippy, and locked tests for the declared target;
5. builds/packages/verifies the candidate twice into separate directories;
6. requires byte-identical archive, checksum, and provenance output;
7. verifies provenance against the exact source SHA and workflow identity; and
8. uploads only a seven-day temporary dry-run artifact.

Manual dispatch accepts an optional `expected_version`; the candidate fails if the Cargo package version differs.

Normal exact-head Hosted CI and Rust/RustSec remain independently required by [`release-contract.md`](release-contract.md). A green release-candidate workflow does not substitute for them.

## Final tagged releases

This dry run does **not** implement final publication. It does not prove:

- that an annotated release tag exists;
- that final artifacts were regenerated from a clean checkout of that tag;
- macOS ARM64 or Windows x64 compatibility;
- a canonical `solvec version` CLI contract;
- release-note/upgrade compatibility review; or
- any production, customer, billing, provider, queue, Admin, or infrastructure state.

A future tagged-release workflow must start from the exact annotated tag, regenerate final artifacts/checksums/provenance, verify the declared platform matrix, and only then publish versioned release assets. Adding signing or stronger supply-chain attestations requires a separate security/key-custody decision.
