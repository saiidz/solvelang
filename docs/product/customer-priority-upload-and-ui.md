# Customer priority upload and UI

Status: **built for review; not deployed; customer priority remains OFF**.

This stacked build closes the customer-facing code gap after the production-OFF source/executor foundation.

## Authenticated source upload

`POST /customer/priority/source` is handled by the customer-priority adapter and:

- authenticates the existing customer session;
- requires the session CSRF token;
- derives `accountId` only from the authenticated session;
- accepts only `application/zip` binary uploads represented by API Gateway as base64 event bodies;
- passes bytes to the bounded content-addressed source store;
- returns only SHA-256 fingerprint and byte count.

The browser cannot choose another account's storage prefix.

## Preventing charges for nonexistent source

When provider execution is enabled, `createCustomerPriorityService` now requires a source verifier. Before `consumeUsage` is called, submission performs an account-bound `HeadObject` through `sourceStore.assertSource` and validates the stored SHA-256 metadata and bounded byte count.

Therefore a random or missing fingerprint cannot consume weighted credits or create a queued customer job.

Exact duplicate job retries still return the existing job without repeating source verification or usage consumption.

## Customer UI

`/account/priority/` is a noindex customer surface that is compiled behind:

```text
NEXT_PUBLIC_CUSTOMER_PRIORITY_ENABLED=true
```

Unless that release flag is explicitly present at site build time, the page displays only that priority processing is not released and performs no API mutation.

When released later, the page supports:

1. signed-in customer source upload;
2. lane/workload quote;
3. explicit weighted-credit review;
4. job submission;
5. ownership-scoped status refresh.

It never accepts an account ID and never contains provider or admin credentials.

## Still intentionally not done

This PR does not wire routes into a production stack, deploy queues, enable the site flag, configure a provider, enable billing, upload production source, consume production credits, or perform a charge. Those remain separate reviewed rollout gates.
