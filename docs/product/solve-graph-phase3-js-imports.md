# Solve Graph Phase 3 — deterministic JavaScript and TypeScript imports

Status: **build-only, analyze-only**.

Phase 3 adds semantic `imports` edges to the inventory graph without executing repository code, installing packages, reading the network, or trusting runtime resolution.

## Supported evidence

The lexical scanner recognizes literal forms in JavaScript/TypeScript-family source files:

- `import ... from "specifier"`;
- side-effect `import "specifier"`;
- `export ... from "specifier"`;
- literal `import("specifier")`;
- literal `require("specifier")`.

Comments, ordinary quoted strings, template literals, and `import.meta` are skipped. Non-literal or escaped specifiers are intentionally ignored rather than guessed.

## Local resolution

Only repository-relative specifiers beginning with `.` are resolved as local files. Resolution is bounded to files already present in the Phase 1 graph and supports common JS/TS extensions, directory `index` modules, and TypeScript source substitution for `.js`-style specifiers.

A relative import that does not resolve to an inventoried file creates no edge. The extractor never probes the filesystem.

## External dependencies

Bare package imports become `dependency` nodes only when the package root is declared by a repository `package.json` dependency field. This avoids treating project aliases such as `@/app/...` as third-party packages. `node:` builtins are recognized directly.

Package manifests are parsed as inert JSON only. No lifecycle script, package-manager hook, package resolution, or dependency code is executed.

## Impact analysis reuse

Every resolved relationship is a canonical `imports` edge. The Phase 2 dependency/dependent traversal therefore gains useful repository blast-radius behavior immediately without a second graph model.

Repeated equivalent imports are consolidated into one stable relation with a bounded deterministic evidence list and occurrence count. Node, edge, and evidence limits preserve the existing fail-closed partial-scan contract.

## Intentional limits

This phase does not claim full ECMAScript or TypeScript module resolution. It does not yet resolve tsconfig path aliases, package `exports`, workspace links, bundler aliases, CSS/assets, or non-JS language imports. Those should be added only through explicit deterministic extractors with their own evidence and tests.
