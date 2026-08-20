# ADR 0001: Local module and package foundation

**Status:** Accepted for future implementation; no runtime behavior changes in this ADR.  
**Date:** 2026-08-20

## Context

The current Rust CLI supports quoted relative `.solve` imports. The loader
resolves each path relative to its importer, detects circular imports by
canonical filesystem path, and flattens imported source before parsing. The
flattened source retains line-level file provenance for diagnostics, but it has
no module namespace, explicit export surface, package manifest, or package
resolver. Imported declarations therefore share one program scope.

That model is useful for small local workflows, but it is not a sufficient
foundation for reusable modules: it does not define identity independently of
a declaration name, cannot prevent accidental global collisions, and would
make a future registry or package solver an implicit security boundary.

## Decision

SolveLang will add modules and packages in local, offline stages. The first
implementation must preserve the existing relative-import behavior until an
explicit module syntax and migration path are available.

### Module identity and namespaces

- A local module's identity is its canonical path relative to the entry
  workflow's canonical source root, rendered with `/` separators. The identity
  is not the filename alone and is not inferred from a declared function.
- Future module declarations expose symbols only through explicit exports.
  Importers bind those exports through an explicit local namespace or explicit
  aliases; implicit injection into the program-global scope is not the target
  module behavior.
- Existing `import "relative.solve"` remains a compatibility include while it
  is implemented as source flattening. It does not retroactively claim module
  namespace semantics. A later language change must introduce a distinct,
  documented module form and a migration diagnostic before changing this
  behavior.

### Deterministic local resolution

- The entry `.solve` file establishes the only initial package/source root.
- Module paths are quoted relative `.solve` paths resolved from the importing
  file. Resolution canonicalizes the target and records the root-relative
  canonical identity.
- Resolution must not probe extension variants, `index` files, parent
  directories, user home directories, environment search paths, editor state,
  or the network. The same checkout and entry path must resolve the same graph.
- A future package manifest is an opt-in, inert local metadata file at that
  root. It may declare a package name, version, and an explicit entry module;
  it must not contain executable hooks, dependency-install commands, remote
  URLs, or credentials. Manifest parsing must be bounded and read-only.
- The initial package foundation has no bare-specifier resolver, registry,
  lockfile solver, semver selection, package-manager integration, or implicit
  dependency search. A package name and version identify local metadata only;
  they do not authorize fetching code.

### Cycles and evaluation order

- Module cycles are invalid. Resolution reports a deterministic cycle chain in
  import order before evaluation begins.
- The future explicit-module loader must build and validate the complete local
  dependency graph before evaluating any module. This preserves the current
  fail-before-execution property for circular imports and avoids partial module
  initialization semantics.
- A module may be resolved once per canonical identity in a graph. Export
  conflicts, missing exports, and duplicate local aliases are source-located
  static errors rather than last-definition-wins behavior.

### Hardened execution constraints

- Hardened modes retain the current import boundary: relative regular `.solve`
  files only; no absolute paths, parent traversal, NUL bytes, backslash
  separators, non-`.solve` targets, or canonical paths outside the entry root.
- Symlink escapes, missing targets, non-regular files, and cycles fail before
  imported content is evaluated. A manifest and any future local package
  metadata are subject to the same root, regular-file, bounded-read, and
  fail-closed treatment.
- Module/package resolution never grants runtime file, environment, network,
  agent, provider, process, or mutation capability. Capability preflight still
  traverses every resolved module before evaluation.

### Versioning and migration

- The first manifest version is descriptive local metadata; it does not create
  compatibility guarantees or semver dependency resolution.
- A later stable module/package specification must define export syntax,
  namespace syntax, manifest schema/version, deterministic error formats,
  compatibility behavior for legacy includes, fixtures, and a migration window.
- Remote registries, dependency installation, signed packages, and managed
  execution are separate architecture decisions with their own security and
  production gates.

## Consequences

This keeps the next implementation narrow and testable: local modules can gain
explicit boundaries without accidentally becoming a package manager or a code
downloader. It also makes the existing include behavior truthful while giving
users a deterministic migration direction.

The tradeoff is that cross-package reuse and version selection remain
deliberately unavailable. Those capabilities require explicit trust, integrity,
offline-cache, lifecycle, and support decisions and must not be inferred from
local-file imports.

## Verification required for implementation

An implementation PR must add deterministic fixtures and cover, at minimum:

1. canonical root-relative identity across nested imports;
2. explicit export/namespace or alias collision errors;
3. missing export and cycle-chain diagnostics with imported-file provenance;
4. repeatable resolution without filesystem or network fallback;
5. hardened rejection of traversal, absolute paths, symlink escapes, invalid
   manifest paths, and all remote/bare package forms; and
6. preflight coverage of capability-bearing calls in every resolved module.
