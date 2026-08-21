# Customer-priority provider executor contract

Status: **repository contract only; no provider is selected, configured, or callable in production.**

The dormant production customer-priority foundation is deployed, but queue processing, customer priority exposure, provider execution, and subscription billing remain disabled.

## Purpose

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

## Current production boundary

This contract does **not**:

- wire `executeCustomerJob` into `priority-worker-handler.js`;
- select a provider;
- add a provider SDK or network request;
- create, read, inject, or rotate provider credentials;
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
2. Define isolated credential storage and least-privilege secret access without exposing credentials to browser/customer paths.
3. Wire the provider adapter into a worker only behind an explicit provider-execution gate.
4. Add provider timeout, retry, rate-limit, cost, and sanitized-error contracts.
5. Add operations alarms and explicit stop thresholds.
6. Run a server-owned non-customer canary with no billing/customer credit impact.
7. Validate queue workers and DLQs before any customer-priority exposure.
8. Enable customer priority only through a separate owner-approved production gate.
9. Keep subscription billing independent.

No step in this document authorizes a production mutation.
