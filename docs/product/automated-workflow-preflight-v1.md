# Automated Workflow Preflight v1

## Goal

Create the first no-touch SolveLang product flow:

1. A visitor uploads an exported n8n workflow JSON file.
2. SolveLang validates and analyzes it locally in the browser.
3. The visitor receives an immediate deterministic score and finding preview.
4. The visitor can download HTML and JSON evidence during the public beta.
5. Paid access is introduced only after server-side Stripe verification and signed report entitlements exist.

## Route

- `/check/`

## Privacy and safety

- Workflow files are read with the browser `File` API.
- No file, node parameter, credential reference, or report is transmitted by this version.
- Maximum file size: 2 MB.
- Maximum node count: 5,000.
- The scanner never executes the workflow or calls external services.
- Downloaded HTML escapes workflow-controlled text.
- Credential values are not included in findings or generated reports.

## Deterministic checks

The v1 n8n adapter checks for:

- missing real trigger nodes;
- absent connections;
- disconnected nodes;
- disabled nodes;
- code and command execution;
- AI or agent actions without a recognizable human-review gate;
- external calls without a recognizable error path;
- credential references;
- missing deliberate terminal nodes.

`Respond to Webhook` is a response/terminal node. It is deliberately excluded from both trigger detection and error-handler detection.

The score is bounded from 0 through 100 and uses fixed severity penalties.

The browser and MCP analyzers run the shared fixtures in `fixtures/n8n-preflight-parity/`. The parity suite locks finding IDs and scores for enabled safeguards, disconnected risky workflows, disabled execution nodes, terminal-free loops, and invalid workflow shapes without coupling the browser bundle to the MCP package.

## Public beta access

The repository remains a static Next.js export. Browser-only code cannot prove that a Stripe payment succeeded or safely protect a paid download.

For that reason:

- the full HTML and JSON reports are explicitly labeled free beta downloads;
- the application does not display an “Unlock for $49” claim;
- no Stripe Payment Link is activated in this static version;
- no client-side query parameter, local-storage value, or redirect is treated as proof of payment.

This keeps the product truthful and fail-closed while scan quality and demand are validated.

## Required paid-production follow-up

A truly gated paid report requires a server-side Stripe webhook and signed entitlement token. Implement that follow-up in a separate serverless service before claiming that payment unlocks protected content.

The service must:

- validate Stripe webhook signatures;
- associate PaymentIntents with opaque scan identifiers;
- issue short-lived signed unlock tokens;
- avoid receiving workflow contents unless the customer explicitly opts into hosted analysis;
- support refunds, replay protection, and idempotency;
- retain no workflow data by default.

## Validation

Run:

```bash
cd site
npm ci
npm run test:studio
npm run lint
npm run build
```

The deterministic suite includes the preflight parser, bounded input checks, structural findings, webhook-response classification, HTML-injection protection, and credential-reference privacy.
