# SolveLang production launch runbook

Status: **drafted for future use; not authorization to launch**.

This runbook begins only after the protected test release is healthy and the production-readiness checklist is complete.

**Current-state note (2026-09-22):** Phases 0–4 preserve the historical initial
deployment sequence; their billing-off expectations are not current production
state. Production API subscription billing is enabled for controlled rollout.
Use [`production-readiness.md`](production-readiness.md) for current facts and
the protected maintenance procedure for code changes. Phase 5 below is a
prepared payment canary and still requires separate explicit owner approval.

## Phase 0 — prerequisites for validation-only preflight

Stop immediately if any prerequisite is missing:

- `main` CI is green.
- Rust workflow is green.
- API Access CI is green for the production-readiness change set.
- `api-access-production` GitHub Environment exists and requires manual approval.
- Production AWS role is separate from test deployment credentials.
- Production stack name contains `prod` or `production` and does not contain `test`.
- Production peppers/admin secret are independent from test.
- SES production sender is verified.
- Approved live Stripe Products/Prices exist and are independently configured.
- Stripe credential is live-only: either `sk_live_*` or a least-privilege `rk_live_*` key with permission to read the required live Price objects. Test keys are rejected.

A production webhook is **not** required for Phase 1 because no production API endpoint exists yet.

## Phase 1 — validation only

Run **Production Readiness Preflight** from `main`.

Expected result:

- production environment values resolve;
- stack naming boundary passes;
- `sk_live_*` or `rk_live_*` is accepted; `sk_test_*` and `rk_test_*` are rejected;
- live recurring Stripe prices validate at $49 / $199 / $699 monthly;
- SES sender is verified;
- API tests pass;
- SAM validate/build pass;
- no deployment occurs;
- no charge occurs;
- current SAM template still blocks live customer accounts and live subscription billing.

Any failure is a **NO-GO**.

## Phase 2 — production deployment change review

Only after Phase 1 is green, prepare a separate pull request that introduces the production deployment path.

Before that deployment PR can enable customer accounts or billing, the following additional prerequisites must be complete:

- production monitoring, alarms, backup/PITR, rollback, and incident contacts are ready;
- customer Terms, Privacy, refund/cancellation policy, billing disclosure, and support path are approved and published;
- owner explicitly authorizes moving from readiness to production deployment.

That PR must:

- preserve the existing `Deploy API Access Test` workflow unchanged in behavior;
- use only `api-access-production`;
- require `main`;
- require an explicit production confirmation input;
- require GitHub Environment approval;
- reject all Stripe test credentials and accept only an approved live `sk_live_*` or least-privilege `rk_live_*` credential;
- reject stack names containing `test`;
- deploy only the production stack;
- verify health and exact enabled feature flags after deployment;
- include a rollback command/path;
- never print secrets or full payment credentials;
- have regression tests proving all of the above.

Do not merge that PR without explicit owner approval.

## Phase 3 — foundation canary

First production deployment should enable only the minimum foundation needed to verify infrastructure. Customer accounts and subscription billing remain disabled.

Verify:

- `/health` is reachable;
- mode and feature flags match the intended production foundation state;
- logs arrive without secrets;
- alarms are connected;
- rollback is proven;
- no customer-facing billing path is active.

After the production API base URL exists, register the production Stripe subscription webhook against that endpoint and save its independent signing secret in `api-access-production`. Do not enable billing until the webhook endpoint and signing-secret validation are complete.

Failure => rollback and **NO-GO**.

## Phase 4 — customer accounts

Enable customer accounts only after foundation acceptance.

Verify with a controlled owner account:

- magic-link delivery;
- single-use/replay rejection;
- session behavior;
- CSRF enforcement;
- CORS origin restriction;
- source/email throttling;
- API-key issue/revoke;
- one-time key reveal;
- quota state;
- logout/session revocation.

No public promotion yet.

## Phase 5 — billing canary

Requires a second explicit owner approval because this phase can create a real charge.

### Prepared bounded scenario

This plan prepares one successful initial subscription payment; it is not
authorization to charge or refund.

- **Amount and plan:** one Developer subscription at **USD $49.00 total** for
  one monthly period. Before payment, the authenticated checkout summary must
  show exactly USD $49.00 with no additional tax or fee. If the amount differs,
  stop and obtain approval for the exact revised total.
- **Account and data:** one new, owner-controlled disposable SolveLang account
  using a synthetic email address and no existing customer records, projects,
  API keys, or customer source. Use no other person's payment method or data.
- **Expected provider events:** one completed Checkout Session; a paid initial
  invoice (`invoice.paid`); and the corresponding
  `customer.subscription.created` or `customer.subscription.updated` event.
  The subscription event must identify the disposable account and Developer
  Price. An initial `incomplete` status may become `active` only after payment.
  The application processes the signed `customer.subscription.*` events for
  entitlement state; `checkout.session.completed` and `invoice.paid` are
  supporting payment evidence, not entitlement writes.
- **Expected SolveLang transition:** the disposable account moves from no active
  subscription to Developer / `active` only after the successful payment and
  matching signed subscription event. Verify the Developer limits of 1,000
  monthly credits, two active API keys and `repository:audit` scope. No other
  account or plan changes.
- **Cancellation:** after recording the accepted result, set cancellation at
  period end through the authenticated account subscription controls. Verify
  `cancel_at_period_end`, then verify the final cancellation event and access
  removal at period end. This does not refund the initial payment. Immediate
  cancellation or a refund is a separate owner-approved Stripe action.
- **Failure response:** if amount, identity, event ordering, payment or
  entitlement differs from this plan, stop the canary and do not start another
  checkout. Preserve webhook delivery for reconciliation; do not edit
  entitlement records or retry an ambiguous provider outcome. Use the reviewed
  state-preserving production maintenance/rollback procedure under its own
  authorization. Do not run the legacy billing-off customer-account workflow.
- **Evidence:** in a restricted owner-controlled record, retain the approval,
  timestamp, checkout/invoice/subscription outcome, amount and currency,
  sanitized event types/statuses, entitlement before/after, cancellation state,
  alarms and final disposition. Keep credentials, payment details, raw customer
  data and full provider payloads out of GitHub and chat.

Before the canary, also verify the live Price and webhook identity, deployed
#911 alarm destination/actions/state, approved customer disclosures and support
path, current exact-head checks, and a usable rollback contact. Any failed or
unknown precondition is a no-go.

### Acceptance checks

For this one-payment canary, verify:

- the Checkout Session and initial paid invoice belong to the disposable account;
- exactly one Developer entitlement becomes active after the successful payment
  and matching signed subscription event;
- event replay does not duplicate or reorder the account entitlement;
- the expected alarms remain healthy and the rollback contact is reachable; and
- cancellation-at-period-end is recorded so no later renewal is intended.

Plan changes, payment-method replacement, failed-payment recovery and refunds are
separate lifecycle cases. Use the repository tests and approved non-production
provider validation for those cases; do not add charges to this bounded live
canary. Record the approved amount, invoice outcome, cancellation, and final
disposition outside source code without storing payment credentials.

## Phase 6 — post-canary decision

GO only if:

- no unresolved security or billing defects exist;
- alarms and logs are clean;
- backup/restore and rollback paths are documented and usable;
- support path is staffed/owned;
- customer policies match actual behavior;
- owner explicitly approves broader production availability.

Otherwise remain limited or roll back.

## Emergency disable order

If a production billing incident occurs:

1. disable new checkout/subscription creation;
2. disable plan-change mutations if entitlement correctness is uncertain;
3. preserve webhook ingestion if safe so Stripe state can still reconcile;
4. disable API access only if authorization/quota correctness is compromised;
5. communicate customer impact through the approved support/status path;
6. roll back application/infrastructure changes as appropriate;
7. never delete billing/account data as an incident-response shortcut.

Before any re-enable decision, the accountable owner must record the incident decision and a separately authorized operator must retain post-disable evidence that new checkout and plan-change mutations are blocked, along with the resulting health and feature-flag state. Do not re-enable a mutation path solely because an alert stops firing; require an owner-recorded decision after the reconciled customer, invoice, and subscription state is verified.

## Evidence to retain

For every production launch/canary, retain:

- approved commit SHA;
- workflow run URL/ID;
- environment approval record;
- deployed stack name/region;
- health verification result;
- alarm/monitoring verification;
- Stripe webhook configuration confirmation;
- canary outcome;
- rollback test/outcome;
- owner go/no-go decision.
