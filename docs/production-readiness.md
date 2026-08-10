# SolveLang production readiness

Status: **preparation only — production remains disabled**.

This document defines the controls that must exist before SolveLang can move from the protected test release to a real production launch. It does not authorize a production deployment, live Stripe activation, or real customer charges.

## Environment isolation

Use a dedicated GitHub Environment named `api-access-production`. It must not reuse values from `api-access-test`.

Required production-only values:

- `AWS_ROLE_ARN`
- `AWS_REGION`
- `API_ACCESS_STACK_NAME` containing `prod` or `production`, never `test`
- `SITE_ORIGIN`
- `CUSTOMER_AUTH_EMAIL_SENDER`
- `CUSTOMER_AUTH_EMAIL_REPLY_TO` when used
- `API_KEY_PEPPER`
- `API_ACCESS_ADMIN_SECRET`
- `CUSTOMER_AUTH_PEPPER`
- `STRIPE_SECRET_KEY` beginning with `sk_live_`
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`
- three unique live recurring Stripe Price IDs for Developer, Pro, and Business

The production peppers and admin secret must all be distinct and must not equal their test-environment counterparts.

## Current hard safety boundary

The current `services/api-access/template.yaml` intentionally rejects customer accounts and subscription billing when `ApiAccessMode=live`. This remains a launch interlock.

The `Production Readiness Preflight` workflow may validate production configuration, live Stripe price metadata, SES identity, tests, and SAM build output. It contains no deployment command and must remain non-deploying until a separate owner-approved production deployment change is reviewed.

## Billing acceptance before launch

Before real charges are permitted, verify all of the following in live configuration without charging a customer where possible:

- Developer is $49/month.
- Pro is $199/month.
- Business is $699/month.
- All three prices are active, USD, monthly, recurring, and `livemode=true`.
- Production webhook uses an independent signing secret.
- Customer-visible business identity, invoice branding, receipt email behavior, statement descriptor, support contact, and cancellation disclosures are reviewed.
- Upgrade payment remains payment-authoritative.
- Failed payment does not grant an unpaid higher-tier entitlement.
- Downgrade/cancellation behavior is documented for customers.
- Refund policy is approved before launch.

## Reliability and recovery

Production launch is blocked until these controls are verified:

- CloudWatch alarms for API Lambda errors and throttles.
- Alerting for failed subscription webhook processing.
- Queue/DLQ alarms for any queue-backed production feature that is enabled.
- A documented feature-disable path for billing and customer accounts.
- DynamoDB point-in-time recovery for persistent production account data.
- A tested restoration procedure.
- Site rollback procedure.
- API CloudFormation rollback procedure.
- Billing configuration rollback/disable procedure.
- Log retention policy.
- Secret/token redaction review.

## Security review

Immediately before production launch:

- run the complete API tests, site CI, Rust tests, clippy, formatting, release build, and dependency/security audit;
- review IAM permissions for least privilege;
- verify CORS is restricted to the production SolveLang origin;
- review magic-link expiration and abuse throttles;
- verify CSRF protections on browser mutations;
- verify API-key scope and quota enforcement;
- verify webhook signature verification and duplicate-event handling;
- verify no plaintext API keys, session tokens, magic-link tokens, peppers, Stripe secrets, or full payment credentials are logged;
- document rotation for every production secret.

## Customer/legal launch blockers

Repository review did not identify approved production Terms of Service, Privacy Policy, or refund/cancellation policy content suitable to rely on for real customers. Production launch remains blocked until the business owner obtains and approves appropriate customer-facing terms and policies.

At minimum, the launch review must confirm:

- Terms of Service
- Privacy Policy
- refund policy
- cancellation and renewal disclosure
- billing frequency and plan-price disclosure
- support/contact method
- incident/payment-failure communication path

Do not generate or publish legal policy text solely from this checklist without appropriate owner/legal review.

## Go/no-go rule

Production is **NO-GO** if any item below is false:

1. Production GitHub Environment is isolated and protected.
2. Live Stripe resources are validated and independent from test.
3. Monitoring and recovery controls are operational.
4. Security review is green.
5. Customer/legal policies are approved and published.
6. Production launch runbook has been dry-run.
7. The owner explicitly approves enabling the production deployment path.
8. The owner explicitly approves the limited production canary.

Until then, the protected test environment remains the only enabled API billing environment.
