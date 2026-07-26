# Production Launch Control

The read-only launch control checks whether SolveLang's paid Workflow Preflight path is ready in the selected test or production mode. It does not deploy infrastructure, change Stripe, create charges, publish npm, or print secret values.

## Run

From the repository root:

```bash
node ops/launch/launch-control.mjs --online
```

The command writes timestamped, commit-bound JSON and Markdown reports to `artifacts/launch-readiness/`. It exits zero only when every repository, configuration, and external control passes. Missing account prerequisites are reported as blockers by variable name and owner action.

Launch Readiness CI runs the same fail-closed command with public inputs only and retains both evidence formats as a 30-day `launch-readiness-<commit>` artifact. Protected account credentials are intentionally not exposed to pull-request jobs, so account-level controls remain blockers there.

When GitHub CLI authentication is available, the online run reads environment and repository-variable metadata automatically. It verifies protection rules and variable names only; secret and variable values are never requested or emitted. The two npm variables below remain a local fallback when GitHub metadata cannot be read.

Run the deterministic control tests without network or account credentials:

```bash
node --test ops/launch/launch-control.test.mjs
```

## Required protected inputs

Provide these through a protected local shell or CI environment. Do not commit their values:

- `AWS_REGION`
- `AWS_ROLE_ARN`
- `ENTITLEMENT_STACK_NAME`
- `ENTITLEMENT_MODE` (`test` or `production`)
- `SITE_ORIGIN`
- `STRIPE_SECRET_KEY` matching the selected mode
- `STRIPE_WEBHOOK_SECRET`
- `TURNSTILE_SECRET_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `STRIPE_WEBHOOK_ENDPOINT`
- `ENTITLEMENT_SIGNING_SECRET`
- `NEXT_PUBLIC_ENTITLEMENT_API_BASE`
- `NPM_SCOPE_OWNERSHIP_VERIFIED=true`
- `NPM_PRODUCTION_ENVIRONMENT_PROTECTED=true`
- `LEGAL_CHECKOUT_REVIEW_VERIFIED=true` only after the owner completes the checkout legal checklist.

The online run uses secrets only for authenticated probes. Reports contain control names, status, safe reasons, timestamps, commit SHA, and owner actions. They do not contain credential values, customer data, workflow JSON, report contents, or provider response bodies.

## Controls

The control center verifies:

- required AWS, Stripe, entitlement, site, webhook, and npm variable names;
- Stripe key mode matches `ENTITLEMENT_MODE`;
- webhook URL consistency with the public entitlement API base;
- MCP manifest, lockfile, release tag, and public npm version consistency;
- npm Trusted Publishing guards, including OIDC and the protected `npm-production` environment;
- clean Git provenance;
- a safe entitlement health route in both the handler and infrastructure template;
- static privacy contracts that keep workflow/report payloads out of network requests and server error logs;
- deterministic Stripe lifecycle coverage, including refund revocation, replay, expiry, signature rejection, and browser recovery;
- server-side Turnstile verification before checkout can create a PaymentIntent;
- enforceable checkout consent, versioned Terms and Refund Policy links, and a legal-review blocker before production checkout enablement;
- the AWS stack, matching Stripe account, registered webhook, entitlement health endpoint, and public site when `--online` is used.

Entitlement CI executes the deterministic lifecycle, privacy, browser recovery, and launch-control tests before `node ops/launch/assert-entitlement-gates.mjs` can pass. The code gates therefore require both the implementation contracts and their regression suites; a placeholder test filename is insufficient.

No account-level prerequisite is guessed or bypassed. A missing release tag, unpublished package version, undeployed stack, unavailable health endpoint, or unverified webhook remains a visible blocker.

After repository gates pass, follow the exact owner-only sequence in [the launch owner runbook](launch-owner-runbook.md).
