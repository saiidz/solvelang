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
