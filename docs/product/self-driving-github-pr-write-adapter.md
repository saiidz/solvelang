# Solve Self-Driving GitHub PR write adapter

This document records the concrete GitHub PR-write adapter boundary introduced after the qualified request planner, bounded transport, response-evidence parser, patch materializer, one-shot executor, and live-preflight timing correction.

## Purpose

The adapter composes the already-qualified Self-Driving write layers into the exact `SelfDrivingPrWriteAdapter` contract consumed by the one-shot executor. It is the first concrete runtime composition that can perform the reviewed GitHub branch → commit → pull-request sequence when supplied with an injected authorization broker and bounded network transport.

## Exact sequence

For one execution plan, the adapter allows only:

1. read protected base branch;
2. read active branch rules;
3. prove the planned head ref is absent;
4. read the exact base commit;
5. read the exact non-truncated recursive base tree;
6. read each unique reviewed base blob once;
7. create the approved head ref from the exact base revision;
8. create one reviewed tree from deterministic materialized bytes;
9. create one commit with the exact approved parent;
10. update only the approved head ref with `force: false`;
11. open one PR from the approved head to the protected base.

There is no merge, auto-merge, workflow-dispatch, delete-ref, arbitrary REST, direct protected-base push, or force-push operation.

## State and replay policy

The adapter is a one-shot state machine. Each stage must occur exactly once in order. Out-of-order, repeated, concurrent, cancelled, drifted, or failed stages make the adapter terminally failed. A later completion cannot re-arm a terminally failed adapter.

The created commit tree and single parent are validated before the head ref is advanced. If commit identity is malformed or drifted, no ref update is attempted.

## Credential boundary

The adapter does not resolve, store, serialize, log, or return GitHub credentials. Credentials remain behind the injected authorization broker and are passed only to the previously qualified bounded transport. The adapter has no built-in GitHub App private key, installation-token minting, environment-variable resolver, secret-store access, or production activation.

## Evidence and patch binding

Live preflight is rebuilt from exact bounded GitHub responses. The adapter requires the exact protected base revision, non-weakened PR/rules policy, absent head branch, exact tree/blob identities, supported regular file modes, and deterministic UTF-8/LF patch materialization before any repository write.

The create-tree request is regenerated from the bound execution plan, verified base tree, verified file modes, and deterministic materialization. Caller-supplied arbitrary tree contents are not accepted.

## Failure handling

The adapter performs no retries and no automatic cleanup/re-arm. Bounded transport failures surface only operation and bounded failure code; raw transport/broker errors and credential material are not returned.

Potential partial side effects remain the responsibility of the one-shot executor/finalization contract, which conservatively records the stage and terminally consumes or invalidates the single-use claim.

## Still separate

This adapter does **not** activate production GitHub writing. Remaining activation work includes a separately qualified least-privilege GitHub App installation credential broker/runtime gate, an owner-authorized canary, and final production/security review. Billing, provider rollout, PostHog live canary, managed hosted execution, and Solve Runners remain separate authority boundaries.
