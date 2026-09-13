# Subscription checkout ownership proof

The customer subscription checkout route binds billing identity to authenticated server-side account state before it reaches the Stripe checkout service.

Repository regression coverage proves that a customer request cannot override:

- the authenticated SolveLang account ID;
- the authenticated account email used for a new Stripe customer;
- an existing Stripe customer ID already stored on the SolveLang account.

The request body remains authoritative only for the intended customer choices that are safe to accept at this boundary: the requested plan and the checkout request/idempotency identifier. A caller-supplied `accountId`, `email`, or `customerId` is ignored by the customer route.

If the SolveLang account has no stored Stripe customer ID, a caller cannot inject one; checkout receives no customer ID and the embedded checkout gateway uses the authenticated account email instead.

This is repository-only qualification. It does not enable subscription billing, register or modify a Stripe webhook, create a live Checkout Session, charge or refund a customer, deploy production code, or authorize any production billing action.
