# Self-Driving PR authorization preflight v0

Status: **no-write authorization preflight**.

`solvelang.self-driving.pr-preflight.v0` is the first PR-mode boundary artifact. It may determine that a fully validated patch is `ready-for-separate-write-authorization`, but it cannot resolve a credential or perform a GitHub/repository write.

## Required binding

The preflight consumes only a complete canonical Patch Validation artifact and requires:

- exact GitHub `owner/repository` identity;
- exact protected base branch;
- exact base revision matching the validated Patch Preview revision;
- a distinct non-protected proposed head branch;
- an opaque GitHub installation reference, never token material;
- one or more explicitly selected validation proposals that are `passed` and `reviewReady`;
- caller-supplied branch-protection evidence showing pull requests required, force push disabled, at least one required approval, bounded required checks, explicit UTC observation time, and an opaque evidence locator.

The future least-privilege permission requirement is recorded as:

- `metadata: read`;
- `contents: write`;
- `pullRequests: write`.

Those are requirements for a future separately authorized write executor. The preflight does not inspect or resolve a live GitHub installation and cannot prove that an installation currently has exactly those permissions.

## Fail-closed rules

The preflight rejects partial Patch Validation, failed/blocked/unready selections, repository/base revision drift, direct base-branch targeting, protected head branches, unsafe ref syntax, weak branch-protection evidence, duplicate/unknown proposal selections, malformed timestamps, URLs in installation references, and credential-like evidence.

## Authority boundary

Even after a successful preflight, the policy records:

- `writeExecutionStatus: not-executed`;
- `writeAuthorizationGranted: false`;
- GitHub API access disabled;
- credential resolution disabled;
- branch creation disabled;
- commit writes disabled;
- pull-request creation disabled;
- patch application and shell execution disabled;
- repository/provider/network/rollout/production/billing mutation disabled;
- Solve Runner authority disabled;
- external side effects disabled.

Actual PR creation remains a separate write-side implementation and authorization gate. It must revalidate repository, installation, branch protection, base revision, patch integrity, and validation evidence immediately before any write, then use least privilege with no direct protected-branch push or automatic merge.
