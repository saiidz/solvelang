# Claude directory submission packet — SolveLang

Status: repository-ready candidate for Anthropic's Claude directory.

Anthropic's current directory flow treats SolveLang as two related submissions:

1. an **MCP connector** for the public remote server; and
2. a **Plugin bundle** for the GitHub-hosted skill plus connector reference.

Submit the connector first, then the plugin bundle, and pair them in the same Claude organization.

## Developer portal

Portal: `https://claude.ai/directory/manage`

A paid Claude plan is required. On Team or Enterprise, an eligible Owner/Directory role must submit.

## MCP connector submission

### Connection

- URL: `https://mcp.solve-lang.com/mcp`
- Transport: Streamable HTTP
- Authentication: no authentication
- Health URL: `https://mcp.solve-lang.com/healthz`

### Listing

- Server name: `SolveLang`
- One-liner: `Deterministic read-only workflow and repository graph analysis.`
- Description: `Analyze supplied n8n workflow JSON and canonical Solve Graph documents with deterministic read-only tools. SolveLang can prioritize structural workflow risks, generate preflight reports, search graph nodes, trace dependencies and dependents, find bounded paths, and explain change impact. It does not execute workflows, inspect credential values, read a local workspace, modify repositories, or call third-party providers.`
- Suggested categories: Developer tools; Data & analytics
- Documentation: `https://www.solve-lang.com/mcp/`
- Privacy policy: `https://www.solve-lang.com/privacy-policy/`
- Support: `hello@solve-lang.com`
- Icon source: `plugins/solvelang/assets/solvelang-mark.svg`
- Suggested slug: `solvelang`

### Use cases

1. Review n8n workflow JSON and prioritize structural risks.
2. Generate deterministic workflow preflight reports.
3. Search canonical Solve Graph nodes and trace dependency relationships.
4. Explain bounded change impact from stable graph node IDs.

Connection prerequisites: none. No SolveLang account is required for the public read-only connector.

### Company

- Product / brand: SolveLang
- Operator: UPCOMINGSOUNDS S.R.L.
- Website: `https://www.solve-lang.com/`
- Primary review contact: `hello@solve-lang.com`

### Authentication

Choose **No authentication**.

### Data handling

- Underlying API: first-party SolveLang service.
- Tool inputs: only JSON explicitly supplied to a tool call.
- Persistence: raw workflow and Solve Graph JSON is processed in memory and is not intentionally persisted or logged by the application.
- Third parties: hosting/edge providers may process technical request metadata for delivery, security, and abuse prevention as disclosed in the privacy policy.
- Writes: none.
- Personal health data: not an intended use.
- Sponsored content: none.

### Reviewer access

No credentials are required because the connector is public and anonymous. Reviewers can use the checked-in fixture at `docs/integrations/openai-plugin-review-fixture.json` for Solve Graph calls and simple synthetic n8n JSON for workflow calls.

Before submission, exercise every remote tool through Claude as a custom connector or MCP Inspector.

## Plugin bundle submission

### Source

- Repository: `saiidz/solvelang`
- Plugin path: `plugins/solvelang-claude`
- Tracked branch: `main`
- Plugin name: `solvelang`
- Display name: `SolveLang`
- Version: `0.3.1`

The plugin contains a public remote `.mcp.json` pointing to the same connector URL and one workflow-review skill tuned to the remote tool surface.

### Data handling

Answer consistently with the connector: the plugin itself stores no user data; supplied JSON is sent only to the declared SolveLang connector for in-memory analysis; no unrelated external service receives plugin data.

### Compliance

Use `hello@solve-lang.com` as the contact address. The human submitter must review and accept Anthropic's required directory acknowledgements in the portal.

## Review notes

The public connector is intentionally narrower than SolveLang's local development package:

- no workspace paths;
- no local `.solve` validation;
- no subprocesses;
- no repository writes;
- no external provider calls;
- no credential-value inspection.

Every remote tool has a title plus `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`.

## Publication order

1. Verify `https://mcp.solve-lang.com/healthz`.
2. Add the server as a custom connector in Claude and test all remote tools.
3. In the developer portal, submit **MCP connector**.
4. Submit **Plugin bundle** from `plugins/solvelang-claude`.
5. Pair the connector and plugin from the same Claude organization when the portal offers the option.
6. Resolve validation/security-scan findings.
7. Publish the passing listing(s) when Anthropic enables the publish action.
