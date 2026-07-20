# Production Launch Control

The read-only launch control checks whether SolveLang's paid Workflow Preflight path is ready for a Stripe test-mode customer. It does not deploy infrastructure, change Stripe, create charges, publish npm, or print secret values.

## Run

From the repository root:

```bash
node ops/launch/launch-control.mjs --online
```

The command writes timestamped, commit-bound JSON and Markdown reports to `artifacts/launch-readiness/`. It exits zero only when every repository, configuration, and external test-mode control passes. Missing account prerequisites are reported as blockers by variable name and owner action.

Run the deterministic control tests without network or account credentials:

```bash
node --test ops/launch/launch-control.test.mjs
```

## Required protected inputs

Provide these through a protected local shell or CI environment. Do not commit their values:

- `AWS_REGION`
- `AWS_ROLE_ARN`
- `ENTITLEMENT_STACK_NAME`
- `SITE_ORIGIN`
- `STRIPE_SECRET_KEY` using an `sk_test_` key
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID` for an active test-mode Price
- `STRIPE_WEBHOOK_ENDPOINT`
- `ENTITLEMENT_SIGNING_SECRET`
- `NEXT_PUBLIC_ENTITLEMENT_API_BASE`
- `NPM_SCOPE_OWNERSHIP_VERIFIED=true`
- `NPM_PRODUCTION_ENVIRONMENT_PROTECTED=true`

The online run uses secrets only for authenticated probes. Reports contain control names, status, safe reasons, timestamps, commit SHA, and owner actions. They do not contain credential values, customer data, workflow JSON, report contents, or provider response bodies.

## Controls

The control center verifies:

- required AWS, Stripe, entitlement, site, webhook, and npm variable names;
- Stripe test mode rather than live mode;
- webhook URL consistency with the public entitlement API base;
- MCP manifest, lockfile, release tag, and public npm version consistency;
- npm Trusted Publishing guards, including OIDC and the protected `npm-production` environment;
- clean Git provenance;
- a safe entitlement health route in both the handler and infrastructure template;
- static privacy contracts that keep workflow/report payloads out of network requests and server error logs;
- deterministic Stripe test-mode lifecycle coverage, including replay, expiry, signature rejection, and browser recovery;
- the AWS stack, active Stripe test Price, registered test webhook, entitlement health endpoint, and public site when `--online` is used.

No account-level prerequisite is guessed or bypassed. A missing release tag, unpublished package version, undeployed stack, unavailable health endpoint, or unverified webhook remains a visible blocker.
