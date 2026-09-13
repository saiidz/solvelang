# Tagged release regeneration gate

This gate is repository release evidence only. It does **not** create a Git tag, GitHub Release, published package, production deployment, billing action, provider request, or customer mutation.

The pre-tag release-candidate workflow remains the place to prove reproducible Linux x86_64 candidate bytes before a version is finalized. After an owner separately creates the intended annotated version tag, `.github/workflows/tagged-release-regeneration-ci.yml` can be manually dispatched from `main` to prove that the exact tagged source still regenerates the expected non-publishable artifact/checksum/provenance set.

## Preconditions

The workflow fails closed unless all of the following are true:

- it is dispatched from the reviewed `main` workflow definition;
- the supplied tag name is a `v`-prefixed semver-like version;
- the tag exists locally after the trusted checkout fetches repository history;
- the tag is an **annotated** tag, not a lightweight tag;
- the tag peels to exactly one commit and the workflow checks out that commit detached;
- the checked-out worktree is clean, including untracked files;
- the tag is exactly `v<solvec Cargo package version>`; and
- the source commit supplied to artifact regeneration exactly matches the annotated tag commit.

`solvec/scripts/verify-release-tag-source.sh` emits sanitized JSON evidence containing the tag, tag-object SHA, exact source commit, and Cargo version. It deliberately records `publishable: false`.

## Regeneration behavior

For the currently implemented Linux x86_64 release target, the workflow:

1. validates the exact annotated tag/source binding;
2. runs the applicable Rust formatting, Clippy, and test gates on the tagged source;
3. runs the repository release guard tests;
4. regenerates the candidate artifact/checksum/provenance twice into fresh directories;
5. requires both generations to be byte-identical;
6. verifies the artifact provenance source commit and version against the annotated-tag evidence; and
7. uploads only short-lived, **non-publishable** regeneration evidence.

The workflow has read-only repository permission and disables persisted checkout credentials. It has no release-write, tag-write, package-write, deployment, billing, provider, or production authority.

## What this closes

This closes the repository-side gap where pre-tag reproducibility existed but there was no deterministic proof that an existing annotated release tag could be rebound to the exact Cargo version/source commit and regenerated without using publication authority.

It does **not** close the full release milestone. Before a public release can be claimed, the release contract still requires current truth/spec/changelog/release-note review, fresh candidate security and exact-head validation, version selection, required exact-platform evidence, and an owner-authorized publication step that regenerates/validates the final assets without silently replacing historical bytes.

Current evidence is Linux x86_64 only. It does not establish macOS ARM64 or Windows x64 release support. Existing historical GitHub releases/tags must not be reinterpreted as modern SolveLang CLI release evidence merely because this workflow exists.

## Local verifier examples

From a clean checkout of the annotated tag commit:

```bash
bash solvec/scripts/verify-release-tag-source.sh v0.3.0 "$(git rev-parse HEAD)"
```

The example tag is illustrative only; it is not a declaration that `v0.3.0` exists, is selected, or is authorized for publication. The verifier always derives the actual allowed tag from the checked-out `solvec` Cargo package version.
