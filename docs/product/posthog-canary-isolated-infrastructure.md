# PostHog canary isolated infrastructure adapters

This repository boundary connects the reviewed runtime-auth gate to externally supplied kill-switch state and callback-scoped credential material without adding a secret-store SDK, environment fallback, built-in network client, or production activation path.

## What this adds

`selfDrivingPosthogCanaryIsolatedInfrastructure.ts` creates the exact `PostHogCanaryRuntimeDependencies` required by the runtime gate from two narrower injected capabilities:

- a kill-switch state reader that must return an exact activation/ref/time binding plus bounded evidence identity;
- a callback-scoped credential source that receives the already-bound lease request and may expose one short-lived Bearer authorization value only inside its callback.

The adapter validates the canonical deny-by-default runtime activation before either dependency can be reached. Kill-switch state with extra fields, wrong activation/ref/time, malformed evidence, or dependency failure fails closed. Credential source material with extra fields, wrong project/origin/reference/scope, invalid timing, excessive lifetime, malformed authorization, callback re-entry, delayed callback use, or result substitution also fails closed. Raw dependency errors are not propagated.

The credential source is single-use for the activation. The adapter does not serialize or return credential material as infrastructure evidence; only the existing runtime-auth callback receives the short-lived lease.

## Authority that remains absent

This is still repository preparation, not a live secret-store implementation or provider activation. It contains no PostHog key, AWS/Vault/1Password/other secret-store client, environment-variable lookup, deployment target, durable evidence sink, key-revocation API, billing mutation, repository-write authority, rollout/production mutation, or Solve Runner authority.

A production binding must supply the external state reader and credential source from an isolated runtime and must be separately reviewed for the exact owner-approved secret reference and scope. Secrets must never be pasted into GitHub, documentation, test fixtures derived from production, or chat.

## Qualification covered here

Deterministic hostile tests prove:

- an enabled exact kill-switch state and exact callback-scoped credential source can satisfy one runtime auth request;
- disabled state prevents credential-source access entirely;
- metadata drift and unsupported secret-bearing fields fail closed;
- dependency errors are sanitized;
- callback re-entry, delayed reuse, and result substitution are rejected;
- activation policy drift is rejected before either external dependency can run.

## Still required before the first live canary

Issue #833 remains the activation gate. Before a real provider request, independently verify the current PostHog project/region/operation and least-privilege key scope, deploy a reviewed isolated implementation of these injected dependencies, complete sanitized evidence retention/deletion and key-revocation/disable operations, and obtain fresh owner authorization for the exact one-run activation. Repository merge or green CI does not authorize a live request.
