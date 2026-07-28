# Repository Audit Snapshot Ingestion

## Boundary

Repository Audit separates **source acquisition**, **archive extraction**, **snapshot ingestion**, and **analysis**.

- A GitHub acquisition adapter resolves an owner/repository selection to an immutable commit and downloads only the selected tree.
- An archive extraction adapter inspects archive metadata and yields bounded entries.
- The snapshot ingestion core validates those entries, hashes file content, retains only bounded valid UTF-8 text, and creates the canonical in-memory `RepositorySnapshot`.
- The deterministic inventory and future rule engines consume that snapshot without network or write access.

The current implementation in `site/app/repository-audit/core/ingestion.ts` covers the ingestion core. It deliberately does not implement GitHub authentication, API calls, ZIP/TAR decompression, storage, or repository writes.

## GitHub requirements

A GitHub adapter must:

1. require explicit repository selection
2. resolve the selected branch or tag to an immutable 40- or 64-character commit hash
3. preserve repository-relative case-sensitive paths
4. reject submodule traversal in v0 rather than fetching another repository
5. reject symbolic links rather than following them
6. download file content within the configured entry and total-byte limits
7. pass the immutable commit hash and extracted bytes to `ingestGitHubSnapshotEntries`
8. discard GitHub access tokens before analysis and never include them in snapshot metadata, reports, logs, or browser storage

The ingestion core performs no network calls and records `networkAccess: false` for the ingestion phase after acquisition.

## Archive requirements

A ZIP/TAR adapter must inspect metadata before extracting content. It must:

1. accept only explicitly supported archive formats
2. enforce compressed-upload, entry-count, uncompressed-total, individual-entry, and depth limits before or during extraction
3. reject absolute paths, Windows drive paths, backslashes, NUL bytes, and `..` traversal
4. reject symbolic links, hard links, devices, sockets, FIFOs, and other non-regular entries
5. reject encrypted entries and unsupported compression methods
6. reject duplicate normalized paths
7. stop immediately on CRC, size, or extraction errors
8. avoid writing extracted content to a public or shared filesystem
9. pass regular-file bytes and directory metadata to `ingestArchiveSnapshotEntries`
10. destroy decompressed buffers when the local scan is closed or replaced

The ingestion core hashes the original archive transport bytes for the source revision and hashes the normalized file sequence separately for the source fingerprint.

## Wrapper-directory normalization

Uploaded source archives commonly contain one top-level folder. The ingestion core removes that wrapper only when every regular file is nested under the same first path segment.

It does not merge multiple roots, guess project folders, or rewrite any other path. Duplicate paths are checked after wrapper removal.

## Cryptographic identity

Each regular file receives a SHA-256 digest. The source fingerprint is SHA-256 over the sorted sequence:

```text
file\0<repository-relative-path>\0<byte-size>\0<file-sha256>\n
```

The original archive revision is `sha256:<archive-transport-digest>`. GitHub revisions are immutable commit hashes.

The browser implementation uses Web Crypto `SubtleCrypto.digest("SHA-256", ...)`. A test or server adapter may inject a hash provider, but the ingestion core rejects any result that is not a lowercase 64-character SHA-256 hex value.

## Text retention

Raw byte arrays are not returned in the canonical snapshot. For eligible text-like paths, the core retains decoded text only when:

- the file is within the configured text limit
- the content contains no NUL byte
- strict UTF-8 decoding succeeds

Binary, oversized, or invalid UTF-8 content keeps only path, byte size, digest, and optional generated classification.

Snapshot text is analysis input, not report output. Report renderers must continue applying the Repository Audit redaction contract and must never serialize source text by default.

## Fail-closed behavior

Ingestion produces a complete snapshot or throws a sanitized error. It does not silently create a partial content fingerprint when source identity cannot be proven.

Rejected conditions include:

- unsafe or duplicate paths
- symbolic links
- malformed source identity
- entry-count, byte, file-size, archive-size, or depth limit violations
- mismatched declared and extracted byte sizes
- missing file content
- invalid cryptographic-provider output

Later acquisition and extraction adapters may present user-friendly error codes, but must preserve these fail-closed rules.
