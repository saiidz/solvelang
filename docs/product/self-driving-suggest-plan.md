# Self-Driving Suggest plan v0

Status: **review-only repository contract; no write authority**.

`solvelang.self-driving.suggestion-plan.v0` is the first implemented Suggest-stage artifact. It consumes an already-safe canonical `solvelang.self-driving.observe-run.v0` and caller-supplied change-plan inputs, then produces deterministic review material bound to emitted Solve Inbox finding IDs.

This stage intentionally does **not** contain patch bytes or replacement file contents. It does not apply changes, execute validation commands, create branches or pull requests, call GitHub, access providers or credentials, mutate rollouts, touch production, activate billing, or provision Solve Runners.

## Contract

Each proposal must bind to exactly one finding emitted by the source Observe Run and includes only:

- a bounded single-line review title and rationale;
- the source finding's Scout, severity, title, and provenance;
- one or more canonical repository-relative edit intents (`path` plus human-readable purpose);
- one or more human-readable validation steps classified as `test`, `lint`, `build`, or `review`.

Proposal IDs and ordering are deterministic. Duplicate proposal bindings, duplicate edit paths, unknown finding IDs, absolute/traversal/Git-metadata paths, multiline/raw-looking values, credential-like material, unsupported validation kinds, and excessive inputs fail closed.

Upstream Observe partiality remains explicit. A partial Observe Run produces a partial Suggest plan with `source-observe-partial`; suggestion planning never upgrades incomplete evidence to complete truth.

## Authority boundary

The serialized policy records all of the following as `false`:

- patch bytes included;
- patch application access;
- shell execution access;
- GitHub write access;
- repository write access;
- provider/network/credential access;
- rollout mutation access;
- production mutation access;
- external side effects.

The canonical Scout/Observe analyzers remain observe-only. This module implements a separate review-only artifact stage for `suggest`; it does not make `createSolveInbox`, `runSelfDrivingObserve`, provider pipelines, or Scout analyzers accept non-observe execution.

## Next gate

A later Suggest increment may carry a bounded **non-applied diff artifact**, but only after a separate review defines source-revision binding, allowed file classes, binary/size limits, secret scanning, diff integrity, validation-plan linkage, and explicit proof that no patch is applied.

PR mode remains a separate authority boundary requiring least-privilege GitHub installation permissions, branch protection, explicit repository/tenant binding, review policy, validation gates, audit evidence, and no direct push to protected branches.
