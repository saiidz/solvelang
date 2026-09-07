# Self-Driving patch materialization v0

Status: **pure repository-safe text materialization; no GitHub/network/write authority**.

`solvelang.self-driving.patch-materialization.v0` converts the already-reviewed structured hunks from the claim-bound PR execution plan into exact resulting UTF-8 text, but only after the caller supplies base content whose path and Git blob SHA exactly match the reviewed plan.

This boundary exists so a future GitHub REST adapter does not improvise patch semantics while holding write authority.

## Exact base contract

For every planned file, the caller must supply exactly one base-file input with:

- the exact planned repository-relative path;
- the exact 40-hex reviewed Git blob SHA;
- decoded UTF-8 text content.

No missing, extra, or duplicate paths are accepted.

The v0 text scope deliberately fails closed on ambiguous or lossy cases:

- CRLF is rejected; only LF text is supported;
- NUL/binary content is rejected;
- a non-empty base without a final LF is rejected because the current reviewed hunk format does not encode Git's `No newline at end of file` marker;
- an empty base is allowed, and a non-empty result receives a final LF.

This narrow scope prevents silent line-ending or EOF-newline rewrites. A future expansion must add an explicit reviewed newline contract rather than guessing.

## Hunk application

Each structured hunk is applied against the original verified base coordinates. The materializer requires:

- non-overlapping valid `oldStart` ranges;
- exact context-line matches;
- exact deletion-line matches;
- exact reviewed old/new line counts;
- `newStart` to equal the actual materialized new-file position after earlier hunks.

Any drift fails before resulting content is emitted.

## Bounds and output

The v0 materializer is bounded to:

- 50 files;
- 1 MiB base content per file;
- 50,000 base lines per file;
- 8 MiB total base content;
- 8 MiB total result content.

Each result records path, reviewed base blob SHA, exact materialized content, byte/line counts, final-LF truth, and SHA-256 of the resulting content.

The output contains repository source text and must be treated as internal write-pipeline material. It must not be logged or surfaced as a sanitized telemetry artifact.

## Authority boundary

This module has no credential resolution, GitHub API access, network access, shell execution, repository write, patch application to a working tree, provider access, production/billing mutation, or Solve Runner authority.

The next GitHub REST adapter may consume this output only after independently re-verifying live base revision, branch protection, head-branch absence, and base blob identities. Automatic merge, force push, and direct protected-base writes remain forbidden.