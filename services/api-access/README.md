# SolveLang API Access

This service is the fail-closed foundation for recurring SolveLang API subscriptions.

## Current scope

- Subscription account records for `developer`, `pro`, and `business` plans.
- One-time API key issuance using `sl_test_*` and `sl_live_*` formats.
- HMAC-SHA-256 key fingerprints; plaintext secrets are never stored.
- Constant-time secret verification.
- Per-plan active-key limits and key revocation.
- Lambda authorizer for `Authorization: Bearer $SOLVELANG_API_KEY`.
- Hard monthly request limits stored transactionally in DynamoDB.
- Idempotent usage consumption.
- A protected `/v1/whoami` diagnostic endpoint.

This service does **not** create Stripe products, accept subscription checkout, or deploy itself in this phase. `ApiAccessEnabled` defaults to `false`.

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

Prices are intentionally not encoded in this service. Stripe price IDs and customer-facing prices belong in the future billing integration and owner-approved configuration.

## Routes

- `GET /health`
- `GET /v1/whoami` — Lambda-authorized API key required
- `POST /internal/subscriptions/provision` — admin secret required
- `POST /internal/keys` — admin secret required; returns plaintext once
- `POST /internal/keys/revoke` — admin secret required
- `POST /internal/usage/consume` — admin secret required

The internal routes are integration boundaries for a future verified Stripe webhook and authenticated customer dashboard. They are not intended for browser use.

## Local tests

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

## Deployment safety

Do not deploy with `ApiAccessEnabled=true` until all of the following exist:

1. Authenticated customer accounts or passwordless dashboard sessions.
2. Verified Stripe subscription products and recurring prices.
3. Signed Stripe webhook lifecycle processing.
4. Customer ownership checks for key creation and revocation.
5. Abuse monitoring, alarms, and operational runbooks.
6. Final API terms, privacy disclosures, and pricing approval.

Keep `ApiAccessMode=test` until test subscriptions, cancellation, failed renewal, grace-period expiry, rotation, revocation, and quota exhaustion have been exercised end to end.
