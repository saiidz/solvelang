# SolveLang production foundation deployment

Status: **prepared, not authorized to run**.

The production-readiness preflight has already proven that the protected production environment, AWS OIDC preflight role, SES sender, live Stripe credential, and approved live recurring Price objects resolve correctly without deploying infrastructure or creating charges.

This document defines the next phase: an **inert production foundation**. It creates the API stack and operations baseline but keeps all customer-facing capability disabled.

## Hard feature state

The production foundation workflow is fixed to:

- `ApiAccessMode=live`
- `ApiAccessEnabled=false`
- `CustomerAccountsEnabled=false`
- `SubscriptionBillingEnabled=false`

The workflow does **not** load or pass the Stripe secret, live Price IDs, or a webhook signing secret into the production Lambda environment.

A successful foundation therefore creates no subscription, checkout, invoice, customer billing mutation, or charge path.

## Separate deployment identity

Do not reuse the validation-only `AWS_ROLE_ARN` role for deployment.

Create a second GitHub OIDC role dedicated to production foundation deployment and save its ARN as the `api-access-production` Environment secret:

`AWS_DEPLOY_ROLE_ARN`

Its trust policy must allow `sts:AssumeRoleWithWebIdentity` only for:

- GitHub OIDC provider `token.actions.githubusercontent.com`
- audience `sts.amazonaws.com`
- subject `repo:saiidz/solvelang:environment:api-access-production`

The deploy role should have only the AWS permissions required to manage the SolveLang production API stack, dedicated artifact bucket, PITR, Lambda log retention, and CloudWatch alarms. It must not have permissions to manage unrelated stacks or resources when resource-level scoping is supported.

The repository contract for that role is `ops/aws/production-foundation-deploy-policy.json`. Its API Gateway permissions cover only the HTTP API collection and generated resources beneath `/apis`; they include explicit tag and untag authorization for the SAM-generated API and `$default` stage. Updating this repository policy does not update the live role: applying it remains a separate, explicitly authorized operator action.

## Alarm routing prerequisite

Before the first production foundation deployment, create an owner-controlled SNS topic in the same AWS region and subscribe at least one actively monitored notification target.

Save the topic ARN as the `api-access-production` Environment variable:

`OPERATIONS_ALARM_TOPIC_ARN`

The subscription must be confirmed before deployment. The workflow refuses to run without a same-region SNS topic ARN.

## Deployment behavior

The workflow:

1. requires `main`;
2. requires the protected `api-access-production` GitHub Environment;
3. requires explicit `confirm_production_foundation=true` input;
4. assumes only `AWS_DEPLOY_ROLE_ARN`;
5. validates tests and the SAM template before deployment;
6. creates/uses a dedicated private, encrypted, versioned SAM artifact bucket named `solvelang-api-access-production-artifacts-<account>-<region-hash>`, where `<region-hash>` is the first 8 lowercase hexadecimal characters of `SHA-256(AWS_REGION)`;
7. deploys only `solvelang-api-access-production` with all runtime features disabled;
8. verifies `/health` reports API access, customer accounts, and subscription billing as disabled;
9. enables DynamoDB point-in-time recovery on every table;
10. enforces 90-day Lambda log retention;
11. creates Lambda error, throttle, and duration alarms for the API handler and authorizer;
12. routes those alarms to the configured SNS topic;
13. verifies the operational controls before declaring success.

For operational verification, derive the region discriminator with the same command used by the workflow:

```bash
printf '%s' "$AWS_REGION" | sha256sum | cut -c1-8
```

For example, the production artifact bucket is always account-specific and region-specific even though the region discriminator is intentionally bounded to 8 characters so the final S3 bucket name remains within the 63-character limit.

## Production tables protected with PITR

- `ApiAccountsTable`
- `ApiKeysTable`
- `ApiUsageTable`
- `ApiUsageIdempotencyTable`
- `ApiSubscriptionEventsTable`
- `ApiCustomerAuthTable`

TTL-based records remain subject to their application expiration semantics after a restore. PITR is not authorization to resurrect expired sessions, magic links, or idempotency records.

## Initial alarms

The foundation creates six alarms:

- API handler errors: at least 1 in 5 minutes
- API handler throttles: at least 1 in 5 minutes
- API handler maximum duration: at least 12 seconds in 5 minutes
- authorizer errors: at least 1 in 5 minutes
- authorizer throttles: at least 1 in 5 minutes
- authorizer maximum duration: at least 4 seconds in 5 minutes

Missing data is treated as non-breaching because the foundation is intentionally inert.

## Rollback

CloudFormation/SAM remains the source of truth. Do not delete production tables to roll back application code.

If the first foundation deployment fails, allow CloudFormation to roll back the failed stack operation and retain the workflow logs. If a later foundation revision must be rolled back, revert to the last known-good repository commit and redeploy through the same protected workflow after owner approval.

The operational PITR/log-retention/alarm configuration is idempotent and is re-verified on every foundation deployment.

## Still blocked after foundation

A green foundation deployment does **not** authorize customer accounts or billing. The following remain separate phases:

- create and validate the production Stripe webhook after the real production API endpoint exists;
- enable customer accounts only in a separate reviewed change;
- publish approved Terms, Privacy, refund/cancellation, billing disclosure, and support materials before real customers;
- enable billing only after webhook verification and a second explicit owner approval;
- execute any real-charge canary only after separate explicit approval.
