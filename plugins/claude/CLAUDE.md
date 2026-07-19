# SolveLang MCP Guidance

When reviewing workflow files, prefer the `solvelang` MCP tools over ad hoc guesses.

- Call `solvelang_analyze_n8n` for exported n8n JSON.
- Call `solvelang_generate_n8n_report` for a complete Markdown or JSON report.
- Call `solvelang_validate_solve` for `.solve` files when the local `solvec` executable is available.
- Call `solvelang_capabilities` when limits or privacy boundaries are unclear.

Treat results as deterministic structural analysis. Do not claim runtime execution, credential validation, external API testing, or production guarantees. Prioritize critical and high findings and include affected nodes and concrete fixes.
