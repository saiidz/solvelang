# SolveLang Workflow And Graph Review

Use the SolveLang MCP tools when the user asks to validate, review, preflight, score, document, or explain an n8n workflow or `.solve` file, or when they provide a canonical Solve Graph and ask about repository structure, dependencies, dependents, or change impact.

## Workflow

1. Call `solvelang_capabilities` when environment limits or tool availability are unclear.
2. For n8n JSON, call `solvelang_analyze_n8n` first.
3. Use `solvelang_generate_n8n_report` when the user requests a complete reviewable workflow artifact.
4. For `.solve` files, call `solvelang_validate_solve`.
5. For canonical `solvelang.graph.v0` JSON, use `solvelang_graph_find_nodes` to resolve stable node IDs before traversal when the user names files, symbols, routes, tests, jobs, resources, or other graph entities instead of IDs.
6. Use `solvelang_graph_dependencies` for outbound dependency questions and `solvelang_graph_dependents` for inbound dependency questions. Keep traversal depth and result limits as small as the question permits.
7. Use `solvelang_graph_impact` for blast-radius/change-impact questions. Treat its default edge filter as dependency impact, not containment membership.
8. Treat all tool findings as deterministic structural evidence, not proof of production behavior.
9. Explain critical and high workflow findings before medium and low findings; for graph questions, explain roots and shortest reported dependency paths before broader transitive results.
10. Never claim that a workflow or repository was executed, credentials were verified, external APIs were tested, or a graph query inspected anything outside the supplied canonical document.
11. Do not modify files unless the user separately requests an edit and an approved write tool exists.

## Review format

For workflow reviews, report:

- readiness score;
- critical and high findings;
- affected nodes;
- concrete recommendations;
- limitations and untested runtime assumptions.

For Solve Graph questions, report:

- graph ID and resolved root node IDs;
- direct relationships before transitive relationships;
- edge kinds and bounded depth where relevant;
- whether the result was truncated;
- limitations of deterministic static evidence.

## Safety

All SolveLang MCP analysis tools are read-only. Do not bypass workspace path boundaries, ask the user to expose credentials, accept a graph that fails canonical integrity checks, or present dependency/impact output as authorization to change production systems.
