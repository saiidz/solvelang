# Customer Priority Production Foundation

Status: **built for review; not deployed; all production launch gates default OFF**.

This closes the two code-level gaps left after the customer priority service was introduced: private source storage and a bounded customer-job executor boundary.

## Source storage

`priority-source-store.js` accepts only bounded ZIP bytes (5 MiB maximum), computes SHA-256 itself, and writes a content-addressed object under:

```text
customer/<canonical-account-id>/<sha256>.zip
```

The S3 adapter requests AES-256 server-side encryption and records only source hash/byte metadata. Reads recompute SHA-256 and fail closed on mismatch. The production foundation bucket is private, bucket-owner enforced, encrypted, versioned, denies insecure transport, and expires current/noncurrent customer source objects after seven days.

The source archive is never embedded in the priority job record or queue message.

## Executor boundary

`customer-priority-executor.js`:

1. loads source using the authenticated job account + stored fingerprint;
2. verifies source integrity through the source store;
3. invokes an injected audit executor with an AbortSignal and bounded timeout;
4. accepts only bounded `reportId` and `provider` result fields;
5. deletes source after successful processing by default;
6. leaves source in place after failure so normal retry/DLQ handling can operate.

No provider implementation or credential is included in this build. Without an explicitly injected executor, the already-merged priority worker continues to fail customer jobs closed.

## Independent launch gates

The production foundation template has three booleans, each defaulting to `false`:

- `PriorityQueueEnabled`
- `CustomerPriorityEnabled`
- `ProviderExecutionEnabled`

Customer exposure requires queue enablement. Provider execution requires customer exposure. This branch intentionally contains no deployment workflow and no provider secret parameter.

## Billing boundary

Weighted-credit calculation remains the existing reviewed 1x/2x/5x/10x contract. This source/executor foundation does not enable subscription billing, create Stripe resources, read Stripe credentials, perform charges, or change plan entitlements.

A later release still requires separately reviewed API/session wiring, production queue deployment, a real executor implementation, stop thresholds/alarms, customer UI exposure, and explicit owner deployment authorization.
