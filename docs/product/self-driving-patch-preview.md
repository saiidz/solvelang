# Self-Driving patch preview v0

Status: **review-only; non-applied**.

`solvelang.self-driving.patch-preview.v0` is the second Suggest-stage artifact. It consumes only a safe `solvelang.self-driving.suggestion-plan.v0`, binds reviewable text hunks to an exact repository revision and expected base blob SHA, and emits patch content for human/agent review without applying it.

## Safety contract

- Patch paths must exactly match edit-intent paths already authorized by the source Suggest proposal.
- Each source edit path must be covered exactly once; extra, duplicate, or missing paths fail closed.
- Only structured text hunks are accepted. Binary patch markers are rejected.
- Hunk line prefixes must match declared old/new line counts and old-file ranges may not overlap.
- Repository revision and base blob revisions must be exact 40- or 64-hex values.
- Patch proposal/file/hunk/line/byte counts are bounded.
- Multiline line records, unsupported control characters, and common credential-like material are rejected.
- Source Suggest partiality remains visible as `source-suggestion-partial`.

The artifact includes patch content but records patch application, shell execution, GitHub/repository writes, provider/network/credential access, rollout/production/billing mutation, Solve Runner authority, and external side effects as unavailable.

## Not PR mode

This contract is not permission to apply a patch or create a branch/PR. PR mode remains a separate authority boundary requiring least-privilege GitHub installation permissions, exact repository/tenant and base-revision binding, protected-branch policy, validation gates, review/audit evidence, and explicit write-side approval behavior.
