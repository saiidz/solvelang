# SolveLang for VS Code

This package registers `.solve` files with comments, bracket matching, and syntax highlighting. It does not execute SolveLang source.

## Local tooling (opt in)

Install `solvec` and `solvelsp` yourself, then enable the commands in VS Code settings:

```json
{
  "solvelang.languageServer.enabled": true,
  "solvelang.languageServer.command": "solvelsp",
  "solvelang.formatter.enabled": true,
  "solvelang.formatter.command": "solvec",
  "solvelang.formatter.args": ["fmt"]
}
```

`SolveLang: Start Language Server` starts only the configured `solvelsp` stdio process. `SolveLang: Format Document` invokes `solvec fmt` only for a saved `.solve` file after formatting is explicitly enabled. Neither command invokes `solvec run`.

The package does not bundle executables, install dependencies, enable network access, or start a language server/formatter by default.
