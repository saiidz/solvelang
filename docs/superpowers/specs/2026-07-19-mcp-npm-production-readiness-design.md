# MCP npm Production Readiness Design

## Goal

Prepare `@solvelang/mcp-server` for a future public npm release without publishing, tagging, creating a GitHub release, or deploying anything in this change.

## Package boundary

The package remains the existing Node 20+ stdio MCP server and exposes the `solvelang-mcp` executable. Its manifest will declare public npm access, complete discoverability metadata, a strict published-file allowlist, and lifecycle scripts that build before packing. The package will include only compiled runtime code, its README, and its MIT license; tests, TypeScript sources, source maps, local dependencies, and repository-only integration templates will not ship.

## Packaged consumer verification

A repository script will create an npm tarball, inspect its exact contents, install that tarball into a temporary package with lifecycle scripts disabled, and invoke the installed executable through `npx --no-install`. The smoke process will confirm startup over stdio, request MCP initialization, verify the advertised server identity, and terminate without executing workflows or writing in the configured workspace. CI will run this smoke test after the unit suite.

## Client setup

Codex and Claude documentation and checked-in examples will use `npx --yes @solvelang/mcp-server` so consumers do not need a clone or global install. Configuration will require an explicit `SOLVELANG_WORKSPACE_ROOT`; `.solve` validation will document the optional local `solvec` dependency.

## Release safety

The npm workflow will react only to a published GitHub Release, require the protected `npm-production` environment, require `NPM_SCOPE_OWNERSHIP_VERIFIED=true`, verify that the release tag exactly matches the package version, run tests and the packed-install smoke test, and then publish with npm provenance. Because npm returned `E404` for the package and this machine has no npm authentication, the ownership variable and protected environment are documented release prerequisites. This PR will not configure those external controls or trigger the workflow.

## Verification

Run MCP unit tests, the packed tarball smoke test, tarball inspection, the full Rust runtime suite, the full site suite and static build, entitlement tests, workflow syntax checks, and `git diff --check` before opening the PR.
