# Self-Driving GitHub REST transport boundary

Status: implementation candidate for exact-head qualification.

This boundary executes only request plans produced by the qualified `solvelang.self-driving.github-rest-request.v0` contract. It is deliberately not a generic GitHub client.

## Authority

The adapter may perform one GitHub REST request through an injected transport after an injected authorization broker supplies an ephemeral token for the exact permission category required by the request plan.

It independently revalidates, before credential access:

- request schema and exact GitHub.com API origin;
- operation-specific HTTP method and allowlisted REST path shape;
- operation-specific permission category;
- exact expected status set;
- exact response-byte ceiling from the planner contract;
- exact `Accept` and pinned API-version headers, with no serialized Authorization header in the plan;
- no weakened retry, redirect, force-push, auto-merge, or protected-base-write policy;
- no credential-like material in a planned request body.

The only allowlisted operations remain:

- read base branch;
- read base branch rules;
- read head ref;
- read exact base commit;
- read exact recursive base tree;
- read exact base blob;
- create one head ref;
- create one tree;
- create one commit;
- update the approved head ref with non-force semantics;
- open one pull request.

There is no merge endpoint, workflow-dispatch endpoint, delete-ref endpoint, arbitrary REST method, arbitrary host, or arbitrary path escape.

## Credential handling

Authorization is added only inside the transport call as `Bearer <ephemeral token>`. The token is never added to the durable request-plan artifact and is never returned in success or failure artifacts.

The adapter returns bounded failure codes rather than raw transport or authorization-broker errors. A hostile broker callback cannot cause a second transport call.

This module does not resolve installation credentials by itself. The concrete installation-token resolver remains a later, separately qualified runtime layer.

## Response handling

The adapter:

- rejects response URL drift rather than following redirects;
- accepts only the exact status set declared by the operation contract;
- enforces the exact response-byte ceiling on UTF-8 bytes;
- accepts JSON media types only when a content type is supplied;
- requires valid JSON before returning a response body;
- returns only operation/status/url/byte-count/body plus explicit no-leak/no-retry policy truth.

The response body is internal execution data, not sanitized telemetry. Callers must not log arbitrary GitHub response bodies.

## Still not enabled

This change does not itself provide a GitHub App installation-token resolver, production credential wiring, rollout activation, automatic merge, billing mutation, provider activation, deployment authority, or Solve Runner authority.

The next layer should parse these bounded GitHub responses into the exact live-preflight and branch/tree/commit/PR evidence expected by the merged one-shot executor, then wire a least-privilege installation-token resolver behind a separately governed runtime activation gate.
