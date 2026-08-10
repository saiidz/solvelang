# Production-readiness evidence

Prepared from protected test release commit `4f280ad7f80d9f37fcd50dd13c6a1ab410da0003`.

## Prepared in this phase

- separate production GitHub Environment contract: `api-access-production`;
- production stack naming boundary (`prod`/`production`, never `test`);
- production-only `sk_live_*` requirement and explicit `sk_test_*` rejection;
- distinct pepper/admin-secret checks;
- live Stripe Price validation for exact monthly amounts without creating a charge;
- production SES sender validation;
- API tests + SAM validate/build in production preflight;
- regression test proving the preflight contains no `sam deploy` or payment/charge creation endpoint;
- production monitoring, recovery, rollback, and secret-rotation requirements;
- production go/no-go and phased canary runbook;
- explicit legal/customer-policy launch blocker.

## Intentionally not performed

- no production GitHub Environment values were created by code;
- no live Stripe Products or Prices were created;
- no live webhook was registered;
- no production AWS stack was deployed;
- no production database/table was created;
- no live payment or charge was attempted;
- no current test-only live-mode interlock was removed.

## Remaining owner/external blockers

The production preflight is expected to remain unrunnable until the owner configures the protected `api-access-production` environment and approved live external resources.

Production deployment remains blocked until:

1. production environment/secrets are created and isolated;
2. approved live Stripe Products/Prices/webhook exist;
3. production monitoring/PITR controls are implemented in the eventual production deployment change;
4. appropriate Terms/Privacy/refund/cancellation/support materials are approved and published;
5. production preflight passes;
6. owner explicitly approves a separate production deployment PR;
7. owner separately approves any real-charge canary.

This is deliberate: readiness code may be merged safely without creating a path that can accidentally deploy or charge.
