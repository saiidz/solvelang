# Self-Driving injected PR write executor v0

Status: **implemented repository orchestration boundary; no built-in GitHub credential resolver or production activation**.

`solvelang.self-driving.pr-write-executor.v0` is the first Self-Driving layer that can perform repository side effects when a caller deliberately injects a write-capable adapter. It consumes only the previously merged SHA-256-bound execution plan and terminal claim lifecycle.

## Exact live preflight

Before any write call, the executor requires one injected live-preflight result that must prove:

- the protected base branch still resolves to the exact reviewed base revision;
- the proposed head branch is absent;
- pull requests remain required and force push remains disabled;
- the base branch remains protected and the proposed head is not a protected branch;
- required approvals have not weakened;
- every previously required check is still required;
- the evidence is no more than two minutes old, not future-dated, and newer than the claim;
- every planned target file still has its exact reviewed base blob SHA.

The claimed authorization itself may be no more than five minutes old when execution starts.

## One-shot write sequence

After live preflight succeeds, the executor invokes exactly these injected adapter operations, in order:

1. `createBranch` from the exact reviewed base revision;
2. `createCommit` on the approved head branch with the bounded reviewed patch set;
3. `openPullRequest` from the approved head branch to the protected base branch.

There is no retry, force push, direct write to the protected base, automatic merge, shell execution, or extra write action. Returned branch, parent revision, commit SHA, repository/base/head identities, and PR reference are revalidated before the next step is accepted.

## Failure truth and replay safety

Failures are reduced to the bounded stages `live-preflight`, `create-branch`, `create-commit`, or `open-pr`. Raw adapter errors are not returned. The executor conservatively reports when a branch, commit, or pull request may exist after an ambiguous failed call and never retries automatically.

Every attempt then invokes the terminal finalizer exactly once:

- success -> consume the claim;
- failure -> invalidate the claim;
- cancellation -> invalidate the claim.

If the PR write succeeds but terminal finalization cannot be confirmed, the result is `terminal-state-unconfirmed`; the executor does not retry either the write or the finalizer automatically. That state requires operator reconciliation before another authorization.

## Credential and production boundary

Core has no built-in token input, credential resolver, GitHub SDK/client, or production connection. The GitHub/network authority lives entirely in the injected adapter supplied by a separately reviewed runtime.

Repository implementation therefore does **not** by itself activate Self-Driving writes in production. A production adapter must still prove least-privilege installation/token acquisition, exact GitHub REST semantics for the four live checks plus the three write calls, credential non-persistence, timeouts/cancellation, sanitized transport failures, and explicit runtime activation controls.

Automatic merge remains out of scope. Solve Runners remain a separate product/security/commercial boundary.