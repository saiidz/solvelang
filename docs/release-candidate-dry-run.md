# Release candidate dry run

This document describes the repository-safe, **non-publishable** release-candidate evidence produced by `.github/workflows/release-candidate.yml` and `scripts/prepare-release-candidate.sh`.

It implements only the pre-tag candidate portion of [`release-contract.md`](release-contract.md). It does not create a Git tag or GitHub Release, publish a package, deploy production, enable billing/provider/queue behavior, or make a platform-support claim.

## Purpose

The dry run proves that one exact source commit can:

1. pass the portable Rust formatting, Clippy, test, and release-build gates for the declared target;
2. produce a deterministic version/OS/architecture-qualified archive;
3. produce a SHA-256 checksum for that archive;
4. record source, workflow/run, target, toolchain, artifact, and digest provenance;
5. reproduce the archive, checksum, and provenance bytes a second time in the same run; and
6. extract and smoke-test the packaged `solvec` binary.

The current implemented target is only `x86_64-unknown-linux-gnu`, surfaced as `linux-x86_64` in the archive name. That evidence does not imply macOS or Windows support.

## Exact source identity

For a pull request, the workflow explicitly checks out `github.event.pull_request.head.sha`, not GitHub's synthetic pull-request merge commit. For a manual dispatch, it checks out the selected workflow ref's `github.sha`.

The packaging script fails closed unless:

- the expected source identity is a full lowercase 40-character Git SHA;
- the checked-out `HEAD` equals that SHA exactly;
- the tracked worktree is clean; and
- the target release binary already exists and is executable.

The workflow uses read-only repository permission and disables persisted checkout credentials.

## Candidate artifact set

For Cargo package version `<version>`, the Linux dry run emits exactly the following evidence into the uploaded candidate directory:

```text
solvelang-<version>-linux-x86_64.tar.gz
solvelang-<version>-linux-x86_64.tar.gz.sha256
solvelang-<version>-linux-x86_64.tar.gz.provenance.json
```

The archive contains the `solvec` binary. Archive metadata is normalized using deterministic ordering, owner/group, mode, commit-derived mtime, and `gzip -n`. The workflow packages the same already-built binary twice and requires byte-identical archive, checksum, and provenance output.

The provenance JSON records:

- `release_kind: candidate-dry-run`;
- `publishable: false`;
- Cargo package version;
- Rust target plus normalized OS/architecture;
- exact source SHA and commit timestamp;
- artifact name and SHA-256 digest;
- repository, workflow, run ID, and run attempt; and
- `rustc` and `cargo` version strings.

## Manual use

The GitHub workflow may be manually dispatched against a selected ref. An optional `expected_version` input fails the run if the selected source's `solvec/Cargo.toml` version differs.

The packager can also be exercised locally after an exact locked release build on the supported target:

```bash
cd /path/to/solvelang
cargo build --manifest-path solvec/Cargo.toml --release --locked --target x86_64-unknown-linux-gnu
bash scripts/prepare-release-candidate.sh \
  "$(git rev-parse HEAD)" \
  x86_64-unknown-linux-gnu \
  /tmp/solvelang-release-candidate
```

Local provenance intentionally records `local` for missing GitHub workflow identity. A locally produced candidate is useful for reproducibility testing but is not CI acceptance evidence.

## What this evidence cannot prove

A passing candidate dry run is not publishable release evidence. In particular, it does not prove:

- that an annotated release tag exists;
- that final artifacts were regenerated from a clean checkout of that tag;
- macOS ARM64 or Windows compatibility;
- a canonical `solvec version` CLI contract;
- release-note/upgrade compatibility review;
- production deployment or SaaS feature activation; or
- any customer, billing, provider, queue, Admin, or infrastructure state.

Final release artifacts must be regenerated from the final annotated tag and revalidated under the full release contract. Pre-tag dry-run bytes must never be relabeled as final release artifacts.
