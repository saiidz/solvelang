# ADR 0004: Defer local package metadata from the 0.1 release line

**Status:** Accepted  
**Date:** 2026-09-01

## Context

ADR 0001 deliberately separated explicit local modules from any future package-manager or registry design. Since then, the implementation-backed 0.1 language contract has landed: quoted repository-local explicit modules have deterministic identities, export surfaces, namespace and named imports, complete-graph validation, transactional initialization, hardened path confinement, provenance, and fixture-backed conformance.

The current 0.1 specification and README intentionally have no package manifest, bare package specifier, dependency installer, registry lookup, remote module fetch, lockfile solver, or semver dependency selection. None of those capabilities is required to use the implemented explicit local-module system or to produce a pre-1.0 local `solvec` release.

Adding even an inert manifest now would create a new compatibility surface immediately before the release contract is being stabilized. It would also reserve names and schema semantics before the pure-core/WASM boundary and public CLI/version contract are complete.

## Decision

SolveLang will **not** add local package metadata to the 0.1 release line.

For 0.1 and the first pre-1.0 release candidates:

- the entry `.solve` file and its canonical source root remain the only package/source-root identity needed by the runtime;
- explicit module specifiers remain quoted repository-local `.solve` paths;
- no manifest file is recognized by `solvec`;
- no bare package specifier is recognized;
- no dependency installation, registry lookup, remote source resolution, lockfile solving, or semver dependency selection is performed;
- no package name or package version influences runtime resolution;
- editor, audit, release, and hosted tooling must not infer a package graph that the runtime does not implement.

The descriptive-manifest idea in ADR 0001 is therefore **deferred**, not implemented and not promised for 0.1. ADR 0001 remains authoritative for the security boundary that any later package design must preserve, but this ADR supersedes its implication that an inert manifest belongs in the next local implementation stage.

## Revisit criteria

A package-metadata proposal may be reconsidered only after the current repository release work has stable evidence for:

1. the implementation-backed language specification and conformance corpus;
2. the canonical CLI/version and release-artifact contract;
3. the pure Rust core / browser-WASM capability boundary;
4. deterministic source-root and module identity behavior across supported targets; and
5. a concrete user need that cannot be met by quoted local explicit modules.

A future proposal must be a new ADR. It must define the manifest schema/version, bounds, migration behavior, deterministic errors, root confinement, interaction with tooling, and whether package metadata remains descriptive or participates in dependency resolution. Any registry, download, install, signing, remote-code, or managed-execution capability remains a separate security and product decision.

## Consequences

This closes the 0.1 package-scope ambiguity without creating runtime behavior. The release can stabilize the language and CLI surfaces already implemented, while package semantics remain absent rather than half-specified.

The tradeoff is deliberate: projects must keep using quoted repository-local module paths. Cross-package naming and version selection remain unavailable until a later design earns their additional compatibility and trust surface.

## Safety

This ADR changes no runtime, resolver, network, filesystem, production, customer, provider, billing, CI-runner, or deployment behavior. It does not authorize any package registry or remote source capability.
