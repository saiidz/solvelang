# SolveLang v0.2.0 Draft

> **Historical draft — not current release evidence.** This file predates the current Rust `solvec` release-control path and must not be used to select a version, create a tag, publish assets, or infer current runtime/production capabilities. Current repository release qualification is documented in [`docs/release-candidate-dry-run.md`](docs/release-candidate-dry-run.md) and [`docs/tagged-release-regeneration.md`](docs/tagged-release-regeneration.md). A public release still requires a separately selected version, current release notes, exact-platform evidence, and owner-authorized publication.

SolveLang has grown from an early scripting prototype into a much stronger workflow-oriented language.

## New capabilities

- object literals and property access
- JSON parsing and stringifying
- HTTP GET support
- HTTP POST support
- environment variable access
- file imports
- file read/write built-ins
- boolean operators: and, or, not

## Example workflows included

- fetch data from an API and save it
- post JSON to a webhook
- import helper files
- read and transform local JSON
- route logic using conditions

## Suggested next steps

- update README with these examples
- add docs for built-in functions
- add tests for new features
- prepare a new GitHub release
