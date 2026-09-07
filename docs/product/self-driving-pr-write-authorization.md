# Self-Driving PR write authorization v0

Status: **implemented authorization/claim boundary; no GitHub write executor or live credential activation**.

`solvelang.self-driving.pr-write-approval.v0` is the next authority gate after the merged no-write PR preflight (#844). It does not create branches, commits, or pull requests. It normalizes an explicit short-lived approval against one canonical `solvelang.self-driving.pr-preflight.v0` artifact and permits only an injected atomic single-use approval claim.

## Exact binding

The approval must match the preflight exactly for:

- preflight ID;
- repository `owner/name`;
- protected base branch;
- validated base revision;
- non-protected proposed head branch;
- opaque GitHub installation reference.

The boundary revalidates the preflight's least-privilege permissions, fixed `create-branch` → `create-commit` → `open-pr` planned action sequence, branch-protection evidence, canonical selected-proposal ordering, selected review-ready proposal identities, and the original deterministic preflight ID. Unsafe `.` / `..` repository identities, forged ordering, or a weakened preflight are rejected before the injected claimer can run.

## Short-lived single-use approval

The approval has explicit UTC `notBefore` and `expiresAt` timestamps and a maximum 15-minute lifetime. Claiming requires an injected atomic compare-and-set style dependency. The dependency is invoked once, with zero retry and no automatic re-arm. Fixture concurrency tests prove one approval can yield only one successful claim when the injected store enforces atomicity.

The claim additionally requires branch-protection evidence observed no more than five minutes before the claim and rejects future-dated evidence. This limits the time-of-check gap before any later executor can be considered; the executor must still revalidate live base revision and protection state before writing.

The claim request carries the **complete normalized approval**—approval ID, operator, runtime, activation window, and the full canonical preflight binding—so an external atomic store can enforce exact approval identity rather than only matching the repository/branch subset.

The only represented external state mutation is the approval claim itself. Claimer failures and malformed results are reduced to fixed rejection categories; raw errors and credential-like values are not returned.

## Still no write execution

A successful claim is authorization evidence for a later separately reviewed executor. This module has:

- no GitHub API client;
- no network access;
- no credential resolver or token input;
- no branch creation;
- no commit write;
- no patch application;
- no pull-request creation;
- no protected-branch direct push;
- no force push;
- no merge authority;
- no rollout, production, billing, provider, or Solve Runner authority.

The next executor stage must separately prove exact claimed approval binding, patch/base-blob integrity at execution time, fresh live branch-protection and base-revision checks, least-privilege credential resolution, bounded one-shot GitHub calls, protected-branch safety, no direct base write, no force push, no auto-merge, sanitized failure handling, and terminal claim finalization. Live activation must remain separate from repository implementation.
