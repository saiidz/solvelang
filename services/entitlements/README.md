# SolveLang Entitlement Service

Serverless Stripe PaymentIntent creation, webhook verification, signed report entitlements, and privacy-safe conversion events for Workflow Preflight.

## Security model

- Stripe secret keys and webhook secrets exist only in Lambda environment variables.
- PaymentIntent metadata contains only an opaque UUID scan ID, product identifier, accepted Terms version, and server-generated acceptance timestamp.
- Entitlements are signed with HMAC-SHA256, expire after 15 minutes, and are bound to both scan ID and PaymentIntent ID. The serialized `sessionId` field is retained for browser and stored-record compatibility, but its value must begin with `pi_`.
- Stripe payment status is re-read server-side before an entitlement is issued.
- The latest Charge refund state is expanded and re-read before every entitlement. A full refund denies renewal; a partial refund remains eligible.
- Entitlement recovery also requires the matching signed-webhook record in DynamoDB.
- Webhook signatures are verified against the unmodified request body.
- Webhook replay and duplicate delivery use conditional DynamoDB writes and idempotent refund-state updates.
- DynamoDB records use encryption at rest and 30-day TTL.
- No workflow JSON, workflow name, report finding, credential value, or filename is sent to this service.
- Conversion events accept only a fixed event-name allowlist.
- Client errors and structured logs use fixed codes and never serialize request bodies or caught exception details.
- `CHECKOUT_ENABLED` defaults to `false`; when disabled, `POST /checkout` returns a fixed HTTP 503 before parsing the request or calling Stripe.
- Checkout accepts a Cloudflare Turnstile token only after the checkout page renders the configured widget. The Lambda verifies it server-side with `TURNSTILE_SECRET_KEY`, the API Gateway client IP, the expected `SITE_ORIGIN` hostname, and the exact `checkout` action before it creates a PaymentIntent. Verification rejection, malformed responses, and provider unavailability never create a PaymentIntent.
- Checkout requires `termsAccepted: true` and the supported terms version before Turnstile verification. It never stores the checkbox text, Turnstile token, IP address, user agent, workflow content, or secrets in PaymentIntent metadata.
- Checkout creates the PaymentIntent with stable scan and terms metadata under `preflight-${scanId}`, then records the server-derived Stripe creation time as `termsAcceptedAt` with a separate stable consent-update idempotency key before returning the client secret. Retries therefore recover the same intent without changing Stripe parameters.
- A signed `payment_intent.succeeded` webhook uses one DynamoDB transaction to create both the paid entitlement and an encrypted, 30-day-TTL contract-confirmation outbox record. A crash before commit creates neither; a crash after commit leaves a durable handoff for the DynamoDB Streams dispatcher. Browser recovery reads only the paid entitlement and never queues customer email.
- The dispatcher sends pending outbox records to the encrypted FIFO SQS queue and marks them dispatched only after SQS accepts them. A queue outage or ambiguous response leaves the outbox pending for safe replay; duplicate Stripe events and different event IDs for the same PaymentIntent use the same logical outbox key.
- The SES worker has a recoverable delivery lease. `sent` records suppress duplicates, active leases fail back to SQS for retry, and expired leases are atomically reclaimed. SES has no application idempotency key: if SES accepts a message but recording `sent` fails, a later lease recovery may send one duplicate rather than lose the required notice. Delivery records retain only privacy-safe audit fields for 30 days.
- `disabled`, `test-sink`, and `aws-ses-sqs` are the only durable confirmation providers. Test mode uses the privacy-safe in-memory sink; production rejects it and requires the encrypted FIFO SQS queue, DLQ, SES worker, and a verified sender before checkout can be enabled.
- Withdrawal requests require a distinct `withdrawal` Turnstile action, exact hostname verification, a five-second fail-closed provider timeout, a short per-container rate limit, a UUID retry identifier, and a matching Workflow Preflight PaymentIntent receipt email. Unverifiable references receive only a support-review response.
- The withdrawal route also consumes an encrypted DynamoDB rate-limit counter keyed by a domain-separated HMAC pseudonym of source IP and a 15-minute window. No raw IP or enumerable plain IP hash is stored. SQS and Lambda delivery are at-least-once; the worker processes one message at a time and malformed messages fail for retry/DLQ handling.

## Health endpoint

`GET /health` is unauthenticated and returns only this fixed readiness shape:

```json
{"status":"ok","service":"solvelang-entitlements","mode":"test"}
```

It does not emit configuration values, secrets, customer data, workflow data, resource identifiers, or exception details. Production returns the same shape with `mode` set to `production`. Configuration rejects keys whose mode does not match `ENTITLEMENT_MODE`.

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

Deploy with an explicit mode. Test checkout is enabled by the protected deployment workflow. For production, `CheckoutEnabled` defaults to `false` and must remain disabled until a real Stripe webhook secret is installed and a Stripe-signed delivery has returned HTTP 200. The backend creates a fixed $49 USD card-only PaymentIntent only when checkout is explicitly enabled:

```bash
sam deploy --guided \
  --template-file template.yaml \
  --parameter-overrides \
    SiteOrigin=https://www.solve-lang.com \
    EntitlementMode=test \
    CheckoutEnabled=true \
    LegalCheckoutReviewVerified=true \
    StripeSecretKey=REDACTED \
    StripeWebhookSecret=REDACTED \
    TurnstileSecretKey=REDACTED \
    EntitlementSigningSecret=REDACTED_AT_LEAST_32_CHARACTERS
```

Register the stack output `WebhookUrl` in the matching Stripe mode for exactly `payment_intent.succeeded` and `charge.refunded`. Set the static-site build variable to the `ApiBaseUrl` output:

```text
NEXT_PUBLIC_ENTITLEMENT_API_BASE=https://example.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=REDACTED_PUBLIC_SITE_KEY
```

Rebuild and deploy the static site after setting the variables. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is a public Turnstile site key; do not place Stripe or Turnstile secret values in `NEXT_PUBLIC_*` variables, repository files, build logs, or GitHub Actions variables.

Follow [the owner launch runbook](../../docs/launch-owner-runbook.md) for isolated test and production setup, live webhook registration, one low-risk payment/refund verification, privacy review, and rollback.
