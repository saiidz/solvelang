---
name: solvelang-workflow-review
description: Review n8n workflow JSON and canonical Solve Graph documents with deterministic read-only SolveLang tools. Use for workflow preflight, structural risk, graph search, dependencies, paths, or change impact.
---

# SolveLang Workflow And Graph Review

Use the SolveLang connector when the user asks to inspect, review, preflight, score, document, search, trace, or explain supplied n8n workflow JSON or canonical Solve Graph JSON.

## Workflow

1. Call `solvelang_capabilities` when tool availability or limits are unclear.
2. For n8n JSON, call `solvelang_analyze_n8n` first.
3. Use `solvelang_generate_n8n_report` when the user requests a complete Markdown or JSON report.
4. For canonical Solve Graph JSON, use `solvelang_graph_find_nodes` or `solvelang_graph_search_nodes` to resolve relevant stable node IDs.
5. Use `solvelang_graph_dependencies` for outbound dependency questions and `solvelang_graph_dependents` for inbound dependency questions.
6. Use `solvelang_graph_shortest_path` for one bounded path between two stable node IDs.
7. Use `solvelang_graph_impact` for blast-radius questions and `solvelang_graph_explain_impact` when the user wants the impact explained.
8. Keep traversal depth and result limits as small as the question permits.
9. Treat findings as deterministic structural evidence, not runtime proof.

## Important limits

The public Claude connector accepts supplied JSON only. It does not read the user's filesystem or repository, run local subprocesses, validate local `.solve` files, execute workflows, inspect secret credential values, call external providers, or write files.

If the user asks for local `.solve` validation or workspace-path analysis, explain that those are local-only SolveLang capabilities and are not available through the public directory connector.

## Output

For workflow reviews, prioritize critical and high findings, affected nodes, concrete recommendations, and limitations.

For graph questions, report resolved node IDs, direct relationships before transitive relationships, edge kinds and bounded depth where relevant, whether results were truncated, and the limits of static evidence.
