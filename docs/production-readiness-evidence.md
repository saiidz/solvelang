# Production-readiness evidence

Prepared from protected test release commit `4f280ad7f80d9f37fcd50dd13c6a1ab410da0003`.

## Prepared in this phase

- separate production GitHub Environment contract: `api-access-production`;
- production stack naming boundary (`prod`/`production`, never `test`);
- production-only Stripe credential requirement: `sk_live_*` or least-privilege `rk_live_*`, with explicit `sk_test_*` and `rk_test_*` rejection;
- distinct pepper/admin-secret checks;
- live Stripe Price validation for exact monthly amounts without creating a charge;
- production SES sender validation;
- API tests + SAM validate/build in production preflight;
- regression test proving the preflight contains no `sam deploy` or payment/charge creation endpoint;
- production monitoring, recovery, rollback, and secret-rotation requirements;
- production go/no-go and phased canary runbook;
- explicit legal/customer-policy launch blocker.

## Intentionally not performed

- no production deployment workflow exists yet;
- no production webhook has been registered yet because no production API endpoint exists;
- no production AWS stack has been deployed;
- no production database/table has been created;
- no live payment or charge has been attempted;
- no current test-only live-mode interlock has been removed.

The owner may configure the protected `api-access-production` environment and live Stripe Products/Prices before the validation-only preflight. Those configuration steps do not deploy infrastructure or create a charge.

## Remaining owner/external blockers

The validation-only preflight requires isolated production environment values, a production AWS preflight role, a verified SES sender, an approved live Stripe credential (`sk_live_*` or least-privilege `rk_live_*`), and the three approved live recurring Price IDs.

Production deployment remains blocked until:

1. the production-readiness preflight passes without deployment or charges;
2. monitoring/PITR/rollback controls are implemented for the eventual production deployment;
3. appropriate Terms/Privacy/refund/cancellation/support materials are approved and published;
4. owner explicitly approves a separate production deployment PR;
5. the production foundation is deployed and its API/webhook endpoint exists;
6. the production Stripe subscription webhook is registered and its independent signing secret is saved/validated;
7. owner separately approves any real-charge billing canary.

This sequencing is deliberate: validate the production configuration first, create the webhook only after a real production endpoint exists, and keep billing disabled until webhook verification is complete.
