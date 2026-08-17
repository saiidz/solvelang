# Customer priority API wiring

Status: **built for review; not deployed; all priority launch gates remain OFF**.

## Why the routes attach to the existing API

SolveLang customer sessions use a host-bound `sl_api_session` cookie issued by the existing production API Gateway host. A second unrelated execute-api hostname would not receive that cookie. This build therefore keeps the priority runtime isolated in its own Lambda/CloudFormation stack but attaches only the four reviewed priority routes to the **existing API ID**.

The shared API Lambda/template is not modified by this stack.

## Routes

Only these routes are managed:

- `POST /customer/priority/source`
- `POST /customer/priority/quote`
- `POST /customer/priority/jobs`
- `GET /customer/priority/jobs/{jobId}`

No billing, admin, subscription, webhook, email, or general API route is added.

## Runtime isolation

The dedicated priority Lambda uses:

- a read-only customer-session verifier that reads the current session/account records and checks `authVersion`;
- the existing account-access service to reject suspended/terminated accounts;
- a focused usage adapter that applies the same plan/quota semantics to weighted credits;
- the reviewed priority job store;
- the reviewed content-addressed private source store;
- the reviewed customer-priority handler/service.

The priority session verifier never sends email and does not auto-create/repair auth records. A missing, malformed, expired, stale-version, or restricted account fails closed.

## Least-privilege contract

When customer priority is enabled, the Lambda receives only:

- `dynamodb:GetItem` on the existing accounts/customer-auth/usage/idempotency/priority-jobs tables;
- `dynamodb:PutItem` on the priority-jobs table;
- `dynamodb:TransactWriteItems` on usage + idempotency tables;
- `s3:GetObject` and `s3:PutObject` only under `customer/*` in the reviewed priority source bucket.

It receives no DynamoDB Scan/Query/Delete/Update authority, no S3 list/delete authority, no SES permission, no Stripe credential, no API admin secret, and no provider credential.

## Feature gates

All four stack parameters default to `false`:

- `PriorityApiEnabled`
- `PriorityQueueEnabled`
- `CustomerPriorityEnabled`
- `ProviderExecutionEnabled`

The API stack can be staged with routes returning `503 customer_priority_disabled` before customer priority is released. Customer priority cannot be enabled without the API + queue and required table/bucket inputs. Provider execution cannot be enabled before customer priority.

## Non-actions

This branch contains no deployment workflow and performs no AWS mutation, route attachment, upload, credit consumption, provider call, billing/Stripe operation, email, or charge.
