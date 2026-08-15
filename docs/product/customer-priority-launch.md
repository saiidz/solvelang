# Customer priority processing launch contract

Status: **built for review; not wired into the production API stack and not deployed by this branch**.

The queue foundation already provides four weighted FIFO lanes (`normal`, `express`, `priority`, `critical`) and account-aware workers. This build adds the customer-facing service and adapter needed before a future release can expose paid priority safely.

## Three independent gates

Customer submission fails closed unless all are true:

1. `queueEnabled` — the queue foundation is enabled and healthy;
2. `customerPriorityEnabled` — customer-visible priority is explicitly released;
3. `providerExecutionEnabled` — a real customer-job executor is explicitly wired and validated.

A healthy queue alone never exposes paid priority.

## Quote semantics

The existing base-credit envelope remains the source of truth:

- up to 5,000 input tokens per base credit;
- up to 1,000 output tokens per base credit;
- workload cost is the larger input/output dimension.

Priority then multiplies that base charge using the reviewed lane contract:

- normal / standard: 1x;
- express: 2x;
- priority: 5x;
- critical: 10x.

Quotes require an active account and do not consume credits.

## Submission semantics

A customer submission requires:

- authenticated customer account identity supplied by the server session, never browser ownership input;
- CSRF verification;
- active account state;
- bounded request ID;
- SHA-256 source fingerprint, not source contents;
- valid token workload and lane;
- all three launch gates above.

The service:

1. calculates weighted credits;
2. derives a deterministic `job_...` ID from account + request ID;
3. checks exact idempotency;
4. consumes weighted credits through the existing idempotent usage ledger using `priority:<requestId>`;
5. stores a customer-owned `repository_audit` job.

The customer job stores only a source fingerprint in this layer. Source upload/storage and provider execution require a separate reviewed contract.

## Worker boundary

The worker continues to verify account access immediately before customer execution. Customer `repository_audit` jobs require an explicitly injected `executeCustomerJob` implementation. Without that executor the worker fails closed and never marks the job complete.

The existing fixed `queue_canary` path remains unchanged.

## Ownership-safe status

Job status requires the authenticated account and returns `404` when a valid job belongs to another account. The browser cannot substitute another account ID.

## Deliberately not wired yet

This branch does **not**:

- add customer priority routes to the production SAM template;
- turn on `PRIORITY_QUEUE_ENABLED`;
- add a provider API key/credential;
- implement source upload/storage;
- enable Stripe/live subscription billing;
- advertise priority as selectable on the customer page;
- deploy the queue or API;
- submit any real job;
- consume any production credits.

Those remain separate production gates after hosted CI, queue canaries, provider execution validation, stop thresholds, and billing review are complete.
