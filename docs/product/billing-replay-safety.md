# Billing webhook replay and confirmation-delivery safety

This document records the repository-safe replay contract for Workflow Preflight billing. It is **not** evidence that production billing is enabled and it does not authorize a real Stripe charge, refund, webhook registration, deployment, or provider mutation.

## Repository contract

A valid `payment_intent.succeeded` webhook does not send customer email directly. The signed webhook path validates the payment/consent binding and atomically commits two DynamoDB records in one transaction:

1. the paid entitlement; and
2. one pending contract-confirmation outbox record keyed by the PaymentIntent and Terms version.

Repeated delivery of the same Stripe event, or a later Stripe event for the same already-committed payment, converges on the existing outbox instead of creating another entitlement/outbox side effect.

The DynamoDB Streams dispatcher performs the next durable handoff. Production mode uses an encrypted FIFO SQS queue. The dispatcher marks the outbox `dispatched` only after the queue accepts the message. If queue acceptance succeeds but the state update is ambiguous, the outbox remains pending and is retried. The queue message uses the confirmation idempotency key as its FIFO deduplication identifier.

The confirmation worker has a separate DynamoDB delivery ledger and a bounded lease. Once a delivery is recorded as `sent`, duplicate SQS deliveries are acknowledged without another SES send. Active leases fail back to SQS; expired leases can be atomically reclaimed after a worker failure.

`services/entitlements/test/billing-replay-contract.test.ts` composes those boundaries in one deterministic repository test: webhook replay -> one atomic outbox -> ambiguous dispatcher acknowledgement -> repeated durable-queue message -> one normal-path customer delivery.

## Exact limitation

SES does not provide an application idempotency key for `SendEmail`. If SES accepts a message but the worker cannot persist the final `sent` state, the system deliberately retains/reclaims the delivery lease and may send one duplicate rather than silently lose the legally required confirmation. The repository must therefore describe this path as **at-least-once with duplicate suppression when the delivery ledger is known**, not globally exactly-once email delivery.

This ambiguity is already covered by the worker regression suite. It is a documented reliability tradeoff, not permission to claim exactly-once external side effects.

## Production gate remains closed

Repository tests can qualify replay/idempotency design without touching Stripe production. Before billing can be enabled, the production launch gate still requires all action-specific prerequisites in Issue #113, including production Stripe/webhook identity verification, customer-visible legal/support review, monitoring and rollback checks, and fresh owner authorization for any live billing mutation or real-charge/refund canary.
