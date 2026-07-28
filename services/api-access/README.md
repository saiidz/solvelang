# SolveLang API Access

This service is the fail-closed foundation for recurring SolveLang API subscriptions.

## Current scope

- Subscription account records for `developer`, `pro`, and `business` plans.
- One-time API key issuance using `sl_test_*` and `sl_live_*` formats.
- HMAC-SHA-256 key fingerprints; plaintext secrets are never stored.
- Constant-time secret verification.
- Per-plan atomic active-key limits and key revocation.
- Lambda authorizer for `Authorization: Bearer $SOLVELANG_API_KEY`.
- Hard monthly request limits stored transactionally in DynamoDB.
- Idempotent usage consumption on every protected request.
- A protected `/v1/whoami` diagnostic endpoint.
- Disabled-by-default Stripe subscription Checkout creation.
- Signed `customer.subscription.created`, `updated`, and `deleted` webhook processing.
- Price-to-plan mapping, bounded `past_due` grace periods, duplicate-event storage, and stale-event rejection.

No Stripe products, prices, customers, or subscriptions are created by repository code. Price IDs must already exist in the owner-controlled Stripe test account. No AWS resource is deployed by this repository change.

`ApiAccessEnabled` and `SubscriptionBillingEnabled` both default to `false`. The SAM rules prevent subscription billing from being enabled outside `ApiAccessMode=test`.

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

- `GET /health`
- `GET /v1/whoami` — Lambda-authorized API key required
- `POST /stripe/subscriptions/webhook` — verified Stripe signature required
- `POST /internal/subscriptions/checkout` — admin secret required; billing flag must be enabled
- `POST /internal/subscriptions/provision` — admin secret required
- `POST /internal/keys` — admin secret required; returns plaintext once
- `POST /internal/keys/revoke` — admin secret required
- `POST /internal/usage/consume` — admin secret required

The internal routes are integration boundaries for a future authenticated customer dashboard. They are not intended for direct browser use.

## Stripe lifecycle contract

Checkout creates a fixed-price subscription with exactly one configured recurring Price. The subscription receives server-owned metadata:

- `accountId`
- normalized customer email
- plan name

The signed webhook maps the recurring Price ID back to a SolveLang plan. Subscription events are applied only when their Stripe event timestamp is equal to or newer than the stored account lifecycle timestamp, preventing delayed webhooks from reverting newer state.

A `past_due` subscription receives a grace period based on the Stripe event timestamp. Deleted subscriptions become `canceled`. Unknown Price IDs, malformed metadata, multiple subscription items, invalid signatures, and unsupported statuses fail closed.

## Local tests

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

## Deployment safety

Do not deploy with both API access and subscription billing enabled until all of the following exist:

1. Authenticated customer accounts or passwordless dashboard sessions.
2. Owner-created and verified Stripe test products and recurring Price IDs.
3. A verified Stripe-signed test webhook endpoint.
4. Customer ownership checks for key creation and revocation.
5. Abuse monitoring, alarms, event-replay procedures, and operational runbooks.
6. Final API terms, privacy disclosures, tax treatment, and pricing approval.

Keep `ApiAccessMode=test` until subscription creation, plan changes, cancellation, failed renewal, grace-period expiry, out-of-order webhook delivery, duplicate delivery, key rotation, revocation, and quota exhaustion have been exercised end to end.
