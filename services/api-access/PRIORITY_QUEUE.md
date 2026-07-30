# SolveLang Priority Queue

This stack is the test-only processing foundation for future paid Express, Priority, and Critical repository work. It is intentionally isolated from API subscriptions, customer sessions, API keys, Stripe Checkout, and credit charging.

## Current boundary

Only administrative `queue_canary` jobs are accepted.

- No customer route exists.
- No API key can submit a job.
- No paid-priority credit multiplier is enabled.
- No repository source, archive, credential, prompt, or secret is placed in an SQS message.
- The stack defaults to `PriorityQueueEnabled=false` and supports `PriorityQueueMode=test` only.

## Architecture

1. The protected admin API writes a deterministic job record to the encrypted DynamoDB jobs table.
2. A DynamoDB stream acts as the durable outbox.
3. The dispatcher sends only `{schemaVersion, jobId, priority}` to the selected encrypted FIFO queue.
4. The FIFO deduplication ID is the job ID, protecting against duplicate stream delivery.
5. Jobs are sharded across a bounded number of FIFO message groups:

| Lane | FIFO groups | Reserved worker concurrency | Future credit multiplier |
|---|---:|---:|---:|
| Standard | 1 | 1 | 1x |
| Express | 2 | 2 | 2x |
| Priority | 5 | 5 | 5x |
| Critical | 10 | 10 | 10x |

6. Workers claim jobs conditionally with a 60-second lease. A crashed or timed-out worker loses ownership after the lease expires, allowing the message retry to reclaim the job.
7. Completion, retry release, and final failure require the current worker ID, preventing a stale worker from overwriting a newer attempt.
8. Lane messages move to lane-specific FIFO dead-letter queues after three failed receives.
9. DynamoDB stream records discarded after their retry/age limits are written to the encrypted dispatcher-failure queue.

## Job states

- `queued` — durable record created; stream dispatch pending.
- `dispatched` — SQS accepted the lane message.
- `processing` — a worker owns an unexpired lease.
- `complete` — sanitized result persisted.
- `failed` — final worker attempt failed.

Terminal jobs are duplicate-safe. Repeated queue delivery of a `complete` or `failed` job is acknowledged without running it again.

## Deployment

The manual `Deploy Priority Queue Test` workflow uses the protected `api-access-test` GitHub environment and runs from `main` only.

Required environment variable:

- `AWS_REGION`
- `PRIORITY_QUEUE_STACK_NAME` — must contain `test`

Required environment secrets:

- `AWS_ROLE_ARN`
- `API_PRIORITY_ADMIN_SECRET` — a distinct random value of at least 32 characters

Stages:

- `foundation` — creates the table, queues, DLQs, and protected admin API while dispatcher/workers remain disabled.
- `canary` — enables dispatcher/workers, submits one job through each lane, verifies the expected lane capacity result, and requires every failure queue to remain empty.

## Paid-priority activation gate

Do not expose or charge 2x, 5x, or 10x credits until all of these are complete:

1. Immutable repository snapshot ingestion stores source outside SQS and verifies its digest before execution.
2. Input size and credit cost are calculated server-side from the accepted snapshot; customer-supplied token or credit counts are never authoritative.
3. The real repository-audit executor is idempotent and safe to retry after a lease expires.
4. Load tests demonstrate materially better queue-wait percentiles for Express, Priority, and Critical under sustained mixed-lane traffic.
5. CloudWatch alarms cover queue age, DLQ depth, dispatcher failures, worker failures, throttles, and jobs with expired leases.
6. Per-account and platform-wide provider-cost ceilings stop new work before margin or budget limits are exceeded.
7. The customer API clearly presents the estimated credit charge before submission and defines cancellation/refund behavior for work that never starts.
8. Test-mode end-to-end billing proves that the purchased service and delivered processing lane match.

## Rollback

1. Dispatch the `foundation` stage to set `PriorityQueueEnabled=false`.
2. Confirm `/health` returns `enabled=false`.
3. Inspect the dispatcher-failure queue and all lane DLQs before deleting or redriving messages.
4. Keep the jobs table until incident review and reconciliation are complete.

Disabling this stack does not change subscriptions, API keys, customer sessions, Stripe configuration, or the weighted-credit ledger.
