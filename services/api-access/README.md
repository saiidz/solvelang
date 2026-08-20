# SolveLang API Access

This service is the fail-closed foundation for recurring SolveLang API subscriptions, weighted credit metering, capped hosted-AI output, and customer-managed API keys.

## Credit policy

One SolveLang credit covers up to:

- 5,000 input tokens
- 1,000 output tokens

The larger token dimension determines the charge. Every authenticated API request consumes at least one credit. Hosted OpenAI completions are capped at 1,000 output tokens per call.

Paid Express, Priority, and Critical processing are intentionally disabled. Non-standard priority values fail closed and cannot consume additional credits. The isolated queue-canary stack now implements real 1/2/5/10 worker lanes, but customers cannot access or pay for them until every activation gate in [PRIORITY_QUEUE.md](./PRIORITY_QUEUE.md) passes.

## Subscription plans

| Plan | Monthly credits | Active keys | Monthly price |
|---|---:|---:|---:|
| Developer | 1,000 | 2 | $49 |
| Pro | 10,000 | 3 | $199 |
| Business | 50,000 | 5 | $699 |

The protected test deployment verifies that configured Stripe Prices are active, test-mode, monthly USD Prices for the exact Product and amount advertised above.

## Security and billing scope

- One-time API key issuance using `sl_test_*` and `sl_live_*` formats.
- HMAC-SHA-256 key fingerprints; plaintext secrets are never stored.
- Constant-time API key, session, and CSRF verification.
- Atomic active-key limits and key revocation.
- Lambda authorizer for `Authorization: Bearer $SOLVELANG_API_KEY`.
- Atomic monthly credit limits stored transactionally in DynamoDB.
- Idempotent usage consumption on every protected request.
- Passwordless customer accounts using 15-minute, single-use magic links.
- Seven-day HttpOnly, Secure, partitioned browser sessions.
- Per-address and per-source magic-link throttling.
- Customer-owned key listing, issuance, revocation, subscription Checkout, and credit display.
- Disabled-by-default Stripe subscription Checkout creation.
- Signed subscription lifecycle webhook processing with replay claims and ordered projections; stale events do not trigger payment-method normalization.

No Stripe customers or subscriptions are created by repository code. No AWS resource is deployed automatically. `ApiAccessEnabled`, `CustomerAccountsEnabled`, and `SubscriptionBillingEnabled` default to `false`, and customer accounts and billing remain test-only.

## Customer session model

Magic-link and session secrets are never stored in plaintext. Links place the one-time token in the URL fragment. Verification atomically consumes the link and creates a server-side session.

The session cookie is `HttpOnly`, `Secure`, `SameSite=None`, and `Partitioned`. Every customer mutation also requires an HMAC-derived CSRF token.

## Key delivery

A newly issued key is returned once with a ready-to-copy environment block:

```env
SOLVELANG_API_KEY=sl_test_<key-id>_<secret>
SOLVELANG_API_BASE=https://api.solve-lang.com/v1
```

The complete key must not be emailed, logged, placed in a URL, stored in Stripe metadata, committed to Git, or displayed again after issuance.

## Routes

Customer and public routes:

- `GET /health`
- `GET /v1/whoami`
- `POST /customer/auth/magic-link`
- `POST /customer/auth/verify`
- `POST /customer/auth/logout`
- `GET /customer/account`
- `POST /customer/keys`
- `POST /customer/keys/revoke`
- `POST /customer/subscriptions/checkout`
- `POST /stripe/subscriptions/webhook`

Internal routes remain admin-secret protected. The browser never receives the administrative secret, and customer ownership is derived from the authenticated server-side session.

The standalone priority canary stack exposes a separate server-only admin API. It is not connected to customer sessions, API keys, Stripe, or the credit ledger.

## Local tests

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
sam validate --lint --template priority-template.yaml
sam build --template priority-template.yaml
```

## Test deployment

The manual `Deploy API Access Test` workflow supports staged foundation, customer-account, and Stripe test-billing deployment. It only runs from `main`, uses the protected `api-access-test` environment, validates the exact advertised Price amounts and Products, and has no live or production option.

The manual `Deploy Priority Queue Test` workflow independently supports disabled foundation and four-lane canary deployment. Canary success requires Standard, Express, Priority, and Critical jobs to complete through their own FIFO lanes and every dispatch/lane failure queue to remain empty.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for subscription environment configuration and [PRIORITY_QUEUE.md](./PRIORITY_QUEUE.md) for queue architecture, activation gates, and rollback.
