# SolveLang release contract

**Status:** repository release policy for pre-1.0 engineering releases  
**Applies to:** the canonical Rust `solvec` language/CLI and repository artifacts  
**Does not authorize:** production deployment, billing, customer/provider activation, or any live infrastructure mutation

SolveLang is still an early beta. A repository tag or downloadable binary is evidence of a versioned local tool, not evidence that managed execution, billing, paid priority, or any other gated production feature is live.

## Versioning

SolveLang uses Semantic Versioning for versioned public releases.

- `0.y.z` releases are pre-1.0 and may contain deliberate compatibility changes when those changes are documented in the changelog and migration notes.
- A patch release must not intentionally change documented language syntax or CLI behavior except to correct a defect where the prior behavior contradicted the versioned specification or safety contract.
- A minor pre-1.0 release may add or revise language/CLI behavior, but the change must be reflected in `SPEC.md`, executable regression/conformance coverage, and the changelog.
- `1.0.0` is reserved for a separately reviewed stability decision; this document does not declare SolveLang 1.0-ready.

The source of truth for a release is the annotated tag plus the exact commit it identifies. Branch names, PR titles, website copy, and production deployment state are not release identifiers.

## Compatibility surfaces

The release contract distinguishes surfaces deliberately.

### Language

`SPEC.md` is the versioned language compatibility boundary. A release must not document syntax, value behavior, import/module semantics, builtins, diagnostics guarantees, or hardened-execution behavior that the tagged Rust implementation does not provide.

Every specification change requires executable regression or conformance coverage on the release commit.

### CLI

The public CLI contract includes documented command names, option parsing, exit status categories, stdout/stderr separation, and machine-readable JSON envelopes. Compatibility aliases may remain supported, but they are not a substitute for documenting the canonical invocation.

Commands or flags that perform host-capability operations remain subject to the runtime safety policy. A release must not weaken hardened-mode denial merely to preserve accidental historical behavior.

### Library/editor APIs

Rust library and LSP/editor APIs are pre-1.0 engineering interfaces unless a release explicitly promotes a narrower interface to stable status. Editor support is non-executing by default and must not gain network, source-execution, or filesystem-mutation authority through a release artifact.

### Production services

Repository versioning does not version or activate production account, Admin, billing, queue, provider, or managed-execution state. Those surfaces keep their own protected rollout evidence and approval boundaries.

## Supported-platform matrix

A platform may be called **release-validated** only when the release commit has a terminal successful build/test result on that platform under the repository's declared validation contract.

Current policy:

| Platform | Release claim |
| --- | --- |
| Linux x86_64 | Primary hosted-CI validation target when the release workflow proves it |
| macOS ARM64 | Supported only when the release commit receives the repository-required Trusted Mac validation; queued/cancelled/missing is not success |
| Windows x64 | Supported only when the release commit receives the repository-required Windows validation for the affected contract |
| Browser/WASM | Not a release runtime until the accepted pure-core/WASM ADR is implemented and browser-targeted conformance/security gates pass |

A release page must list only platforms actually validated for that exact release commit. One platform never substitutes for a required result on another.

## Release-candidate gate

A commit may be called a SolveLang release candidate only when all applicable items below are satisfied:

1. `SPEC.md`, README/maturity copy, roadmap/handoff, and changelog describe the same implemented state.
2. Rust formatting, Clippy with warnings denied, tests, release build, and RustSec/dependency audit are successful on the exact candidate commit.
3. Applicable site, API, MCP, and cross-platform validation required by the changed surface is successful on that exact commit.
4. There are no unresolved P0/P1 engineering findings or unresolved blocking review threads.
5. A fresh security review of the candidate has no unresolved validated high-impact finding.
6. Version metadata and release notes are finalized before the tag is created.
7. Reproducible artifact names, checksums, and provenance metadata are generated from the tagged commit.
8. Upgrade/migration notes call out every intentional compatibility change since the prior release.
9. No release text implies that a separately gated production feature is live without independent production evidence.

## Artifacts, checksums, and provenance

Final release artifacts must be generated from a clean checkout of the tagged commit by a pinned/reviewed workflow or an equivalently documented reproducible process. Pre-tag candidate artifacts may be generated only as a dry-run verification aid; they are not publishable release artifacts and must be regenerated from the final tag.

For every distributed binary/archive:

- use an unambiguous name containing the SolveLang version, target OS, architecture, and archive type;
- publish a SHA-256 checksum in a machine-readable checksum file;
- record the source commit SHA and build workflow/run identity in release provenance;
- do not embed production credentials, environment files, API keys, customer data, or runner-specific absolute paths;
- keep source archives distinguishable from compiled binaries;
- fail the release if the artifact set differs from the declared platform matrix.

If signing or stronger supply-chain attestations are added later, their key custody and verification contract require a separate security decision. This policy does not invent a signing guarantee that the repository has not implemented.

## Changelog and migration notes

Every public versioned release must have a changelog entry grouped by user-visible impact rather than PR count alone. At minimum record:

- language/spec changes;
- CLI contract changes;
- editor/LSP changes;
- runtime safety/security changes;
- breaking or behavior-correcting changes;
- known limitations and intentionally deferred capabilities.

Migration notes are mandatory when source that worked under the prior documented contract requires editing under the new release.

## Release procedure

1. Freeze the intended candidate commit; do not continue adding unrelated work to it.
2. Reconcile truth/spec/docs and select the pre-1.0 version.
3. Run the exact-candidate validation/security matrix.
4. Fix validated findings on a new commit and restart the exact-head gate; never bless stale checks.
5. Optionally generate non-publishable candidate artifacts as a dry run and inspect them; any defect returns to step 4.
6. Create the annotated version tag on the exact validated candidate commit.
7. Generate the **final** release artifacts, SHA-256 checksums, and provenance from a clean checkout of that tag.
8. Verify final artifact contents, provenance, checksums, and the supported-platform matrix against the tag.
9. Publish release notes/changelog and upgrade notes together with the verified tagged artifacts.
10. Smoke-test the distributed artifacts without using production credentials or customer data.
11. Keep any production rollout as a separate protected action requiring its own evidence and approval.

## Rollback and yanking

If a release artifact is unsafe or materially incorrect:

- do not silently replace bytes behind an existing version/tag;
- mark the release as affected, remove unsafe download artifacts when appropriate, and publish a corrected version;
- retain enough sanitized provenance to explain which commit/artifact was affected;
- use a new patch/minor version for corrected binaries rather than mutating the historical tag.

A repository release rollback does not itself roll back production infrastructure; production rollback follows the separately protected production runbooks.

## Completion evidence

The repository release milestone is complete when this contract is linked from the project completion plan, the CLI/version/artifact implementation satisfies it, a changelog exists, the versioned specification reflects current module/runtime semantics, and an exact-commit release-candidate dry run produces validated artifacts/checksums/provenance without performing a production mutation.