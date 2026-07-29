# SolveLang API Access

This service is the fail-closed foundation for recurring SolveLang API subscriptions and customer-managed API keys.

## Current scope

- Subscription account records for `developer`, `pro`, and `business` plans.
- One-time API key issuance using `sl_test_*` and `sl_live_*` formats.
- HMAC-SHA-256 key fingerprints; plaintext secrets are never stored.
- Constant-time API key, session, and CSRF verification.
- Per-plan atomic active-key limits and key revocation.
- Lambda authorizer for `Authorization: Bearer $SOLVELANG_API_KEY`.
- Hard monthly request limits stored transactionally in DynamoDB.
- Idempotent usage consumption on every protected request.
- A protected `/v1/whoami` diagnostic endpoint.
- Passwordless customer accounts using 15-minute, single-use magic links.
- Seven-day HttpOnly, Secure, partitioned browser sessions.
- Per-address and per-source magic-link throttling.
- Customer-owned key listing, issuance, revocation, subscription Checkout, and quota display.
- Disabled-by-default Stripe subscription Checkout creation.
- Signed `customer.subscription.created`, `updated`, and `deleted` webhook processing.
- Price-to-plan mapping, bounded `past_due` grace periods, duplicate-event storage, and stale-event rejection.

No Stripe products, prices, customers, or subscriptions are created by repository code. Price IDs must already exist in the owner-controlled Stripe test account. No AWS resource is deployed automatically by merges.

`ApiAccessEnabled`, `CustomerAccountsEnabled`, and `SubscriptionBillingEnabled` default to `false`. SAM rules prevent customer accounts or subscription billing from being enabled outside `ApiAccessMode=test`.

## Customer session model

Magic-link secrets and session secrets are never stored in plaintext. Links place the one-time token in the URL fragment so it is not sent in the initial page request, server logs, or referrer headers. Verification atomically consumes the magic-link record and creates a server-side session.

The session cookie is `HttpOnly`, `Secure`, `SameSite=None`, and `Partitioned`. This allows the static site to call a test `execute-api.amazonaws.com` endpoint without exposing the session token to JavaScript, while partitioning the cookie to the SolveLang top-level site. Every customer mutation also requires an HMAC-derived CSRF token returned only to the authenticated page.

Magic-link requests are limited both by normalized email address and by the API Gateway `sourceIp`. The source limit uses a bounded DynamoDB counter per one-minute window, preventing an attacker from bypassing the email limit by varying recipients.

## Key delivery

A newly issued key is returned once with a ready-to-copy environment block:

```env
SOLVELANG_API_KEY=sl_test_<key-id>_<secret>
SOLVELANG_API_BASE=https://api.solve-lang.com/v1
```

The complete key must not be emailed, logged, placed in a URL, stored in Stripe metadata, committed to Git, or displayed again after initial issuance. Lost keys are replaced, not recovered.

## Plan limits

| Plan | Monthly requests | Active keys |
|---|---:|---:|
| Developer | 1,000 | 2 |
| Pro | 10,000 | 3 |
| Business | 50,000 | 5 |

Customer-facing prices remain owner-approved Stripe configuration and are intentionally not encoded in source control.

## Routes

Public and customer routes:

- `GET /health`
- `GET /v1/whoami` — Lambda-authorized API key required
- `POST /customer/auth/magic-link` — generic response; email and source throttles apply
- `POST /customer/auth/verify` — atomically consumes a one-time link and sets the session cookie
- `POST /customer/auth/logout` — authenticated session and CSRF required
- `GET /customer/account` — authenticated customer dashboard data
- `POST /customer/keys` — authenticated session and CSRF required; returns plaintext once
- `POST /customer/keys/revoke` — authenticated session and CSRF required
- `POST /customer/subscriptions/checkout` — authenticated session and CSRF required; billing flag must be enabled
- `POST /stripe/subscriptions/webhook` — verified Stripe signature required

Internal routes:

- `POST /internal/subscriptions/checkout` — admin secret required; billing flag must be enabled
- `POST /internal/subscriptions/provision` — admin secret required
- `POST /internal/keys` — admin secret required; returns plaintext once
- `POST /internal/keys/revoke` — admin secret required
- `POST /internal/usage/consume` — admin secret required

The browser never receives or submits the administrative secret. Customer ownership is derived from the authenticated server-side session rather than a request-body account ID.

## Stripe lifecycle contract

Checkout creates a fixed-price subscription with exactly one configured recurring Price. The subscription receives server-owned metadata:

- `accountId`
- normalized customer email
- plan name

The signed webhook maps the recurring Price ID back to a SolveLang plan. Subscription events are applied only when their deterministic lifecycle order is newer than the stored account lifecycle order, preventing delayed or equal-second webhooks from reverting newer state.

A `past_due` subscription receives a grace period based on the Stripe event timestamp. Deleted subscriptions become `canceled`. Unknown Price IDs, malformed metadata, multiple subscription items, invalid signatures, and unsupported statuses fail closed.

## Local tests

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

## Test deployment

The manual `Deploy API Access Test` GitHub Actions workflow supports staged deployment of the foundation, customer accounts, and Stripe test billing. It only runs from `main`, uses the protected `api-access-test` environment, and has no live or production option.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for required GitHub environment secrets, variables, AWS role boundaries, staged activation, and rollback steps.

## Deployment safety

Do not enable customer accounts or subscription billing until all of the following exist:

1. A verified SES sender and tested magic-link delivery.
2. Owner-created and verified Stripe test products and recurring Price IDs.
3. A verified Stripe-signed test webhook endpoint.
4. The site build variable `NEXT_PUBLIC_API_ACCESS_BASE_URL` points to the deployed test API.
5. Abuse monitoring, alarms, event-replay procedures, and operational runbooks.
6. Final API terms, privacy disclosures, tax treatment, and pricing approval.

Keep `ApiAccessMode=test` until subscription creation, plan changes, cancellation, failed renewal, grace-period expiry, out-of-order webhook delivery, duplicate delivery, magic-link replay, source throttling, key rotation, revocation, and quota exhaustion have been exercised end to end.
