# API access test deployment

The `Deploy API Access Test` workflow deploys only from `main` into the protected GitHub environment `api-access-test`. It has no production or live-mode path.

## Deployment stages

1. `foundation`
   - Deploys the API, tables, authorizer, and internal routes.
   - `ApiAccessEnabled=true`.
   - Customer accounts and subscription billing remain disabled.
2. `customer-accounts`
   - Enables passwordless customer sessions and API-key dashboard routes.
   - Requires a verified SES sender.
   - Subscription billing remains disabled.
3. `subscription-billing`
   - Enables customer accounts and Stripe test-mode subscription Checkout/webhooks.
   - Requires three active monthly recurring Stripe test Prices and a signed webhook secret.

Each stage runs tests, SAM lint, SAM build, CloudFormation deployment, and a deployed `/health` assertion.

## Protected GitHub environment

Create a GitHub environment named `api-access-test`. Restrict deployments to `main` and require approval if available.

### Environment secrets

- `AWS_ROLE_ARN` — OIDC role used only for the API access test stack.
- `API_KEY_PEPPER` — at least 32 random characters.
- `API_ACCESS_ADMIN_SECRET` — at least 32 random characters and distinct from every pepper.
- `CUSTOMER_AUTH_PEPPER` — required for the customer-account and billing stages; at least 32 random characters and distinct from the API key pepper and admin secret.
- `STRIPE_SECRET_KEY` — required only for the billing stage and must begin with `sk_test_`.
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` — required only for the billing stage and must begin with `whsec_`.

### Environment variables

- `AWS_REGION`
- `API_ACCESS_STACK_NAME` — must contain `test`.
- `SITE_ORIGIN` — HTTPS site origin, normally `https://www.solve-lang.com`.
- `CUSTOMER_AUTH_EMAIL_SENDER` — SES identity verified for sending.
- `CUSTOMER_AUTH_EMAIL_REPLY_TO` — optional.
- `STRIPE_API_DEVELOPER_PRICE_ID`
- `STRIPE_API_PRO_PRICE_ID`
- `STRIPE_API_BUSINESS_PRICE_ID`

The Stripe Price IDs must be unique, active, recurring monthly test Prices.

## AWS role boundaries

The OIDC deployment role should be restricted to the test stack and its test artifact bucket. It needs CloudFormation/SAM deployment permissions, Lambda, API Gateway, DynamoDB, IAM role creation or pass-role as required by SAM, SES identity read and send permissions, S3 access to the dedicated artifact bucket, and CloudWatch Logs permissions.

Do not reuse a production deployment role.

## First deployment sequence

1. Configure only the foundation secrets and variables.
2. Dispatch `Deploy API Access Test` from `main` with stage `foundation` and confirm the test-only checkbox.
3. Confirm the workflow health assertion passes and record the `ApiAccessBaseUrl` output.
4. Verify the SES sender, add the customer authentication pepper, then deploy `customer-accounts`.
5. Set `NEXT_PUBLIC_API_ACCESS_BASE_URL` for the static site test build to the emitted API base URL.
6. Create the three Stripe test Products/Prices, register the test webhook endpoint, add the test secrets and Price IDs, then deploy `subscription-billing`.
7. Exercise magic-link replay, source throttling, Checkout success/cancel, signed webhook delivery, subscription cancellation, failed renewal, API-key revocation, and quota exhaustion before any production design is considered.

## Rollback

Re-dispatch an earlier stage from `main`:

- `foundation` disables customer accounts and billing.
- `customer-accounts` disables billing but leaves customer authentication enabled.

This workflow intentionally cannot deploy live mode or a production stack.
