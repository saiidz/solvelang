# Open Source Roadmap

This roadmap is contributor guidance, not a promise that every item will ship.

## Current focus

1. Preserve correctness of the Rust lexer/parser/AST runtime.
2. Keep hardened execution fail-closed as side-effecting capabilities evolve.
3. Improve compatibility evidence between canonical syntax, browser preview, and Studio export.
4. Make examples and documentation easy to reproduce.
5. Keep product maturity labels honest.

## Good first contribution areas

### Documentation link and terminology audit

Check README, language reference, demo status, development guide, and website copy for stale links or inconsistent use of `Working today`, `Preview`, `Experimental`, and `Planned`.

**Why it is approachable:** no runtime behavior change.

**Validation:** docs links plus site lint/build when web copy changes.

### Browser preview fixture coverage

Add small tests for syntax intentionally supported by both the Rust language and browser preview.

**Why it matters:** reduces semantic drift.

**Boundary:** do not expand browser syntax in the same PR unless separately justified.

### Diagnostic example catalog

Add minimal `.solve` fixtures demonstrating existing source-located errors and document the expected message category.

**Why it matters:** makes error behavior easier to review and teach.

### Accessibility pass on secondary routes

Audit keyboard focus, labels, status text, and color-independent state communication on one route at a time.

**Why it is approachable:** narrow UI scope and testable outcome.

### Example validation metadata

Improve example documentation so each executable example states the command used to validate/run it and the capability maturity involved.

## Intermediate contributions

- shared compatibility test fixtures
- Studio export compatibility evidence
- behavior-preserving extraction from large Rust modules
- deterministic report/export improvements
- contributor validation orchestration

## Advanced / maintainer discussion first

Open a design issue before starting:

- new language syntax
- new side-effecting built-ins
- AI tool execution
- authentication/authorization architecture
- managed secrets
- runtime adapters
- hosted execution
- changes to billing/metering semantics
- changes to safety policy or hardened execution

These changes can alter security or compatibility guarantees and should not begin as surprise PRs.

## Contribution acceptance principles

A change is stronger when it:

- solves a real documented problem
- preserves existing architecture unless a tradeoff is clearly justified
- has tests for normal and failure behavior
- states its maturity level
- updates documentation
- avoids introducing secrets or unsafe defaults
- stays small enough to review independently

A technically impressive feature can still be rejected if it pushes SolveLang toward a market it has deliberately chosen not to compete in.
