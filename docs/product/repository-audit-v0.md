# Repository Audit v0 Contract

## 1. Product boundary

Repository Audit v0 is a deterministic, read-only inventory and recommendation engine. It accepts a GitHub repository snapshot or uploaded archive and emits a machine-readable JSON report plus a human-readable rendering of the same evidence.

The v0 scanner is **Analyze only**. It has no repository write token, does not mutate files, does not create branches, and does not execute repository code. A finding is evidence for human review, not authorization to delete, rename, move, merge, or rewrite anything.

## 2. Report contract

The canonical report format is defined by `schemas/repository-audit-report.schema.json`.

Every report includes:

- immutable report identity and generation timestamps
- scanner, ruleset, source revision, and source fingerprint
- the exact scan limits applied
- execution status, truncation reasons, and recoverable errors
- inventory of languages, frameworks, package managers, deployment targets, and file classes
- deterministic duplicate, backup, generated-file, large-file, and secret-exposure detections
- severity-ranked findings with confidence, evidence, impact, validation, and rollback notes
- redaction policy metadata and canonical JSON integrity metadata

`schemaVersion` changes only when consumers must adapt. Rule additions and behavior changes use `engine.rulesetVersion`.

## 3. Stable identity and ordering

Reports must be reproducible for the same normalized repository snapshot, engine version, ruleset, and limits.

Stable identifiers are derived from non-secret normalized inputs:

- report IDs use a source fingerprint plus engine/ruleset identity
- finding IDs use rule ID, normalized path, normalized location, and evidence fingerprints
- duplicate group IDs use sorted member paths and content fingerprints
- secret warning IDs use path, location, pattern class, and an HMAC fingerprint; never the matched value

Findings are emitted in this fixed order:

1. severity: `critical`, `high`, `medium`, `low`, `info`
2. rule ID
3. repository-relative POSIX path
4. starting line
5. stable finding ID

Object keys are serialized in canonical order when the integrity digest is calculated.

## 4. Evidence model

Evidence is repository-relative and minimally sufficient. Each evidence item identifies a path and evidence kind and may include line bounds, byte size, content hash, a bounded note, or a short redacted excerpt.

Evidence rules:

- paths are POSIX-style and never absolute
- `..` traversal segments and backslashes are rejected
- excerpts are capped at 500 characters
- binary content is never embedded
- files are not copied into the report
- secret-shaped matches are replaced with a redaction marker
- hashes describe files or normalized evidence, not secret values
- absence-based findings must list the manifests, directories, or searches that were evaluated

A confidence object is mandatory for every detection and finding. It contains a score from 0 to 1, a `low`, `medium`, or `high` level, and a short evidence-based explanation. Confidence never authorizes a write.

## 5. Recommendation and approval semantics

Allowed recommendations are:

- `keep`
- `review`
- `move`
- `merge`
- `rewrite`
- `delete-candidate`

The word `candidate` is intentional. Repository Audit v0 never calls a file safe to delete.

Recommendations `move`, `merge`, `rewrite`, and `delete-candidate` are classified as destructive in the report schema. They must set both `destructive: true` and `approvalRequired: true`, and must include validation and rollback steps before a future cleanup workflow may present them for selection.

`keep` and `review` remain non-mutating observations.

## 6. Secret handling and redaction

The scanner reports secret exposure risk without displaying or persisting the matched value.

For each secret-shaped match:

1. classify the pattern broadly, such as API key, token, password, private key, connection string, or credential file
2. record repository-relative path and bounded location
3. classify exposure, such as tracked, public path, generated output, archive, or unknown
4. replace the value with a fixed redaction marker
5. calculate an HMAC-SHA-256 fingerprint using an ephemeral scan key
6. discard the raw matched value before report assembly

The ephemeral HMAC key is not included in reports or logs and is destroyed at scan completion. A report may correlate repeated matches within one scan but cannot be used to recover or compare secret values across scans.

Logs, errors, HTML, JSON, telemetry, and test fixtures must follow the same redaction policy. Network calls, provider validation, and automatic credential rotation are outside v0.

## 7. Default scan limits

Implementations may offer smaller limits, but must not silently exceed the applied values recorded in the report.

Recommended hosted defaults:

| Limit | Default |
| --- | ---: |
| Files | 50,000 |
| Total uncompressed bytes | 512 MiB |
| Individual file bytes | 10 MiB |
| Archive entries | 100,000 |
| Directory depth | 64 |
| Findings | 5,000 |
| Wall-clock time | 300,000 ms |

Additional rules:

- reject archive paths that escape the extraction root
- do not follow symlinks outside the repository snapshot
- count ignored, skipped, unreadable, and oversized files
- stop adding findings at the finding limit while preserving summary counts where possible
- mark the report `partial` and list every truncation reason when a limit is reached
- do not execute package-manager, build, test, shell, hook, or repository scripts
- do not fetch dependencies, submodules, Git LFS objects, remote references, or external URLs in v0

## 8. Input normalization

GitHub input is pinned to an immutable commit revision before scanning. Archive input is hashed before extraction.

Normalization:

- convert separators to `/`
- remove a single archive wrapper directory only when every entry shares it
- preserve case
- ignore filesystem modification time for deterministic findings
- record byte size and SHA-256 for files used as evidence
- treat generated/vendor exclusions as classifications, not silent omissions
- scan tracked content by default for GitHub input
- include ignored or untracked content only when it is explicitly present in an uploaded archive

The source fingerprint is a SHA-256 digest over the normalized path, file type, byte size, and content digest sequence.

## 9. Execution status

`complete` means the configured snapshot was fully evaluated within limits.

`partial` means useful evidence was produced but at least one limit or recoverable read/parser error prevented full coverage.

`failed` means no trustworthy report could be assembled. Failed reports still contain source identity, applied limits, sanitized errors, redaction metadata, and execution metadata.

The scanner fails closed when source identity, archive safety, report validation, redaction, or integrity calculation cannot be proven.

## 10. v0 rule families

The first deterministic implementation should reserve stable rule ranges:

| Range | Family |
| --- | --- |
| `RA001–RA009` | source and inventory integrity |
| `RA010–RA019` | duplicates and backup candidates |
| `RA020–RA029` | generated, vendor, archive, and large-file analysis |
| `RA030–RA039` | language, framework, package, and deployment detection |
| `RA040–RA049` | naming and folder organization |
| `RA050–RA059` | secret exposure and unsafe public files |
| `RA060–RA069` | tests, documentation, ownership, and release readiness |
| `RA070–RA079` | configuration, route, import, and build-reference candidates |
| `RA080–RA089` | dependency and dead-code candidates |
| `RA090–RA099` | report integrity and scan-limit findings |

v0 may initially implement only inventory, duplicate/backup, generated/large-file, and secret/public-exposure families. Unimplemented families must not produce placeholder findings.

## 11. Human-readable report

The HTML report is a rendering of the validated canonical JSON and must not introduce new evidence or stronger claims.

It should show:

- source revision and scan completeness
- limits and skipped-content warnings
- inventory and architecture summary
- findings grouped by severity and recommendation
- evidence, confidence basis, impact, validation, and rollback
- explicit Analyze-only and approval-required labels
- a redaction statement
- canonical report digest

The HTML must be self-contained, printable, accessible without color-only meaning, and contain no active scripts or remote resources.

## 12. Acceptance gates

Repository Audit v0 is not ready until:

- the JSON Schema validates the example fixture and all generated reports
- identical normalized snapshots produce identical ordered findings and stable IDs
- archive traversal and symlink escape tests pass
- limit and truncation behavior is deterministic
- secret canary tests prove raw values never appear in JSON, HTML, logs, errors, snapshots, or test output
- no scanner path executes repository code or makes network requests
- destructive recommendations always require approval and include rollback steps
- malformed or unverifiable reports fail closed
- machine-readable and HTML reports contain equivalent findings and evidence
