# Self-Driving PR write finalization v0

Status: **implemented terminal claim-finalization boundary; no GitHub executor or credential activation**.

`solvelang.self-driving.pr-write-finalization.v0` closes the replay gap after the no-write execution plan. A future one-shot GitHub writer must terminally finalize its claimed authorization after exactly one attempt:

- successful branch/commit/PR creation -> `consumed`;
- failed write attempt -> `invalidated`;
- cancelled write attempt -> `invalidated`.

The core receives bounded sanitized attempt evidence and invokes one injected finalizer exactly once. It never retries or automatically rearms a claim.

## Evidence contract

Every attempt has explicit UTC start/completion timestamps, exactly one attempt, and a maximum 60-second duration. Evidence cannot begin before the claim timestamp.

Success requires:

- one exact 40-hex commit SHA;
- one opaque pull-request reference (URLs are rejected);
- no failure stage.

Failure requires one bounded stage: `live-preflight`, `create-branch`, `create-commit`, or `open-pr`. Failed/cancelled evidence may not claim a completed commit or pull request.

The terminal store request binds the claim ID, approval ID, approval SHA-256 binding, execution-plan ID, terminal state, outcome, completion time, and bounded evidence.

## Authority boundary

This module does not perform GitHub writes. It has no GitHub API client, credential resolver, network access, repository write, provider access, rollout/production/billing mutation, or Solve Runner authority. The only represented external mutation is the injected terminal claim-state finalizer.

Finalizer failures and malformed results are reduced to fixed rejection categories with zero retry and no re-arm. A later GitHub executor must call this finalization boundary after its single attempt so a claimed authorization cannot be replayed after success, failure, or cancellation.
