# Automated Workflow Preflight v1

## Goal

Create the first no-touch SolveLang product flow:

1. A visitor uploads an exported n8n workflow JSON file.
2. SolveLang validates and analyzes it locally in the browser.
3. The visitor receives an immediate deterministic score and finding preview.
4. The visitor can download HTML and JSON evidence.
5. A Stripe Payment Link can be enabled without changing application code by setting `NEXT_PUBLIC_STRIPE_PREFLIGHT_PAYMENT_LINK` during the static-site build.

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

- missing trigger nodes;
- absent connections;
- disconnected nodes;
- disabled nodes;
- code and command execution;
- AI or agent actions without a recognizable human-review gate;
- external calls without a recognizable error path;
- credential references;
- missing deliberate terminal nodes.

The score is bounded from 0 through 100 and uses fixed severity penalties.

## Checkout activation

The repository remains a static Next.js export. A secure paid entitlement cannot be proven in browser-only code. The UI therefore fails closed:

- When `NEXT_PUBLIC_STRIPE_PREFLIGHT_PAYMENT_LINK` is absent, the page displays `Checkout configuration required`.
- When it is present, the page sends the buyer to the configured Stripe-hosted checkout.
- The current beta report download remains available so product demand and scan quality can be tested before entitlement infrastructure is introduced.

Set the environment variable in the production build system:

```text
NEXT_PUBLIC_STRIPE_PREFLIGHT_PAYMENT_LINK=https://buy.stripe.com/...
```

Do not place Stripe secret keys in `NEXT_PUBLIC_*` variables or in this repository.

## Required paid-production follow-up

A truly gated paid report requires a server-side Stripe webhook and signed entitlement token. Because this repository intentionally exports a static site with no API routes, implement that follow-up in a separate serverless service before claiming that payment unlocks protected content.

The service must:

- validate Stripe webhook signatures;
- associate checkout sessions with opaque scan identifiers;
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

The deterministic suite includes the preflight parser, bounded input checks, structural findings, HTML-injection protection, and credential-reference privacy.
