# SolveLang Codex plugin distribution

_Last reviewed against OpenAI plugin/import guidance: 2026-09-16._

This document separates three facts that must not be conflated:

1. **Repository-qualified plugin:** the SolveLang repository contains a Codex marketplace/plugin bundle and tests it in CI.
2. **Workspace-imported plugin:** an eligible workspace admin has imported the GitHub marketplace and configured workspace installation policy.
3. **Public Plugin Directory listing:** OpenAI's public catalog contains a SolveLang listing that users can discover by searching the Plugin Directory.

A repository merge proves only (1). A workspace import proves only (2). Neither one proves (3).

## Current repository coordinates

For an eligible managed workspace, use the GitHub marketplace import flow with:

- **Source:** `https://github.com/saiidz/solvelang`
- **Path:** leave empty; the marketplace is at repository root
- **Branch:** `main` for ongoing sync, or an exact reviewed commit SHA for a fixed qualification run
- **Manifest:** `.agents/plugins/marketplace.json` (discovered automatically from the selected root)
- **Plugin:** `solvelang`

The marketplace points to `./plugins/solvelang`, which contains:

- `.codex-plugin/plugin.json`;
- `.mcp.json`;
- the SolveLang workflow-review skill;
- README and MIT license material.

`ops/distribution/validate-codex-marketplace-import.mjs` fails CI if those coordinates drift, the local source escapes the repository, the required plugin files disappear, or the plugin advertises an MCP version that has not actually been published.

## Workspace import procedure

OpenAI's current managed-workspace flow is:

1. Open **Workspace settings → Plugins**.
2. Select **Add → Import marketplace**.
3. Set Source to `https://github.com/saiidz/solvelang`.
4. Leave Path empty.
5. Select `main` for normal synchronized use, or enter the exact qualification commit when proving one immutable revision.
6. Select **Import marketplace** and authorize the GitHub access requested by the workspace.
7. Review the import report.
8. Open the imported SolveLang plugin and configure its workspace installation policy.

Repository fields such as `AVAILABLE` or `ON_USE` do **not** grant workspace access. Workspace administrators remain authoritative for installation and authentication policy.

After import, OpenAI can sync a GitHub-managed marketplace automatically. A workspace admin can also request a sync from the marketplace controls. If an update is invalid, the last working imported version may be retained while the source is fixed.

## Codex user verification

After a successful workspace import and installation policy configuration:

1. Open a supported Codex task view.
2. Open **Sources**.
3. Select **Use plugins**.
4. Search for **SolveLang**.
5. Select the installed plugin.
6. Confirm the expected SolveLang skill/MCP capabilities are available.
7. Run one bounded read-only smoke task against a disposable repository or fixture.

Record the workspace-visible plugin name, imported source commit, installation policy, Codex surface used, and smoke result. Do not record credentials or private workspace data in repository evidence.

Because this plugin declares an MCP server, product UI may label an imported plugin **Desktop only**. That label is a product/runtime constraint and is not evidence of a failed marketplace import.

## Version truth before v0.3.0 publication

The selected next candidate is v0.3.0, but the actually published MCP/plugin line remains v0.2.0.

Until v0.3.0 is separately finalized and published:

- `packages/mcp-server/package.json` remains v0.2.0;
- public Codex/Claude plugin manifests remain v0.2.0;
- `plugins/solvelang/.mcp.json` pins `@solvelang/mcp-server@0.2.0`;
- a workspace import must not be changed to point at unpublished v0.3.0 package metadata.

PR #927 separately proves that current source can be staged into a clean-installable v0.3.0 tarball without changing those public pins.

## Public Plugin Directory boundary

Importing this GitHub marketplace into one workspace does **not** publish SolveLang to OpenAI's global public Plugin Directory.

As observed on 2026-09-16, a live public Plugin Directory search for `SolveLang` / `Solve Context` did not return a SolveLang listing. Recheck the live directory before changing that status.

Global discovery — the experience where a user opens the Plugin Directory, searches **SolveLang**, and installs it without first importing this repository — remains a separate OpenAI publication/review gate.

Do not claim public-directory availability until the listing is actually present in the live catalog and an independent clean account can discover/install it.

## Completion evidence for this milestone

Repository-side marketplace readiness is complete only when:

- the marketplace-import validator passes on the exact PR head;
- existing plugin packaging and MCP roundtrip tests pass;
- the public plugin remains pinned to the actually published MCP version;
- applicable repository-wide CI/security checks are green.

Workspace-import proof then requires the external admin/UI steps above. Public-directory proof requires a separate live catalog listing and clean-user discovery/install test.
