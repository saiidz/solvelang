# Native CLI qualification

`Native CLI Qualification` runs on the exact PR head or manually selected ref,
using GitHub-hosted macOS ARM64 and Windows x64 machines. It runs formatting,
Clippy with warnings denied, and tests for both `solvec-core` and `solvec`, then
builds a release binary, creates a bounded ZIP package and verifies a clean
installation's help/version commands. Source SHA, native host, compiler, archive
checksum and Actions run identity are recorded in `qualification.json`.

The script refuses a mismatched OS/architecture/Rust host, a dirty checkout,
a different source SHA, or an existing/in-repository output directory. It never
installs a binary system-wide or publishes a release. The archive is explicitly
named `qualification.zip` and records `publishable: false`.

A successful run qualifies only that exact source commit and native CLI
surface. It does not retroactively qualify an existing release tag, establish
signed/notarized installer support, prove reproducible native binary bytes,
or replace the separate Linux tagged-release and release-security gates.
To claim a platform on a public release, repeat qualification for the reviewed
release commit and retain the resulting run/artifact evidence.

Runner labels `macos-15` (ARM64) and `windows-2022` (x64) follow the
[GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The script independently checks the actual host rather than trusting a label.

## Windows entry-source identity

The first Windows run exposed the previous non-Unix hardened-entry refusal.
Windows now snapshots the volume serial number and full 128-bit file identifier
from `GetFileInformationByHandleEx(FileIdInfo)`, retaining the original open file
until the read handle has been compared. Matching length or modification time
cannot substitute for object identity. Unsupported identity queries fail closed.
Native regression tests cover same-size/same-time replacement and hard-link
identity, alongside the existing frozen-source execution test.

This follows Microsoft's [FILE_ID_INFO contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info).

## Initial Mac evidence

The `macos-15` lane passed on ARM64 at source
`88718becd6b61763566870b1934b0618ec66c440` in
[run 35529266221](https://github.com/saiidz/solvelang/actions/runs/35529266221/job/106126848389),
including the explicit Rust host check, all core/CLI tests and clean package
installation. Artifact `10610781831` records that exact candidate. This confirms
the current documented ARM64 label; the check does not rely on an assumed CPU.
Later source changes require a fresh successful run.

## Both-platform qualification — 2026-09-20

[Run 35530427540](https://github.com/saiidz/solvelang/actions/runs/35530427540)
passed every step on macOS ARM64 and Windows x64 at source
`ed0dbcc82467fb690d2d8dd4420a964001b44846`. The Windows run includes the stable
identity regressions, all original CLI/conformance contracts, release build and
clean package installation. #941 merged the identical source tree at
`9a98883cdef2619e6d5b54e57d2c7d2279ec76ae`; its main push checks also passed.

| Platform | Workflow artifact | Artifact-container SHA-256 |
| --- | --- | --- |
| macOS ARM64 | `10610698792` | `66d644198d25b1ea0edfee7e1ff2b8a51db1c7c6c040f36a97bb53a94db29bf1` |
| Windows x64 | `10611202508` | `254620a42764a6de494928fd5aa66a79badac67e03ccfdad94c76acde1da39d3` |

These are GitHub artifact-container digests, not native-binary digests. The
contained qualification record identifies its ZIP checksum. Artifacts expire
after 14 days; this evidence does not publish or qualify a new release tag.
