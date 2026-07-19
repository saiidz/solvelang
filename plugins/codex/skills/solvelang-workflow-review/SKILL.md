# SolveLang Workflow Review

Use the SolveLang MCP tools when the user asks to validate, review, preflight, score, document, or explain an n8n workflow or `.solve` file.

## Workflow

1. Call `solvelang_capabilities` when environment limits or tool availability are unclear.
2. For n8n JSON, call `solvelang_analyze_n8n` first.
3. Use `solvelang_generate_n8n_report` when the user requests a complete reviewable artifact.
4. For `.solve` files, call `solvelang_validate_solve`.
5. Treat tool findings as deterministic structural evidence, not proof of production behavior.
6. Explain critical and high findings before medium and low findings.
7. Never claim that the workflow was executed, credentials were verified, or external APIs were tested.
8. Do not modify files unless the user separately requests an edit and an approved write tool exists.

## Review format

Report:

- readiness score;
- critical and high findings;
- affected nodes;
- concrete recommendations;
- limitations and untested runtime assumptions.

## Safety

All v1 SolveLang MCP tools are read-only. Do not bypass workspace path boundaries or ask the user to expose credentials.
