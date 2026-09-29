# OpenAI public plugin submission packet — SolveLang

Status: **repository-ready candidate; public MCP deployment and OpenAI account gates remain external**.

This packet is the source of truth for submitting SolveLang through OpenAI Platform **Create plugin → With MCP**. Do not claim the plugin is published or searchable until OpenAI approves the submission and the approved version is explicitly published.

## Listing

- Plugin name: `SolveLang`
- Developer name: `SolveLang`
- Category: `Developer Tools`
- Short description: `Workflow & graph analysis`
- Long description: `Use SolveLang in ChatGPT and Codex to analyze n8n workflow JSON and canonical Solve Graph documents, trace dependencies and change impact, explain structural risk, and generate deterministic read-only reports without executing workflows or mutating repositories.`
- Website: `https://www.solve-lang.com/`
- Product/MCP reference: `https://www.solve-lang.com/mcp/`
- Support: `https://www.solve-lang.com/support/`
- Privacy policy: `https://www.solve-lang.com/privacy-policy/`
- Terms: `https://www.solve-lang.com/terms/`
- Source: `https://github.com/saiidz/solvelang`
- Logo/composer icon: `plugins/solvelang/assets/solvelang-mark.svg`
- UI screenshots: none; the remote MCP currently returns model-readable text/JSON and does not provide custom plugin UI.
- Intended availability: all countries/regions offered by the submission portal unless legal/product review narrows availability.

## Remote MCP

- Intended production URL: `https://mcp.solve-lang.com/mcp`
- Health URL: `https://mcp.solve-lang.com/healthz`
- Transport: MCP Streamable HTTP, stateless JSON response mode.
- Public-directory auth mode: `noauth`.
- Server environment: `SOLVELANG_REMOTE_AUTH_MODE=noauth`.
- Domain challenge environment: `SOLVELANG_OPENAI_APPS_CHALLENGE_TOKEN=<exact token from OpenAI portal>`.
- Domain challenge path: `https://mcp.solve-lang.com/.well-known/openai-apps-challenge`.
- Request ceiling: 4 MiB before MCP parsing.
- n8n/Solve Graph analysis ceilings: 2 MiB inputs, plus per-tool node/traversal limits.
- Data handling: input JSON is processed in memory by the application and is not intentionally logged or persisted. Production edge/hosting may process request metadata required for delivery, rate limiting, security, and abuse prevention.

The public endpoint must be deployed behind HTTPS with rate limiting, abuse monitoring, sanitized request logs, health monitoring, and rollback controls before submission.

## Starter prompts

1. `Review this n8n workflow with SolveLang and prioritize the structural risks.`
2. `Trace the dependent impact of these changed Solve Graph nodes.`
3. `Find the shortest dependency path between these two Solve Graph nodes.`

## Tool annotations and justifications

Every remote tool advertises:

- `readOnlyHint: true` — tools compute analysis from request-supplied JSON and do not change user, repository, workflow, or provider state.
- `destructiveHint: false` — tools have no write or deletion path.
- `openWorldHint: false` — tools do not browse the internet or query open-ended external entities; they analyze only the bounded JSON in the request.
- `idempotentHint: true` — the same valid input produces the same deterministic analysis.
- `securitySchemes: [{ "type": "noauth" }]` in public-directory mode — no private account data or user-specific actions are exposed.

Remote tools in the submission:

1. `solvelang_analyze_n8n`
2. `solvelang_generate_n8n_report`
3. `solvelang_graph_find_nodes`
4. `solvelang_graph_search_nodes`
5. `solvelang_graph_dependencies`
6. `solvelang_graph_dependents`
7. `solvelang_graph_shortest_path`
8. `solvelang_graph_impact`
9. `solvelang_graph_explain_impact`
10. `solvelang_capabilities`

## Five positive review test cases

### Positive 1 — analyze an n8n workflow

**Prompt**

`Review this n8n workflow with SolveLang and tell me the highest-priority structural risks: {"name":"Plugin review","nodes":[{"name":"Webhook","type":"n8n-nodes-base.webhook"},{"name":"Code","type":"n8n-nodes-base.code"}],"connections":{}}`

**Expected behavior**

- Calls `solvelang_analyze_n8n`.
- Returns deterministic structural findings, score/severity evidence as provided by the tool.
- Makes clear the workflow was not executed.
- Does not invent credential validity, external API availability, or runtime success.

### Positive 2 — generate a Markdown report

**Prompt**

`Generate a SolveLang Markdown preflight report for this n8n workflow: {"name":"Manual example","nodes":[{"name":"Manual Trigger","type":"n8n-nodes-base.manualTrigger"}],"connections":{}}`

**Expected behavior**

- Calls `solvelang_generate_n8n_report` with `format: "markdown"`.
- Returns the report with workflow name, result, score, node/connection counts, findings and recommendations when present.
- Ends with or preserves the deterministic-analysis/no-execution boundary.

### Positive 3 — explain remote capabilities

**Prompt**

`What can the SolveLang plugin do remotely, and what is intentionally unavailable?`

**Expected behavior**

- Calls `solvelang_capabilities`.
- Accurately reports read-only raw-JSON analysis, size limits, listed tools, and unavailable local-only operations.
- Does not claim workspace filesystem access, `.solve` subprocess validation, repository writes, or provider calls.

### Positive 4 — search a valid Solve Graph

**Prompt**

`Use SolveLang to find nodes containing "src/" in this canonical Solve Graph JSON: <paste the exact contents of docs/integrations/openai-plugin-review-fixture.json>.`

**Expected behavior**

- Calls `solvelang_graph_search_nodes` or `solvelang_graph_find_nodes` with the supplied graph.
- Returns only matches derived from the supplied graph.
- Does not fetch repository or web data.

Use the checked-in `docs/integrations/openai-plugin-review-fixture.json` verbatim. It is a deterministic canonical graph with valid stable IDs and integrity metadata.

### Positive 5 — trace change impact

**Prompt**

`Using this canonical Solve Graph, trace the dependent impact of changed node sgn_b498868aee5ba6ac17a45ecaa485e9ec and explain the most important affected nodes: <paste the exact contents of docs/integrations/openai-plugin-review-fixture.json>.`

**Expected behavior**

- Calls `solvelang_graph_impact` and/or `solvelang_graph_explain_impact`.
- Uses only the supplied graph and stable IDs.
- Respects configured traversal/result limits.
- Reports no external side effects.

Use the same checked-in fixture as Positive 4. The changed node is `src/store.ts`; it has an importing dependent `src/api.ts`, which in turn has the `test/api.test.ts` test dependent, so the impact case has a deterministic non-empty result.

## Three negative review test cases

### Negative 1 — malformed n8n JSON

**Prompt**

`Analyze this as an n8n workflow: {"nodes": [}`

**Expected behavior**

- Fails safely with a concise invalid-JSON/input error.
- Does not echo secrets or fabricate findings.
- Does not call external services to repair the input.

### Negative 2 — request an unsupported write

**Prompt**

`Use SolveLang to fix this workflow and deploy the corrected workflow to my n8n production server.`

**Expected behavior**

- Does not claim to deploy, modify, or contact n8n.
- Explains that the public SolveLang plugin is read-only analysis and can review supplied JSON, but external mutation/deployment is outside the tool surface.

### Negative 3 — request credential inspection

**Prompt**

`Read the credentials in this n8n workflow and tell me whether the API tokens are valid.`

**Expected behavior**

- Does not claim access to secret credential values or validate live tokens.
- States the plugin performs structural analysis only and has no outbound provider access.
- If JSON is supplied, it may analyze structure without exposing or inferring credential values.

## Release notes

`Initial public SolveLang plugin submission. Adds deterministic read-only analysis for n8n workflow JSON and canonical Solve Graph documents through a bounded remote MCP endpoint for ChatGPT and Codex. The plugin does not execute workflows, mutate repositories, inspect credential values, or call external providers.`

## Demo recording checklist

A remote-MCP submission requires a public/reviewer-accessible demo recording URL. Record one short session after production deployment that shows:

1. Search/connect to the SolveLang draft in developer/review mode.
2. Positive 1: n8n analysis.
3. Positive 3: capabilities boundary.
4. Positive 5: Solve Graph impact.
5. Negative 2: refusal/boundary for deployment/write request.
6. The public `/mcp/`, privacy, support and terms pages.
7. No secrets, production credentials, private customer data, or internal admin screens.

Paste the final recording URL into the OpenAI submission portal; do not commit private reviewer credentials or unpublished secrets to this repository.

## Account-only gates

These cannot be completed from repository automation:

- verified individual or business identity in the OpenAI Platform organization used for submission;
- Apps Management write permission;
- creation of the plugin draft in the OpenAI submission portal;
- the portal-generated domain-verification token;
- Scan Tools against the live production endpoint;
- the demo-recording URL;
- policy attestations and final `Submit for review`;
- after approval, the explicit `Publish` action that makes SolveLang searchable in the universal Plugins Directory.
