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
