# SolveLang Payment Launch Runbook

This is the owner-only sequence for moving Workflow Preflight from the verified Stripe sandbox to production. Repository checks do not deploy AWS, change GitHub or Amplify configuration, create Stripe resources, or make live charges.

## Required protected configuration

Create separate protected GitHub environments named `entitlement-test` and `entitlement-production`. Give each a required reviewer and restrict deployments to `main`.

Environment variables:

- `AWS_REGION`
- `SITE_ORIGIN`
- `ENTITLEMENT_STACK_NAME` (a different stack name in each environment)

Environment secrets:

- `AWS_ROLE_ARN` (scoped to the matching stack/environment)
- `STRIPE_SECRET_KEY` (`sk_test_...` in test; `sk_live_...` in production)
- `STRIPE_WEBHOOK_SECRET` (from the matching Stripe mode and destination)
- `ENTITLEMENT_SIGNING_SECRET` (at least 32 random bytes and different in each environment)

The workflow derives `ENTITLEMENT_MODE` from the selected protected environment. The backend creates a fixed USD 49 PaymentIntent directly; no separate product-price identifier is required.

Amplify public build variables:

- `NEXT_PUBLIC_ENTITLEMENT_API_BASE` (production API output for the live site)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_...` for production)

Never put secret or webhook-signing keys in `NEXT_PUBLIC_*`, repository variables, logs, screenshots, issues, or command output.

## 1. Verify the test sandbox

Run the full repository validation and then deploy only `entitlement-test`:

```bash
gh workflow run deploy-entitlements.yml -f environment=entitlement-test
```

Use a non-sensitive workflow fixture and Stripe test card. Confirm the on-site Payment Element charges exactly $49, returns to `/check/`, restores the pending report, and unlocks HTML/JSON only after server verification.

## 2. Prepare the protected production environment

Activate and review the Stripe account, business profile, statement descriptor, support details, payout account, tax obligations, and fraud settings. Create or roll the live secret key only in the protected `entitlement-production` environment. Do not reuse test keys or test webhook secrets.

Configure every required production variable and secret except the final Stripe webhook secret. Because the production `WebhookUrl` does not exist until the first stack deployment, set `STRIPE_WEBHOOK_SECRET` to a temporary, cryptographically strong bootstrap value beginning with `whsec_`. Generate it with a secure secret generator, store it only in the protected environment, and never use it to sign or accept an event. This value exists only to let the stack create the production URL and must be replaced before production payment traffic is enabled.

## 3. Bootstrap the production stack and webhook

The first production setup requires two deployments:

1. Confirm `entitlement-production` has a required reviewer, is restricted to `main`, and contains the temporary bootstrap `STRIPE_WEBHOOK_SECRET`.
2. Run `gh workflow run deploy-entitlements.yml -f environment=entitlement-production`.
3. Capture the non-secret `WebhookUrl` output from the successful deployment.
4. Create one live Stripe webhook destination for that exact URL and subscribe only to:

- `payment_intent.succeeded`
- `charge.refunded`

5. Replace the bootstrap value in `entitlement-production` with Stripe's actual live `whsec_...` signing secret.
6. Run `gh workflow run deploy-entitlements.yml -f environment=entitlement-production` again.
7. Send a real Stripe-signed test event from the live destination and confirm the webhook returns HTTP 200 before enabling production payment traffic.

The bootstrap value must not remain configured after this sequence. Never weaken webhook verification, expose the secret, or accept an unsigned event to avoid the second deployment.

## 4. Verify GitHub environments

Confirm `entitlement-test` and `entitlement-production` use different stack names, signing secrets, Stripe credentials, and webhook secrets. Confirm both require reviewer approval. The deployment workflow rejects live keys in test and test keys in production without printing keys.

## 5. Configure the live Amplify variables

Set the live site’s `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the matching `pk_live_...` key and `NEXT_PUBLIC_ENTITLEMENT_API_BASE` to the production stack `ApiBaseUrl`. No secret belongs in Amplify public variables.

## 6. Verify the production backend

After both bootstrap deployments and owner review, verify the workflow's non-secret `ApiBaseUrl` and `WebhookUrl` outputs. `GET /health` must return only `status`, `service`, and `mode: "production"`.

## 7. Deploy the frontend

Trigger the existing Amplify static-site deployment only after the live public variables point to the production backend and matching live Stripe account. Verify checkout still uses the on-site Payment Element and does not expose workflow contents or secrets.

## 8. Make one low-risk live payment

Use a non-sensitive test workflow and a real card controlled by the owner. Make exactly one $49 payment. Do not use a customer workflow for launch verification.

## 9. Verify downloads and recovery

Confirm webhook verification returns 200, the pending scan restores, payment parameters are removed, and HTML/JSON downloads work. Refresh once to confirm recovery does not require repayment while webhook delivery is pending.

## 10. Test a full refund

Refund the launch payment in full. Confirm Stripe delivers `charge.refunded`, new entitlement verification is denied, and the UI reports that the payment was fully refunded. An entitlement token issued before the refund may remain usable only until its existing 15-minute expiration.

## 11. Review logs and privacy

Confirm logs and DynamoDB contain only opaque scan, PaymentIntent, event, status, and timestamp fields. Workflow JSON, workflow names, filenames, report contents, node parameters, credential references, card data, customer data, secrets, and raw webhook bodies must be absent.

## 12. Confirm policy behavior

Full refunds revoke new or renewed access. Partial refunds remain eligible because the product was not fully refunded; handle partial-refund customer communication manually. Review the public refund policy with qualified counsel for the operating jurisdiction before broader sales.

## 13. Roll back safely

To stop new purchases, remove or disable the live frontend entitlement API/public Stripe variables and redeploy the static site. Disable the live webhook destination only after purchases are stopped. Roll back application code through a reviewed commit; do not delete the DynamoDB table or rotate signing/webhook secrets during an active incident unless compromise requires it. Preserve logs and Stripe records for investigation.
