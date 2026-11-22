# SolveLang for VS Code

This package registers `.solve` files with comments, bracket matching, and syntax highlighting. It does not execute SolveLang source.

## Local tooling (opt in)

Install `solvec` and `solvelsp` yourself, then enable the commands in VS Code settings:

```json
{
  "solvelang.languageServer.enabled": true,
  "solvelang.languageServer.command": "solvelsp",
  "solvelang.formatter.enabled": true,
  "solvelang.formatter.command": "solvec"
}
```

`SolveLang: Start Language Server` starts only the configured `solvelsp` stdio process. `SolveLang: Format Document` invokes the configured local formatter executable with the fixed `fmt` subcommand and the saved `.solve` file path after formatting is explicitly enabled. The extension does not provide configurable formatter arguments, so its formatting command cannot be changed to request `solvec run`.

The package does not bundle executables, install dependencies, enable network access, or start a language server/formatter by default. Any configured local executable path is an explicit user trust decision.

## Solve Context via MCP (opt in)

The extension can drive the local SolveLang MCP server (`solvelang-mcp` from `@solvelang/mcp-server`) over stdio:

```json
{
  "solvelang.mcp.enabled": true,
  "solvelang.mcp.command": "solvelang-mcp"
}
```

With MCP enabled, `SolveLang: List MCP Tools` shows the server's read-only tools, `SolveLang: Create Context Pack` builds a content-addressed Solve Context pack for the open workspace and a task you describe, and `SolveLang: Inspect Context Pack` summarizes a pack's hash-pinned entries. `SolveLang: Stop MCP Server` stops the process. MCP is disabled by default and no server process starts until an MCP command runs; the server is bound to the open workspace and stays read-only. See `docs/integrations/vscode-extension.md` for the full picture.

The extension is built and packaged (a `.vsix` builds cleanly) but is **not published** to the Visual Studio Marketplace — no publisher account exists yet; that is an owner step.
