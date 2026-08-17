# Production private Admin gateway rollout

Status: **prepared for review; not deployed by this branch**.

## Prerequisites

- #158 static private-admin/gateway architecture merged.
- #163 validation-only private-admin preflight merged and passed from the then-current `main`.
- `api-access-production` remains protected by owner review.
- production API/customer accounts/Admin CRM remain enabled and subscription billing remains disabled.
- a private HTTPS `ADMIN_CONSOLE_ORIGIN` distinct from the public site has been provisioned.
- independent `ADMIN_CONSOLE_PASSWORD_SCRYPT` and `ADMIN_CONSOLE_SESSION_SECRET` secrets have been stored in the protected GitHub Environment.
- the reviewed `production-admin-gateway-deploy-supplemental-policy.json` has been applied to the production deploy role under a separate live-IAM approval.

## Deployment workflow

`Deploy Admin Console Gateway Production` is manual, main-only, protected, and serialized with other SolveLang production deployments. It:

1. confirms the live API/customer/CRM baseline with billing OFF using the read-only role;
2. runs gateway tests plus SAM validation/build;
3. assumes the deploy role only after validation;
4. deploys only stack `solvelang-api-access-production-admin-console`;
5. enables CloudFormation termination protection;
6. proves an unauthenticated `GET /session` returns the expected 401/CORS/no-store response;
7. re-checks Admin CRM=true and billing=false;
8. sends no email and performs no customer/CRM mutation or charge;
9. restores the prior gateway feature flag if post-deploy verification fails.

## IAM supplement

The supplemental policy grants only CloudFormation operations on the exact private-admin stack. Existing production deploy-role resource prefixes cover the SAM-generated Lambda/IAM/log/API Gateway resources; the supplement does not add KMS, SES, Stripe, customer-data, or general IAM authority.

## Static UI / ingress remains separate

This rollout deploys the server-side gateway only. The static admin bundle contains no privileged secret, but publishing it and configuring the private origin/SSO or Zero-Trust ingress remains a distinct operator action and deployment approval. Do not publish the admin bundle on the public customer origin merely to bypass private-ingress setup.
