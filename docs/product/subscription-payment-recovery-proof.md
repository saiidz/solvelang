# Subscription payment failure and recovery proof

This repository proof exercises the existing subscription lifecycle boundary without enabling billing or touching Stripe production.

It verifies two safety properties using the real API-access subscription provisioning logic:

- a newer `active` subscription lifecycle event replaces a previously accepted `past_due` state and removes the bounded grace-period marker;
- a delayed older `past_due` event cannot overwrite a newer recovered `active` state because subscription event ordering remains authoritative.

This complements the existing subscription-management coverage for upgrade, downgrade, cancellation/resume, and payment-method changes, plus the checkout ownership and webhook replay proofs.

The proof uses deterministic local fixtures only. It does not enable subscription billing, register or mutate a Stripe webhook, create a Checkout Session, call Stripe, charge or refund a customer, deploy production code, mutate a production account, or authorize any live billing action.

A real production billing canary still requires the separately protected Stripe configuration/webhook verification, approved customer-facing billing/refund/cancellation/support disclosures, monitoring and rollback readiness, and fresh owner authorization for the exact live action.
