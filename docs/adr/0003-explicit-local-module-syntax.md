# ADR 0003: Explicit local module syntax

**Status:** Accepted for implementation
**Date:** 2026-08-30

## Context

[ADR 0001](0001-local-modules-and-packages.md) defines the security and
resolver boundary for offline local modules, but intentionally does not define
the source syntax. The existing form `import "relative.solve"` is a
compatibility include: its source is flattened into the importing program and
its declarations are global. It must remain distinguishable from modules.

## Decision

SolveLang 0.1 adds explicit exports and two explicit local-module imports.
They are top-level-only language statements, not a pre-parse textual
substitution. `import`, `export`, `as`, and `from` remain contextual words:
they are recognized only in these complete top-level forms, so existing uses as
identifiers remain valid.

```solve
// A module source exposes only explicitly exported symbols.
export let api_version = 1
export fn add(left, right) { return left + right }

// Namespace import.
import "math.solve" as math
print(math.add(1, 2))

// Named import, with an optional local alias.
import { api_version as version, add } from "math.solve"
print(add(version, 2))
```

`export` may prefix only a top-level `let` or `fn` declaration. It is invalid
inside a block, before any other statement, or on a declaration that would
otherwise be invalid. Exported declarations retain their ordinary module-local
names.

The legacy form is precisely `import "path.solve"` followed only by whitespace
and an optional `//` comment/end of line. It keeps the implemented
source-flattening behavior. Adding `as`, or using the braced form, opts into
module behavior; a legacy include never implicitly gains an export surface or
namespace.

### Import bindings

- `import "path.solve" as namespace` binds one namespace. A namespace is
  required, must be a valid identifier, and exposes exactly the target's
  exports. Its name cannot shadow a local variable, function, parameter,
  built-in, the reserved injected `input` global, or another import binding in
  the same module.
- `import { exported as local, other } from "path.solve"` binds named exports
  in the importing module. `as` is optional; without it the local name equals
  the exported name. A braced list is non-empty, has no duplicate exported or
  local names, and has the same collision rules as a namespace binding.
- `namespace.member` reads an exported value. `namespace.function(args)` calls
  an exported function. Missing members are static, source-located errors;
  namespace values cannot be assigned to or mutated.
- Named imported functions and values are read-only live bindings: assigning
  them from an importer is invalid, while reads observe the exporting module's
  current exported value. Imported functions may call declarations within their
  defining module but do not receive its private declarations through an
  importer namespace.

### Resolution and evaluation

Resolution uses the canonical local identity, root confinement, regular-file
checks, symlink protections, deterministic DFS order, and no-network rule from
ADR 0001. The resolver first builds the whole graph, validates each import and
export surface, and reports a deterministic root-relative cycle chain before
any evaluator runs.

Each canonical module is parsed and evaluated at most once per workflow run.
Its top-level declarations initialize in deterministic dependency order. A
module's ordinary top-level side effects are not allowed: an explicit-module
source may contain only imports, exported declarations, and private `let`/`fn`
declarations. Module `let` initializers are restricted to a pure no-call
expression subset: literals, arrays, objects, existing module-value reads, and
their operators/property/index access. `print`, control flow, agents, asks,
assignments, expression statements, and every call expression are rejected at
module top level. This prevents import-time hidden output, capability use, and
mutation. Function bodies remain subject to normal capability preflight before
evaluation.

### Diagnostics and compatibility

Diagnostics identify the importing source and location for malformed imports,
duplicate bindings, private/missing exports, and name collisions. Errors from
the imported source retain its source provenance. The resolver never falls
back to another extension, index file, manifest, package name, environment
path, user directory, or remote source.

Hardened mode applies ADR 0001's import restrictions to both explicit module
forms. In particular, absolute, parent-traversal, backslash, non-`.solve`,
symlink-escaping, non-regular, and outside-root targets fail before parsing or
evaluation.

## Consequences

This syntax adds a local module surface without changing the compatibility
meaning of existing `import "..."` programs. It requires a callable namespace
member representation in the parser/runtime and module-aware static checking;
those are implementation work, not a package manager. Package manifests,
bare specifiers, remote registries, dependency installation, and network
resolution remain unavailable.

## Required verification

The implementation must add native and hardened fixtures for exported values
and functions, namespace and named aliases, contextual-word compatibility,
private/missing exports, binding collisions (including `input`), live exported
value updates, deterministic cycles, top-level side-effect and call rejection,
source provenance, root/symlink confinement, preflight of capability-bearing
function bodies, and unchanged legacy includes with trailing comments.
