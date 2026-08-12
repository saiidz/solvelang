# Production customer-account readiness

This checklist covers readiness only. It does not authorize or perform a production customer-account deployment.

## Current production boundary

The deployed production foundation must remain inert while this checklist is evaluated:

- `API_ACCESS_MODE=live`
- `API_ACCESS_ENABLED=false`
- `CUSTOMER_ACCOUNTS_ENABLED=false`
- `SUBSCRIPTION_BILLING_ENABLED=false`
- no Stripe secret injection
- no subscription webhook
- no charges

The SAM template intentionally keeps the `CustomerAccountsRemainTestOnly` rule in place during readiness validation.

## Required readiness evidence

The protected `Preflight API Access Production Customer Accounts` workflow must pass from `main` and prove:

1. The production CloudFormation stack is in a stable complete state.
2. `/health` still reports API access, customer accounts, and subscription billing disabled.
3. The production customer-auth pepper exists, is at least 32 characters, and is distinct from the API-key pepper and admin secret.
4. The configured customer-auth SES sender is verified for sending.
5. The SES account has production sending access so customer sign-in is not limited to sandbox recipients.
6. `https://www.solve-lang.com/account/api-keys/` is reachable.
7. The full API-access tests pass.
8. The SAM template validates and builds.
9. The live customer-account template gate is still present after preflight.

The preflight must not run `sam deploy`, send a magic-link email, reference Stripe secrets, configure webhooks, create Stripe objects, or perform charges.

## Separate approval required before enablement

Passing readiness is not approval to enable customer accounts. Before any production change may set `API_ACCESS_ENABLED=true` or `CUSTOMER_ACCOUNTS_ENABLED=true`, require all of the following:

- a separate reviewed PR that removes or replaces the live customer-account template gate without weakening the billing gate;
- an explicit production deployment workflow that hard-codes `SUBSCRIPTION_BILLING_ENABLED=false` and does not inject Stripe credentials;
- a rollback path back to the verified inert foundation;
- a canary plan using an owner-controlled email address;
- explicit owner approval for the customer-account production deployment.

Billing remains a later, independent phase and must stay disabled throughout customer-account activation and canary verification.
