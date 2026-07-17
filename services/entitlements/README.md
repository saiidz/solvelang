# SolveLang Entitlement Service

Serverless Stripe Checkout, webhook verification, signed report entitlements, and privacy-safe conversion events for Workflow Preflight.

## Security model

- Stripe secret keys and webhook secrets exist only in Lambda environment variables.
- Checkout metadata contains only an opaque UUID scan ID and product identifier.
- Entitlements are signed with HMAC-SHA256, expire after 15 minutes, and are bound to both scan ID and Checkout Session ID.
- Stripe payment status is re-read server-side before an entitlement is issued.
- Webhook signatures are verified against the unmodified request body.
- DynamoDB records use encryption at rest and 30-day TTL.
- No workflow JSON, workflow name, report finding, credential value, or filename is sent to this service.
- Conversion events accept only a fixed event-name allowlist.

## Local validation

```bash
cd services/entitlements
npm install
npm test
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

Register the stack output `WebhookUrl` in Stripe for `checkout.session.completed`. Set the static-site build variable to the `ApiBaseUrl` output:

```text
NEXT_PUBLIC_ENTITLEMENT_API_BASE=https://example.execute-api.us-east-1.amazonaws.com
```

Rebuild and deploy the static site after setting the variable. Do not place Stripe secrets in `NEXT_PUBLIC_*` variables, repository files, build logs, or GitHub Actions variables.

## Production gates

1. Stripe account is activated and tax/business settings are reviewed.
2. A live-mode one-time Price exists.
3. Webhook endpoint is registered in live mode.
4. Lambda secrets are stored through a protected deployment path.
5. Test-mode end-to-end checkout passes before live mode.
6. Refund policy and privacy page are reviewed for the operating jurisdiction.
7. CloudWatch alarms cover Lambda errors, throttles, and elevated 4xx/5xx responses.
