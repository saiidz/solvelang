# SolveLang Entitlement Service

Serverless Stripe Checkout, webhook verification, signed report entitlements, and privacy-safe conversion events for Workflow Preflight.

## Security model

- Stripe secret keys and webhook secrets exist only in Lambda environment variables.
- Checkout metadata contains only an opaque UUID scan ID and product identifier.
- Entitlements are signed with HMAC-SHA256, expire after 15 minutes, and are bound to both scan ID and PaymentIntent ID. The serialized `sessionId` field is retained for browser and stored-record compatibility, but its value must begin with `pi_`.
- Stripe payment status is re-read server-side before an entitlement is issued.
- Entitlement recovery also requires the matching signed-webhook record in DynamoDB.
- Webhook signatures are verified against the unmodified request body.
- Webhook replay and duplicate delivery use a conditional DynamoDB write and do not issue duplicate records.
- DynamoDB records use encryption at rest and 30-day TTL.
- No workflow JSON, workflow name, report finding, credential value, or filename is sent to this service.
- Conversion events accept only a fixed event-name allowlist.
- Client errors and structured logs use fixed codes and never serialize request bodies or caught exception details.

## Health endpoint

`GET /health` is unauthenticated and returns only this fixed readiness shape:

```json
{"status":"ok","service":"solvelang-entitlements","mode":"test"}
```

It does not emit configuration values, secrets, customer data, workflow data, resource identifiers, or exception details. The Lambda configuration rejects non-test Stripe secret keys, so this service remains test-mode-only during launch verification.

## Local validation

```bash
cd services/entitlements
npm ci
npm test
node ../../ops/launch/assert-entitlement-gates.mjs
sam validate --lint --template template.yaml
sam build --template template.yaml
```

## Deploy

Create a Stripe one-time Price for the Workflow Preflight report, then deploy:

```bash
sam deploy --guided \
  --template-file template.yaml \
  --parameter-overrides \
    SiteOrigin=https://www.solve-lang.com \
    StripeSecretKey=REDACTED \
    StripeWebhookSecret=REDACTED \
    StripePriceId=price_REDACTED \
    EntitlementSigningSecret=REDACTED_AT_LEAST_32_CHARACTERS
```

Register the stack output `WebhookUrl` in Stripe for `payment_intent.succeeded`. Set the static-site build variable to the `ApiBaseUrl` output:

```text
NEXT_PUBLIC_ENTITLEMENT_API_BASE=https://example.execute-api.us-east-1.amazonaws.com
```

Rebuild and deploy the static site after setting the variable. Do not place Stripe secrets in `NEXT_PUBLIC_*` variables, repository files, build logs, or GitHub Actions variables.

## Future production gates

The current implementation is intentionally restricted to Stripe test mode. Do not deploy it with live credentials or enable live payments.

1. Stripe account is activated and tax/business settings are reviewed.
2. A live-mode one-time Price exists.
3. Webhook endpoint is registered in live mode.
4. Lambda secrets are stored through a protected deployment path.
5. Test-mode end-to-end checkout passes before live mode.
6. Refund policy and privacy page are reviewed for the operating jurisdiction.
7. CloudWatch alarms cover Lambda errors, throttles, and elevated 4xx/5xx responses.
