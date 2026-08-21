# Production customer-priority dormant foundation rollout

Status: **deployed dormant in production from commit `4bb26ab1802d2fbffbb82a5807a1db00b3954820` by workflow run `32431853270`; queue processing, customer priority, provider execution, and billing remain disabled.**

This rollout intentionally separates durable infrastructure provisioning from customer/worker activation.

## What the foundation contains

- retained/PITR DynamoDB priority jobs table with TTL and stream;
- retained private AES-256/versioned S3 source bucket with seven-day lifecycle and TLS-only bucket policy;
- standard/express/priority/critical FIFO queues and DLQs;
- dispatcher and weighted workers defined but conditional on `PriorityQueueEnabled=true`;
- DLQ alarms with optional production operations SNS actions;
- CloudFormation termination protection after deployment.

## Dormant rollout state

`Deploy Customer Priority Production Foundation` always deploys:

```text
PriorityQueueEnabled=false
CustomerPriorityEnabled=false
ProviderExecutionEnabled=false
CustomerAuthTableName=disabled
```

Therefore the durable table/bucket/queues exist for later verification, but dispatcher/worker Lambdas are not created and no queue processing can occur. The workflow refuses to run if an existing production priority stack already has any release gate enabled, so it cannot be used later to silently disable an active customer release.

## Deployment role supplement

`production-priority-foundation-deploy-supplemental-policy.json` adds only:

- CloudFormation operations on exact stack `solvelang-api-access-production-priority`;
- SQS management on `solvelang-priority-prod-*` queues;
- S3 bucket-management operations on `solvelang-priority-prod-source-*`.

It grants no IAM, KMS, SES, Stripe, customer-record, or runtime object-read/write authority. Applying the supplement to the live deploy role remains a separate owner-approved IAM mutation.

## Verification

The workflow verifies:

- live API/customer accounts are enabled and billing remains disabled;
- all three priority gates are false before/after;
- no processing Lambda exists in the dormant stack;
- jobs-table PITR and TTL are enabled;
- source-bucket public access is blocked, encryption/versioning are enabled;
- four queue outputs resolve and are readable;
- termination protection is enabled;
- no source upload, customer job, credit consumption, email, Stripe use, or charge occurs.

Production run `32431853270` completed those checks successfully on the commit named above.

## What this still does not authorize

This foundation does not enable the customer priority API, customer UI, queue workers, or provider execution. Those release decisions remain separately gated by #164/#165/#166 and by a real reviewed executor/provider choice. Billing remains independent.
