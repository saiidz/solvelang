# SolveLang production launch runbook

Status: **drafted for future use; not authorization to launch**.

This runbook begins only after the protected test release is healthy and the production-readiness checklist is complete.

## Phase 0 — prerequisites

Stop immediately if any prerequisite is missing:

- `main` CI is green.
- Rust workflow is green.
- API Access CI is green for the production-readiness change set.
- `api-access-production` GitHub Environment exists and requires manual approval.
- Production AWS role is separate from test deployment credentials.
- Production stack name contains `prod` or `production` and does not contain `test`.
- Production peppers/admin secret are independent from test.
- SES production sender is verified.
- Live Stripe Products/Prices and production webhook are approved and independently configured.
- Monitoring, alarms, backup/PITR, rollback, and incident contacts are ready.
- Customer Terms, Privacy, refund/cancellation policy, billing disclosure, and support path are approved and published.
- Owner has explicitly authorized moving from readiness to production deployment.

## Phase 1 — validation only

Run **Production Readiness Preflight** from `main`.

Expected result:

- production environment values resolve;
- stack naming boundary passes;
- `sk_live_*` is required and `sk_test_*` is rejected;
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

That PR must:

- preserve the existing `Deploy API Access Test` workflow unchanged in behavior;
- use only `api-access-production`;
- require `main`;
- require an explicit production confirmation input;
- require GitHub Environment approval;
- reject `sk_test_*` and require `sk_live_*`;
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

Use the smallest controlled canary practical for the approved business policy. Verify:

- subscription creation;
- invoice/receipt and business identity;
- entitlement activation only after successful payment;
- plan change behavior;
- payment-method management;
- cancellation/resume;
- webhook duplicate safety;
- failed-payment handling;
- monitoring and rollback.

If a real charge is made for the canary, record the approved customer/account, amount, invoice, expected refund treatment, and final disposition outside source code without storing payment credentials.

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
