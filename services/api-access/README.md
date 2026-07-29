# SolveLang API Access

This service is the fail-closed foundation for recurring SolveLang API subscriptions, weighted credit metering, paid processing priority, and customer-managed API keys.

## Credit policy

A base SolveLang credit covers up to:

- 5,000 input tokens
- 1,000 output tokens

The larger token dimension determines the base charge. Every authenticated API request consumes at least one credit. Hosted OpenAI completions are capped at 1,000 output tokens per call.

Processing priority multiplies both queue weight and charged credits:

| Priority | Credit multiplier | Queue weight |
|---|---:|---:|
| Standard | 1x | 1 |
| Express | 2x | 2 |
| Priority | 5x | 5 |
| Critical | 10x | 10 |

Priority is best-effort queue ordering, not a guaranteed completion-time SLA. A workload with 50,000 input tokens and 2,000 total output tokens has a 10-credit base charge. Critical processing charges 100 credits.

## Subscription plans

| Plan | Monthly credits | Active keys | Monthly price target |
|---|---:|---:|---:|
| Developer | 1,000 | 2 | $49 |
| Pro | 10,000 | 3 | $199 |
| Business | 50,000 | 5 | $699 |

Stripe Price IDs remain owner-controlled test configuration and are not encoded into source control.

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
- Signed subscription lifecycle webhook processing.

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

Internal routes require the administrative secret:

- `POST /internal/subscriptions/checkout`
- `POST /internal/subscriptions/provision`
- `POST /internal/keys`
- `POST /internal/keys/revoke`
- `POST /internal/usage/consume`

The internal usage route accepts either a fixed `credits` amount or a server-calculated workload object containing `inputTokens`, `outputTokens`, and `priority`. Browser clients never calculate their own billable credit charge.

## Test deployment

The manual `Deploy API Access Test` workflow supports staged deployment of the foundation, customer accounts, and Stripe test billing. It runs only from `main`, uses the protected `api-access-test` environment, and has no production option.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for required secrets, variables, AWS role boundaries, staged activation, and rollback.

## Local tests

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

Keep test mode enabled until weighted credit exhaustion, priority multipliers, large-input charging, output caps, subscription lifecycle, magic-link replay, source throttling, key rotation, and revocation have been exercised end to end.
