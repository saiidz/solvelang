# MCP npm Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@solvelang/mcp-server` verifiably ready for a future guarded public npm release without publishing it.

**Architecture:** Keep the MCP runtime unchanged while hardening its package manifest, testing the actual npm tarball as a consumer, documenting `npx` setup, and adding a release-triggered workflow with ownership and protected-environment gates. The packaged smoke script is the shared local and CI release proof.

**Tech Stack:** npm, Node.js 20+, TypeScript, MCP stdio, GitHub Actions

---

### Task 1: Specify the package contract with a failing smoke test

**Files:**
- Create: `packages/mcp-server/scripts/smoke-packed.mjs`
- Modify: `packages/mcp-server/package.json`

- [ ] Write a smoke script that packs the module, asserts the exact tarball allowlist and executable mode, installs it into a temporary consumer, initializes the packaged MCP server through `npx --no-install`, and fails against the current manifest.
- [ ] Run `node scripts/smoke-packed.mjs` and confirm it fails because the package is private and lacks the publish contract.
- [ ] Add public package metadata, a strict `files` list, `prepack`, and `test:packed` scripts; include the package license.
- [ ] Run `npm test` and `npm run test:packed` and confirm both pass.

### Task 2: Make CI and release automation enforce the contract

**Files:**
- Modify: `.github/workflows/mcp-ci.yml`
- Create: `.github/workflows/npm-release.yml`

- [ ] Add the packed smoke test to MCP CI using `npm ci`.
- [ ] Add a GitHub-Release-only npm workflow gated by `npm-production`, `NPM_SCOPE_OWNERSHIP_VERIFIED`, exact tag/version matching, tests, packed smoke verification, npm provenance, and `id-token: write`.
- [ ] Validate both workflow files parse and inspect the diff for any unguarded publish path.

### Task 3: Document zero-friction clients and release prerequisites

**Files:**
- Modify: `packages/mcp-server/README.md`
- Modify: `docs/integrations/mcp-codex-claude.md`
- Modify: `plugins/codex/config.toml.example`
- Create: `plugins/claude/.mcp.json.example`

- [ ] Replace clone-dependent client setup with `npx --yes @solvelang/mcp-server` examples for Codex and Claude.
- [ ] Document workspace and optional `solvec` environment variables, ownership verification, protected environment, trusted publishing/token configuration, and the intentionally disabled initial release state.
- [ ] Check every documented command against the packed package interface.

### Task 4: Run complete verification and open the PR

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] Run MCP tests and packed tarball verification.
- [ ] Run Rust format, clippy, tests, and release build.
- [ ] Run site tests, lint, and static build.
- [ ] Run entitlement tests and available SAM validation/build checks.
- [ ] Run workflow syntax checks, `git diff --check`, and inspect `npm pack --dry-run --json` contents.
- [ ] Commit, push `codex/mcp-npm-production-readiness`, and open a ready PR without publishing, tagging, releasing, or deploying.
