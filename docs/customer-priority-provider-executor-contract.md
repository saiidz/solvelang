# Customer-priority provider executor contract

Status: **repository contracts only; no provider is selected, configured, credentialed, or callable in production.**

The dormant production customer-priority foundation is deployed, but queue processing, customer priority exposure, provider execution, and subscription billing remain disabled.

## Provider adapter

The provider adapter defines the narrow boundary that a future reviewed provider integration must satisfy before it can be wired into a worker.

`services/api-access/src/customer-priority-provider-adapter.js`:

- uses a server-owned provider identifier;
- accepts an explicitly injected executor function only;
- forwards only the repository audit source, account/job identifiers, priority lane, weighted credits, source fingerprint, and abort signal;
- does not forward arbitrary caller fields, credentials, or a caller/provider-supplied provider identity;
- requires the worker timeout abort signal;
- accepts only a bounded report identifier from the injected executor;
- stamps the configured provider identifier onto the sanitized result;
- propagates execution failures so the queue/lease retry contract remains authoritative.

## Credential isolation contract

`services/api-access/src/customer-priority-provider-credentials.js` prepares a reference-only AWS Secrets Manager boundary without reading any live secret itself.

The contract:

- accepts only a complete Secrets Manager ARN, not a secret value or partial ARN;
- requires the secret name to remain under `solvelang/priority/production/`;
- can bind the ARN to the expected production Region and AWS account;
- gives an explicitly injected secret reader only the immutable secret ARN;
- requires the reader response to identify the exact requested ARN;
- accepts only a non-empty bounded secret string;
- uses generic validation errors that do not include credential material.

No Secrets Manager SDK client or IAM permission is added by this contract. A later worker implementation must use least privilege: `secretsmanager:GetSecretValue` on the exact full secret ARN only. It must not require `ListSecrets`. If the selected secret uses a customer-managed KMS key, any required `kms:Decrypt` permission must be separately scoped to that exact key and reviewed with the provider credential rollout.

## Current production boundary

These contracts do **not**:

- wire `executeCustomerJob` into `priority-worker-handler.js`;
- select a provider;
- add a provider SDK or network request;
- create a Secrets Manager secret;
- read, inject, rotate, or expose a provider credential;
- grant Secrets Manager or KMS IAM authority;
- change `PriorityQueueEnabled`;
- change `CustomerPriorityEnabled`;
- change `ProviderExecutionEnabled`;
- upload customer source;
- submit a customer job;
- consume customer credits;
- enable Stripe or subscription billing.

Therefore a customer-owned `repository_audit` job still fails closed because the production worker handler has no provider executor configured.

## Required later gates

Before provider execution can be activated, review and approve each boundary separately:

1. Select the provider and exact API/runtime contract.
2. Create the dedicated production provider secret and exact least-privilege read policy; do not place the credential value in CloudFormation parameters, GitHub inputs, or browser/customer configuration.
3. Add the reviewed provider SDK/client and an exact Secrets Manager reader implementation.
4. Wire the provider adapter into a worker only behind an explicit provider-execution gate.
5. Add provider timeout, retry, rate-limit, cost, and sanitized-error contracts.
6. Add operations alarms and explicit stop thresholds.
7. Run a server-owned non-customer canary with no billing/customer credit impact.
8. Validate queue workers and DLQs before any customer-priority exposure.
9. Enable customer priority only through a separate owner-approved production gate.
10. Keep subscription billing independent.

No step in this document authorizes a production mutation.
