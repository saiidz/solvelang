# SolveLang project instructions

When working on SolveLang or the SolveLang website, use the `solvelang` MCP server when helpful.

Use the MCP tools for:
- running safe preview SolveLang snippets
- checking example syntax
- explaining the hosted runner MVP
- validating simple SolveLang examples before editing docs or landing page copy

Important:
- `solvelang_run_preview` is a preview runner, not the full Rust runtime.
- It supports let variables, print statements, string/number/boolean values, and simple if blocks using == or !=.
- For full language behavior, inspect the Rust code in the `solvec` repository.
