# PostHog canary lifecycle operator boundary

This boundary is the repository-side handoff between a finalized, sanitized-only PostHog canary lifecycle record and externally injected retention/disable operators.

## What it qualifies

- the runtime activation must retain the exact deny-by-default runtime policy;
- the lifecycle record must retain the exact sanitized-evidence-only safety policy and all canonical disable actions;
- the lifecycle must already be atomically finalized as consumed or invalidated before an operator can run;
- activation, finalization, lifecycle, project, origin, operation, credential reference, kill-switch reference, evidence destination, sanitized digest, deletion deadline, and the complete disable-action set are SHA-256 bound into one operator plan;
- one injected operator call must return bounded retention evidence and one evidence identifier for every required disable action;
- evidence must bind the exact plan/lifecycle, contain no extra fields, fall inside the observed operator interval, and complete no later than the approved sanitized-evidence deletion deadline;
- the deletion deadline is rechecked after the asynchronous operator returns;
- dependency errors are sanitized and there is no retry or automatic rearm.

The required disable actions remain:

1. abort active work;
2. disallow the approval ID;
3. remove the runtime credential reference;
4. owner-revoke the canary key;
5. verify pre-auth denial;
6. delete sanitized evidence.

## Authority that remains external

The module contains no credential store, evidence store, deletion client, key-revocation API, provider client, deployment capability, repository write path, production rollout authority, billing mutation authority, or Solve Runner authority. It only validates a plan and evidence returned by an injected operator.

A real operator implementation must be separately reviewed and connected to the approved external stores/services. Secret values must remain outside GitHub and chat; the plan contains only the already-approved opaque credential reference.

## Live-canary status

Issue #833 remains owner-gated. This repository boundary does **not** authorize a live PostHog request or prove that a production retention/revocation implementation exists. Before activation, the exact external operator implementation and least-privilege PostHog project/key scope still require verification, followed by fresh owner authorization for the one-run canary.
