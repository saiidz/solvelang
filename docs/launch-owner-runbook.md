# SolveLang Test-Mode Launch Runbook

This runbook covers the owner-only steps required after the repository launch gates pass. Use Stripe test mode and the `entitlement-test` GitHub environment only. Do not create a real charge, enable live payments, publish npm, or deploy the production entitlement environment during this verification.

## 1. Create the protected GitHub environment

Open **Repository settings → Environments → New environment**, create `entitlement-test`, and add a required reviewer and deployment-branch protection for `main`.

Add environment variables:

- `AWS_REGION`
- `ENTITLEMENT_STACK_NAME`
- `SITE_ORIGIN=https://www.solve-lang.com`
- `STRIPE_PRICE_ID` for the active Stripe test-mode Price

Add environment secrets:

- `AWS_ROLE_ARN` for a GitHub OIDC deployment role limited to the test stack
- `STRIPE_SECRET_KEY` beginning with `sk_test_`
- `STRIPE_WEBHOOK_SECRET` beginning with `whsec_`
- `ENTITLEMENT_SIGNING_SECRET`, generated as at least 32 random bytes

Do not put secret values in repository variables, pull-request comments, command history, or launch evidence.

## 2. Verify AWS identity without deploying

From a protected owner shell:

```bash
aws sts get-caller-identity
```

Confirm the returned account and role are the intended test account and deployment role. Stop if either is unexpected.

## 3. Prepare Stripe test mode

In the Stripe Dashboard, enable **Test mode**, then:

1. Create or select the Workflow Preflight product.
2. Create one active one-time Price for USD 49.
3. Put its `price_...` identifier in the `entitlement-test` `STRIPE_PRICE_ID` variable.
4. Confirm no live-mode Price or webhook is being edited.

The first test-stack deployment needs a non-live bootstrap value for `STRIPE_WEBHOOK_SECRET` because the final API URL does not exist yet. Use a random `whsec_bootstrap_...` test-only value, deploy once, then replace it immediately in step 5.

## 4. Deploy only the test entitlement stack

Run the protected manual workflow:

```bash
gh workflow run deploy-entitlements.yml -f environment=entitlement-test
gh run list --workflow deploy-entitlements.yml --limit 1
gh run watch <run-id>
```

Do not select `entitlement-production`. After the workflow succeeds, read the non-secret stack outputs:

```bash
aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$ENTITLEMENT_STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table
```

Record `ApiBaseUrl` and `WebhookUrl`. These URLs are public configuration, not credentials.

## 5. Register and verify the Stripe test webhook

In **Stripe test mode → Workbench → Webhooks**, create an endpoint using the stack `WebhookUrl` and subscribe only to `payment_intent.succeeded`.

Copy the generated `whsec_...` signing secret into the protected `entitlement-test` `STRIPE_WEBHOOK_SECRET`, replacing the bootstrap value. Rerun the test deployment workflow so Lambda receives the real test signing secret.

## 6. Configure and rebuild the static site

Set the static-site build variable:

```text
NEXT_PUBLIC_ENTITLEMENT_API_BASE=<ApiBaseUrl>
```

Trigger the existing static-site build through the owner’s deployment system. Do not put Stripe or entitlement secrets in any `NEXT_PUBLIC_*` variable.

Verify the public health endpoint before checkout:

```bash
curl -fsS "$NEXT_PUBLIC_ENTITLEMENT_API_BASE/health"
```

It must return only safe readiness fields and confirm `mode` is `test`. Stop if it returns credentials, identifiers, customer/workflow data, internal stack details, or live mode.

## 7. Complete one test purchase

1. Open `https://www.solve-lang.com/check/` in a clean browser session.
2. Upload a non-sensitive test fixture, not a customer workflow.
3. Confirm the preview appears and the complete report remains locked.
4. Continue to Stripe Checkout and use Stripe’s documented `4242 4242 4242 4242` test card with any future expiry and CVC.
5. Confirm the browser returns to the same opaque scan ID, verifies the entitlement server-side, removes checkout parameters from the address bar, and unlocks HTML/JSON downloads.
6. Refresh once and exercise the documented recovery behavior. Do not treat a query parameter or local-storage edit as payment proof.

In Stripe Workbench, confirm one successful `payment_intent.succeeded` delivery and no unexpected retries. In AWS logs and DynamoDB, verify only opaque scan/PaymentIntent/event identifiers and allowlisted conversion names are present. Workflow JSON, workflow names, filenames, report findings, credential values, and customer data must be absent.

## 8. Generate final evidence

Export the protected values into the owner shell without printing them, then run:

```bash
node ops/launch/launch-control.mjs --online
```

Review:

```text
artifacts/launch-readiness/launch-readiness.json
artifacts/launch-readiness/launch-readiness.md
```

Launch readiness is proven only when the command exits zero and reports no failed or blocked controls. Preserve the evidence artifact with the tested commit SHA and the corresponding successful GitHub Actions runs.

## Current mandatory stop conditions

Do not run the owner sequence until repository CI proves all three code-level gates:

- safe entitlement `GET /health` contract;
- workflow-data privacy regression coverage, including sanitized server errors;
- deterministic Stripe test-mode lifecycle coverage for checkout, webhook, entitlement issuance/verification, replay, expiry, invalid signatures, and browser recovery.

Any missing gate remains a blocker. Do not bypass it with a manual token, query parameter, local storage, synthetic success page, or live-mode test.
