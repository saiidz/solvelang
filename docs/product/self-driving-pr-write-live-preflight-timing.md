# Self-Driving PR write live-preflight timing

Status: executor timing hardening candidate.

The one-shot PR write executor starts before its injected adapter performs live GitHub reads. Therefore valid network-backed live evidence can be observed after the executor's `startedAt` timestamp.

The executor now treats timing as three distinct moments:

1. `startedAt` — captured before any live adapter call; still used for authorization-claim age and finalization attempt duration.
2. `livePreflightCheckedAt` — captured immediately after `verifyLivePreflight` returns; used only to validate the live evidence freshness window.
3. `completedAt` — captured after the one-shot write attempt finishes or stops; used for terminal claim finalization.

The live evidence must:

- be observed at or before `livePreflightCheckedAt`;
- be no more than two minutes old relative to `livePreflightCheckedAt`;
- be observed at or after the authorization claim;
- still satisfy exact base revision, absent head, branch protection, required checks/approvals, and exact blob identity.

The injected clock must not move backwards between `startedAt` and `livePreflightCheckedAt`; a backwards clock fails closed before any repository write.

This change does not weaken the five-minute maximum claim age, the one-shot write sequence, terminal claim consumption/invalidation, zero-retry behavior, or any GitHub permission boundary. It enables a real network-backed preflight to report its actual observation time instead of requiring evidence to be artificially backdated to the executor start.
