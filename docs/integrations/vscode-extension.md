# SolveLang for VS Code

The extension in `editors/vscode-solvelang/` provides `.solve` language
support plus opt-in local tooling for VS Code.

## State

Built and packaged (a `.vsix` builds cleanly from the package), but
**not published**: there is no Visual Studio Marketplace publisher
account for SolveLang yet, and creating one is an owner step. Until
then the extension is installed manually from a packaged `.vsix`
(`Extensions: Install from VSIX…`) or used from source.

## Features

- `.solve` language registration: comments, bracket matching, and a
  TextMate grammar for syntax highlighting. The extension never
  executes SolveLang source itself.
- **Language server (opt-in):** starts a configured local `solvelsp`
  stdio process. Off by default.
- **Formatter (opt-in):** `SolveLang: Format Document` invokes the
  configured local `solvec` with the fixed `fmt` subcommand. Off by
  default; no configurable formatter arguments exist, so the command
  cannot be turned into `solvec run`.
- **MCP + Solve Context (opt-in):** four commands backed by the local
  SolveLang MCP server (`@solvelang/mcp-server`, stdio transport):
  - `SolveLang: List MCP Tools` — lists the server's read-only tools.
  - `SolveLang: Create Context Pack` — asks for a task and calls
    `solvelang_context_pack` for the open workspace, opening the
    resulting content-addressed pack as JSON.
  - `SolveLang: Inspect Context Pack` — same build, rendered as a
    summary: pack id, entry count, and each entry's path, line range,
    size, and source hash.
  - `SolveLang: Stop MCP Server` — stops the local server process.

## MCP settings

```json
{
  "solvelang.mcp.enabled": true,
  "solvelang.mcp.command": "solvelang-mcp",
  "solvelang.mcp.args": []
}
```

- `solvelang.mcp.enabled` defaults to **false**. No MCP process starts
  until the setting is on AND an MCP command runs.
- The server is spawned with the first workspace folder as its working
  directory and `SOLVELANG_WORKSPACE_ROOT` set to that folder, so the
  MCP server's read-only, workspace-bounded contract applies exactly
  as it does for Claude Code / Codex: tools can read only inside the
  workspace, return content-addressed excerpts with hashes, and never
  write files, run workflows, or use the network.
- The extension's MCP client (`mcp-client.js`) is dependency-free and
  stdio-only; it opens no network connections.

## Trust model

Any configured local executable path (`solvelsp`, `solvec`,
`solvelang-mcp`) is an explicit user trust decision, the same as for
the language server and formatter. The package does not bundle
executables and does not install dependencies.

## Development

```bash
cd editors/vscode-solvelang
npm test          # contract + client tests (node --test)
npx @vscode/vsce package   # local .vsix packaging proof
```

The CI workflow `.github/workflows/vscode-extension-ci.yml` runs the
suite on extension or MCP-server changes, including a headless smoke
test that drives the real local MCP server through the extension's own
client.
