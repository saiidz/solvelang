# Production customer-account enablement

Status: **prepared only — not authorized or deployed by this document**.

This runbook covers the first production enablement of SolveLang API access and customer accounts while subscription billing remains disabled. Merging the implementation PR does not enable production access. The protected manual workflow must be invoked separately with explicit owner confirmation.

## Scope

The enablement changes only these production feature states:

- `API_ACCESS_MODE=live`
- `API_ACCESS_ENABLED=true`
- `CUSTOMER_ACCOUNTS_ENABLED=true`
- `SUBSCRIPTION_BILLING_ENABLED=false`

The workflow does not inject Stripe credentials, configure a Stripe webhook, create Stripe customers or subscriptions, or perform charges.

## Preconditions

Before invoking the deployment workflow, all of the following must already be true:

1. `Preflight API Access Production Customer Accounts` is green on `main`.
2. The production CloudFormation stack is stable.
3. The production customer page is compiled against the exact production API base.
4. `CUSTOMER_AUTH_PEPPER`, `API_KEY_PEPPER`, and `API_ACCESS_ADMIN_SECRET` exist and are independent.
5. `CUSTOMER_AUTH_EMAIL_SENDER` is verified in SES.
6. SES production sending access is enabled.
7. The monitored operations SNS subscription is confirmed.
8. Subscription billing remains disabled.

## Deployment workflow

Workflow: `Deploy API Access Production Customer Accounts`

The workflow is manual, main-only, and uses the protected `api-access-production` GitHub Environment. It requires both confirmation inputs to be true:

- `confirm_production_customer_accounts`
- `confirm_billing_remains_disabled`

Before assuming the production deploy role, it repeats the production stack, frontend-target, SES, test, SAM validation, and SAM build checks.

The deployment passes only the API-access, customer-auth, site-origin, and core secret parameters needed for customer accounts. No billing credential is supplied.

## Post-deploy verification

The workflow requires `/health` to report:

```json
{
  "status": "ok",
  "enabled": true,
  "customerAccountsEnabled": true,
  "subscriptionBillingEnabled": false
}
```

It also verifies that the subscription webhook remains disabled and returns `subscription_billing_disabled`.

If a post-deploy verification or operations-baseline step fails after the deployment succeeds, the workflow automatically attempts to restore:

```text
API_ACCESS_ENABLED=false
CUSTOMER_ACCOUNTS_ENABLED=false
SUBSCRIPTION_BILLING_ENABLED=false
```

CloudFormation rollback remains the first line of defense for deployment-time failures.

## Owner-controlled canary

The deployment workflow intentionally does not send a magic-link email. After a successful deployment, perform exactly one owner-controlled canary through the production browser page:

1. Open `https://www.solve-lang.com/account/api-keys/`.
2. Request a sign-in link for the approved owner canary mailbox.
3. Confirm exactly one email arrives from the configured SolveLang sender.
4. Open the single-use link and confirm the account dashboard loads.
5. Confirm no subscription is active and no billing action occurs.
6. Do not start checkout.
7. If a pre-provisioned or otherwise eligible plan is available for the canary, create one API key, copy it once, verify `/v1/whoami`, revoke the key, and verify the revoked key no longer authorizes. If no plan is available, do not fabricate an entitlement solely to test key creation; stop after account/session verification.
8. Sign out and confirm the session is no longer accepted.

Record the canary time, mailbox used, API base, result, and any rollback action. Never record the magic-link token, session cookie, CSRF token, API-key secret, pepper, or admin secret.

## Stop conditions

Immediately disable customer accounts and API access if any of the following occurs:

- health flags differ from the expected enabled/disabled state;
- the production browser targets another API environment;
- magic-link email delivery is duplicated or malformed;
- session or CSRF behavior is incorrect;
- a disabled billing route becomes available;
- secrets or tokens appear in logs;
- the production operations baseline cannot be verified.

## Billing boundary

This phase does not authorize subscription billing. `SubscriptionBillingRemainsTestOnly` remains in the SAM template. Billing requires a separate reviewed change, approved customer/legal materials, Stripe/webhook readiness, and separate explicit owner approval.
