# Customer priority production candidate v1

This is a build-only production candidate. It does not authorize deployment or customer exposure.

## Independent launch interlocks

Customer priority requires all of the following to be intentionally enabled in a later reviewed rollout:

1. production queue processing;
2. customer priority API exposure;
3. provider execution.

The production infrastructure candidate defaults queue processing and provider execution to `false`. Billing is not a dependency and no Stripe setting exists in this stack.

## Source flow

1. An authenticated customer requests a five-minute source reservation using a request ID, SHA-256 fingerprint, and declared byte length.
2. The server derives the deterministic customer job ID and returns a presigned HTTPS PUT for exactly one account/job object key plus required metadata headers.
3. The customer uploads directly to the private S3 source bucket.
4. Submission re-checks the active customer account and verifies object identity, metadata, size, and fingerprint before weighted credits may be consumed.
5. The queued job stores only the account/job identity, source fingerprint, priority metadata, and accounting metadata; it does not copy source bytes into DynamoDB/SQS.
6. The worker re-checks account access before execution, retrieves the bounded source object, verifies SHA-256 again, and only then calls the configured HTTPS provider.
7. The worker persists only a bounded provider/report receipt.

## Storage controls

The candidate source bucket blocks all public access, uses bucket-owner-enforced ownership, AES-256 server-side encryption, versioning, and seven-day object/noncurrent-version expiry. The jobs table uses encryption, TTL, point-in-time recovery, and retain-on-replacement/deletion policies.

## Provider boundary

Provider execution requires an explicit HTTPS endpoint, an independent server-side secret, source storage, and `PriorityProviderExecutionEnabled=true`. The worker fails closed when any required provider configuration is absent. Requests do not follow redirects. Provider responses are bounded and accepted only as a small JSON receipt containing a report ID and provider name.

## What remains intentionally out of this PR

- no production deployment workflow;
- no production stack creation;
- no customer priority UI selector;
- no customer API route activation in the current production API stack;
- no provider secret configuration;
- no Stripe/billing activation;
- no real source upload or customer job;
- no production credit consumption.

A separate customer API integration PR may consume these contracts while still defaulting exposure to OFF.
