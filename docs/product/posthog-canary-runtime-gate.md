# PostHog canary isolated runtime-auth gate

This boundary connects the already-reviewed one-request PostHog canary approval/claim contract to an injected runtime credential lease without adding a built-in secret store or network client.

## What it proves

- the runtime activation is recreated from the exact canonical approval and successful single-use claim;
- activation is bounded by the existing ten-second claim deadline and may not outlive the owner-approved canary window;
- project, origin, operation, opaque credential reference, credential scope, adapter revision, operator/runtime identity, and kill-switch reference are SHA-256 bound into the activation identity;
- the kill switch is checked before credential access, again before credential release, and once more before ephemeral authorization leaves the runtime gate;
- credentials are obtained only through an injected callback-scoped lease provider;
- the lease must exactly match the activation project/origin/reference/scope, remain short-lived, and expose only one bounded Bearer authorization value;
- provider callback re-entry, result substitution, delayed callback use after provider settlement, expired activation/lease state, cancellation, and second authorization attempts fail closed;
- raw lease/provider errors are sanitized and credential material is absent from activation and lease-request artifacts.

## Authority that remains absent

This module has no built-in PostHog key, secret-store client, environment fallback, HTTP client, evidence sink, key-revocation API, production deployment path, billing authority, repository write capability, or Solve Runner authority.

The returned authorization provider is intended to be supplied to the already-bounded `executePostHogCanaryStreamingRead` transport. That transport still owns the exact one-request GET plan, byte/chunk ceilings, deadline, no retry/redirect/pagination policy, and suppression of raw provider error bodies.

## Still required before a real canary

Issue #833 remains open. A live request still requires:

1. current verification of the exact PostHog project and least-privilege key scope;
2. a reviewed concrete isolated secret-store implementation of the injected lease contract;
3. concrete sanitized-evidence retention/deletion and key-revocation operators;
4. a deployed/tested kill-switch implementation;
5. fresh owner authorization for the exact one-run activation;
6. post-run lifecycle finalization and disable/deletion evidence.

Repository merge or green CI does not satisfy or authorize any of those live requirements.
