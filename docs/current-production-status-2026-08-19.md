# SolveLang Current Production Status — 2026-08-19

This is the newest production-facing status record for SolveLang account/API/Admin infrastructure. It supersedes `docs/current-production-status-2026-08-13.md` for facts explicitly re-verified below. Items carried forward from the older record are labeled as such rather than silently re-audited.

## Product maturity

SolveLang remains an early beta / engineering prototype. A working production account/Admin foundation does not imply that general managed SolveLang workflow execution is live.

## Production state re-verified on 2026-08-19

The protected Admin Gateway deployment workflow re-verified the production account/API baseline before and after the Admin credential rotation:

- API access: **enabled**
- customer accounts: **enabled**
- Admin CRM backend: **enabled**
- subscription billing: **disabled**
- production API health: **passing**
- customer/CRM mutation by the deployment verification: **none**
- Stripe/webhook use by the deployment: **none**
- email sent by the deployment: **none**
- charges performed: **none**

The private Admin Gateway is deployed in `us-east-2` as stack `solvelang-api-access-production-admin-console` with termination protection enabled. Its reviewed base URL is:

`https://ru2uokfkge.execute-api.us-east-2.amazonaws.com/admin-gateway`

The successful password-rotation redeployment was GitHub Actions run `32217385656` on commit `04fddd0ee95b5624d640be9e7a354f75977a4502`. The workflow updated the existing Lambda without replacement and verified an unauthenticated gateway `/session` response remained `401`, `authenticated=false`, CORS-bound to the private Admin origin, and `Cache-Control: no-store`.

## Private Admin origin

`https://admin.solve-lang.com` is live behind Cloudflare Access and the reviewed Worker ingress.

Verified controls/results:

- Cloudflare Access intercepts unauthenticated requests before the Admin application is served;
- the Access application protects exactly `admin.solve-lang.com`;
- the owner Allow policy is scoped to the intended owner email identity;
- Access session duration is six hours;
- Worker `solvelang-admin-private-ingress` owns the custom domain;
- `workers.dev` remains disabled;
- `/admin-gateway/*` proxies to the exact reviewed Admin Gateway upstream;
- Cloudflare Access identity headers/cookie material are stripped before forwarding to AWS while the SolveLang host-bound Admin session cookie is preserved;
- gateway responses remain `no-store`;
- Admin static assets are allowlisted and served with `no-cache`, noindex, CSP, frame denial, nosniff, no-referrer, and restrictive permissions policy;
- unknown static paths fail closed rather than receiving an automatic SPA fallback.

The Admin static UI was published through the separately approved production publication stage. The initial publication exposed a fail-closed `admin_static_unavailable` condition caused by Cloudflare Static Assets HTML canonicalization. PR #324 fixed the publication config by setting `assets.html_handling` to `none` while preserving `run_worker_first: true`, the existing custom domain, Access, and gateway precedence.

## Admin authentication canary

The production Admin application password was rotated on 2026-08-19. Only its scrypt verifier is stored in the protected GitHub Environment and deployed to the gateway; the plaintext password is not stored in the repository or browser bundle.

Canary results after the rotation and gateway redeployment:

1. Cloudflare Access authentication passed.
2. Admin application password authentication passed.
3. The Admin CRM interface loaded through the private origin.
4. A read-only lookup of the owner account by email succeeded.
5. The account access state reported `active`.
6. Password authentication reported enabled.
7. Authenticator-app TOTP reported disabled.
8. CRM profile read succeeded without mutation.
9. No suspend/reactivate/terminate/profile-save/note/task mutation was part of the canary.

The Admin console exposes real production mutation controls, including account suspension/reactivation/termination and CRM writes. Their presence in the UI is not authorization to execute those mutations automatically.

## Customer authentication

Production username/email + password authentication remains enabled. Ordinary password login does not send email. Magic-link first-sign-in/recovery remains available from the prior verified account foundation.

The owner account read-only Admin lookup on 2026-08-19 confirmed password authentication is enabled and TOTP is disabled for that account.

## Production features still disabled / not authorized

The following remain OFF or unauthorized. No Admin rollout action changed these boundaries:

- authenticator-app TOTP production rollout: **not completed**
- dedicated production TOTP KMS rollout: **not performed in this Admin work**
- subscription billing: **disabled**
- production billing webhook path: **disabled by feature boundary**
- paid customer priority: **disabled**
- real charge authorization: **none**
- general managed hosted SolveLang workflow execution: **not live**
- Repository Audit write/remediation mode: **disabled**
- Server Audit mutation/remediation mode: **disabled**

The TOTP/KMS statements above carry forward the 2026-08-13 record because no TOTP/KMS production rollout was authorized or executed during the 2026-08-19 Admin work; they were not independently re-audited by the Admin deployment workflow.

## Protected production-sensitive backlog

Repository preparation may continue, but these protected PRs remain separately approval-gated and must not be auto-merged solely because CI is green:

- PR #161 — account/CRM rollback preservation; exact merge gate: `APPROVE PR #161 MERGE`
- PR #164 — validation-only production customer-priority preflight; exact merge gate: `APPROVE PR #164 MERGE`
- PR #169 — dormant production customer-priority foundation rollout; exact merge gate: `APPROVE PR #169 MERGE`

Their merge approvals do not authorize deployment, live IAM/KMS changes, provider activation, billing, email, charges/refunds, or production customer/CRM mutation.

## Truthfulness rule

Repository and product documentation must continue to distinguish:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically production-enabled, and production account/Admin infrastructure is not evidence that general managed workflow execution is live.
