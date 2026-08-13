# Production password-auth rollout

Status: **preflight prepared only — password authentication is merged but not authorized for production deployment by this document**.

This runbook covers the in-place rollout of username/email + password authentication to the already-live SolveLang production API/customer-account stack.

## Current production baseline

Before this rollout begins, production is expected to remain:

- `API_ACCESS_MODE=live`
- `API_ACCESS_ENABLED=true`
- `CUSTOMER_ACCOUNTS_ENABLED=true`
- `SUBSCRIPTION_BILLING_ENABLED=false`

The existing magic-link login remains the production fallback/recovery path until the password-auth deployment is separately approved and verified.

## Preflight workflow

Workflow: `Preflight API Access Production Password Auth`

The workflow is manual, main-only, protected by the `api-access-production` GitHub Environment, and validation-only. It requires `confirm_password_auth_preflight=true`.

It validates:

1. the checked-out commit exactly matches `GITHUB_SHA` on `main`;
2. the production CloudFormation stack is stable;
3. API access and customer accounts are already enabled;
4. subscription billing remains disabled;
5. `/health` reports API=true, customerAccounts=true, billing=false;
6. the deployed customer page still targets the exact production API base;
7. independent production auth secrets remain configured;
8. the SES sender remains verified and SES production sending access remains enabled;
9. the full API-access test suite passes;
10. the SAM template validates and builds;
11. the candidate template contains `/customer/auth/password` and `/customer/auth/credentials`;
12. scrypt password hashing and auth-version session revocation are present;
13. the existing production deployment workflow still preserves attempt-aware serialization, exact pre-deploy feature-state rollback, and billing=false;
14. the production deployment workflow does not inject Stripe subscription secrets.

The preflight does **not** run `sam deploy`, send a magic-link email, use a Stripe webhook, enable subscription billing, or perform charges.

## Deployment boundary

Passing the preflight is readiness evidence only. Production deployment requires a separate explicit owner approval.

The existing `Deploy API Access Production Customer Accounts` workflow can perform the in-place backend update because it supports an already-enabled API/customer-account stack, captures the exact current feature state, keeps `SUBSCRIPTION_BILLING_ENABLED=false`, and restores the captured API/customer-account state if post-deploy verification fails.

Do not dispatch that deployment from this runbook without separate authorization.

## Frontend boundary

The password-auth UI is part of the customer account page. After the backend deployment, verify the production static site is serving the intended reviewed commit and that its compiled bundle still targets the exact production API base. If the hosting platform does not automatically publish the reviewed `main` commit, use the existing separately controlled site deployment process.

Do not expose password login in production against an API deployment that lacks the password routes.

## Owner-controlled password-auth canary

After both backend and frontend are confirmed on the reviewed production version:

1. Open `https://www.solve-lang.com/account/api-keys/`.
2. Use the existing magic-link flow for the approved owner mailbox.
3. Confirm the dashboard loads and subscription billing remains unavailable.
4. Choose a unique username and a strong password in the authenticated security section.
5. Sign out.
6. Record the mailbox email count, then sign in with the username or email plus password.
7. Confirm password login succeeds and sends **no additional sign-in email**.
8. Confirm the account dashboard still shows the same account and API-key ownership.
9. Do not start checkout and do not fabricate a subscription solely for the canary.
10. Sign out and confirm the password-created session is no longer accepted.

For recovery testing, use a separately approved magic-link recovery canary. Password replacement must invalidate older sessions and older unused magic links; the automated suite already covers that behavior and production recovery testing must not create extra email without approval.

## Stop conditions

Stop the rollout if any of the following occurs:

- production health differs from API=true, customerAccounts=true, billing=false;
- the production customer page points at a different API base;
- password endpoints are missing after backend deployment;
- password login sends an unexpected email;
- old sessions remain valid after a password change;
- a stale pre-reset magic link remains usable;
- CSRF/session behavior changes unexpectedly;
- subscription checkout or billing becomes available;
- secrets, password values, tokens, cookies, or password hashes appear in logs;
- production rollback/operations verification cannot be completed.

## Billing boundary

This rollout does not authorize subscription billing. Stripe subscription credentials, subscription webhooks, and charges remain disabled until a separate billing review and explicit owner approval.
