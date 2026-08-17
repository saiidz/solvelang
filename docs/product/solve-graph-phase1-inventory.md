# Solve Graph Phase 1 — deterministic repository inventory

Status: **build-only / analyze-only**.

This phase turns an already acquired `RepositorySnapshot` into the first useful Solve Graph without executing repository code, calling the network, or mutating files.

## Scope

The Phase 1 extractor:

- creates one stable repository node from the immutable snapshot fingerprint;
- normalizes repository-relative POSIX paths;
- creates stable directory and file nodes;
- creates deterministic `contains` edges for the repository hierarchy;
- reuses Repository Audit file classification for source/test/documentation/configuration/generated/vendor/asset/archive/backup/unknown metadata;
- records byte size and available SHA-256 content fingerprints as non-secret metadata;
- uses the existing bounded scan planner for file count, file size, total bytes, and depth;
- applies graph node/edge limits atomically at the file boundary so truncation never leaves a dangling partial hierarchy;
- preserves canonical ordering, stable IDs, and graph integrity hashing;
- reports partial execution with explicit truncation reasons rather than silently dropping capacity-bound inputs.

## Security and side-effect boundary

The extractor consumes an in-memory `RepositorySnapshot`. It does not open files, run package managers, execute hooks, invoke repository code, resolve dependencies over the network, or write back to the repository. `SolveGraphDocument.execution.networkAccess` and `.writeAccess` therefore remain `false`.

Acquisition stays a separate Repository Audit concern. A future hosted graph service must preserve the same separation: acquire with bounded least privilege, then run deterministic extraction over the frozen snapshot.

## Next Phase 1 increments

After the inventory extractor is stable, build deterministic specialized extractors in small reviewed increments:

1. package/manifest dependency nodes and `depends-on` edges;
2. source import/reference edges for supported languages;
3. GitHub Actions workflow/job/resource/permission nodes and trigger/deploy/grant edges;
4. route/test relationships where evidence is deterministic;
5. graph queries for reverse dependencies, blast radius, entrypoints, and orphan candidates;
6. reuse the same graph as a Repository Audit evidence substrate before adding any remediation capability.

All of those remain analyze-only until separately designed execution/remediation gates exist.
